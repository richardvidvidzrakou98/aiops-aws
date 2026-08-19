# AIOps Demo Application

`aiops-demo-app` is the small Node.js workload monitored by the AIOps AWS MVP. It is intentionally separate from the AIOps control plane under the repository root `src/` directory.

It provides a status-page UI, reliable health endpoints, lightweight operational metrics, and a protected, bounded CPU incident simulation for a live remediation demonstration.

## Architecture

```text
aiops-demo-app → CloudWatch → AIOps Detection → Gemini AI Analysis → Policy → Remediation → Verification
```

The app has no AWS SDK dependency and does not execute shell commands. Future AIOps remediation can restart its systemd service after the policy layer authorizes that action.

## Install and configure

```bash
cd demo-app
npm install
cp .env.example .env
```

Set a strong, private `DEMO_CONTROL_TOKEN` in `.env`. Do not commit `.env`.

- `PORT` — listening port; defaults to `3000`.
- `NODE_ENV` — application environment; use `production` on EC2.
- `DEMO_CONTROL_TOKEN` — required bearer token for CPU simulation controls. It must not remain `change-me` in production.
- `APP_VERSION` — non-secret release identifier displayed by `GET /api/system` and the status page. The CI/CD deployment sets this to the Git commit short SHA.

## Run

Development watches TypeScript files:

```bash
npm run dev
```

For production (including systemd):

```bash
npm run build
npm start
```

The server binds to `0.0.0.0` and gracefully handles `SIGTERM` and `SIGINT`, so `systemctl restart aiops-demo-app` can stop and start it cleanly.

## Endpoints

- `GET /` — responsive operational status page.
- `GET /health` — lightweight liveness endpoint.
- `GET /health/ready` — lightweight readiness endpoint.
- `GET /api/system` — safe operational metadata and CPU/memory metrics.
- `GET /api/system/cpu` — CPU usage sample and core count.
- `POST /internal/simulate/cpu` — protected, bounded CPU simulation.
- `POST /internal/simulate/cpu/stop` — protected CPU simulation stop.

Examples:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/system
curl http://localhost:3000/api/system/cpu
```

## Controlled CPU simulation

The simulation runs CPU work inside the Node.js process in short cooperative chunks. It cannot run longer than 600 seconds, defaults to 300 seconds, automatically stops at its deadline, and refuses concurrent simulations. This provides load for the AIOps workflow without installing or invoking `stress`.

All controls require a bearer token:

```bash
curl -X POST http://localhost:3000/internal/simulate/cpu \
  -H "Authorization: Bearer YOUR_TOKEN"

curl -X POST "http://localhost:3000/internal/simulate/cpu?duration=60" \
  -H "Authorization: Bearer YOUR_TOKEN"

curl -X POST http://localhost:3000/internal/simulate/cpu/stop \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Unauthenticated requests receive `401` and tokens are never logged or displayed in the UI.

## Security and operations

Helmet is enabled, cross-origin browser access is disabled, JSON request bodies are size-limited, and centralized errors return generic JSON without stack traces. The app exposes no credentials, environment values, file paths, or arbitrary command execution capability.

For eventual EC2 deployment, build the app on the instance (or deploy its build artifact), provide configuration through systemd environment configuration, and run `node dist/server.js` via `aiops-demo-app.service`. AWS SSM remediation and its permissions are intentionally outside this application and are not implemented here.

## CI/CD deployment model

The repository workflow `.github/workflows/deploy-demo-app.yml` packages the compiled application as `releases/<short-commit-sha>/aiops-demo-app.tgz`, uploads it to the deployment bucket, and uses SSM Run Command to deploy that exact release to EC2. Existing release directories are retained, so a previously uploaded release can be selected through the workflow's **Run workflow** interface without rebuilding it.

Before the first deployment, configure the systemd service to use `WorkingDirectory=/opt/aiops-demo-app/current` and load the protected `DEMO_CONTROL_TOKEN` from a root-readable `EnvironmentFile` such as `/etc/aiops-demo-app.env`. The workflow never receives or writes that token.
