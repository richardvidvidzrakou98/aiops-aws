# AIOps AWS MVP

Autonomous incident detection and remediation on AWS, demonstrated live at AWS Community Day.

## Architecture

```
CloudWatch Alarm
      ↓
EventBridge
      ↓
Coordinator Lambda  ──→  Gemini AI Analysis
      ↓
Policy Evaluation
      ↓
SSM Run Command
      ↓
EC2 (aiops-demo-app)
```

CI/CD and AIOps both reach EC2 through SSM, for completely different reasons:

- **GitHub Actions → SSM** — deploy application releases
- **AIOps → SSM** — remediate incidents autonomously

## Repository layout

```
aiops-aws/
├── .github/workflows/deploy-demo-app.yml   # CI/CD pipeline
├── demo-app/                               # Demo workload (Node.js / Express)
│   ├── src/
│   ├── aiops-demo-app.service              # systemd unit for EC2
│   └── scripts/ec2-setup.sh               # one-time EC2 bootstrap
├── src/                                    # AIOps Lambda functions
│   ├── coordinator/
│   ├── investigation/
│   ├── ai/
│   ├── policy/
│   └── remediation/
├── events/                                 # Sample EventBridge payloads
├── template.yaml                           # SAM infrastructure
└── samconfig.toml                          # SAM deploy defaults
```

## Prerequisites

- AWS CLI configured for your account
- AWS SAM CLI
- Node.js 22
- An existing S3 bucket for deployment artifacts (default: `aiops-demo-deploy-<account-id>`)

## 1 — Deploy infrastructure with SAM

```bash
sam build
sam deploy \
  --parameter-overrides \
    "GitHubRepository=<owner>/<repo> \
     GeminiApiKey=<your-key> \
     DeploymentBucketName=aiops-demo-deploy-<account-id>"
```

SAM creates:
- EC2 instance with SSM and S3 read access
- GitHub Actions OIDC provider
- `AIOpsDemoAppDeploymentRole` (least-privilege, OIDC-scoped)
- CloudWatch alarm → EventBridge → Coordinator Lambda

## 2 — Bootstrap EC2 (once)

After `sam deploy`, retrieve the instance ID from the stack outputs, then run:

```bash
INSTANCE_ID=$(aws cloudformation describe-stacks \
  --stack-name aiops-mvp \
  --query "Stacks[0].Outputs[?OutputKey=='AIOpsEC2'].OutputValue" \
  --output text)

aws ssm send-command \
  --document-name AWS-RunShellScript \
  --instance-ids "$INSTANCE_ID" \
  --parameters "commands=[\"bash -s\"]" \
  --comment "Bootstrap aiops-demo-app" \
  < demo-app/scripts/ec2-setup.sh
```

Then set the secret control token on the instance:

```bash
aws ssm send-command \
  --document-name AWS-RunShellScript \
  --instance-ids "$INSTANCE_ID" \
  --parameters 'commands=["sed -i s/change-me/<strong-token>/ /opt/aiops-demo-app/config/production.env"]'
```

## 3 — Configure GitHub Actions variables

In your GitHub repository → **Settings → Environments → production**, add:

| Variable | Value |
|---|---|
| `AWS_ACCOUNT_ID` | your 12-digit account ID |
| `AWS_REGION` | `us-east-1` |
| `DEPLOYMENT_BUCKET` | `aiops-demo-deploy-<account-id>` |
| `EC2_INSTANCE_ID` | instance ID from SAM outputs |

## 4 — First automated deployment

Push any change to `demo-app/` on `main`, or trigger the workflow manually:

```
GitHub Actions → npm ci → npm test → npm run build → S3 → SSM → EC2
```

The app will be live at `http://<ec2-public-ip>:3000`.

## 5 — Live demo flow

1. Open `http://<ec2-public-ip>:3000` — note the **Version** (7-char commit SHA)
2. Trigger a CPU incident:
   ```bash
   curl -X POST "http://<ec2-public-ip>:3000/internal/simulate/cpu?duration=360" \
     -H "Authorization: Bearer <control-token>"
   ```
3. CloudWatch alarm fires → AIOps detects → Gemini analyses → policy approves → SSM remediates
4. Push a code change → GitHub Actions deploys → refresh the page → version changes

## Rollback

Every release is retained in S3 under `releases/<sha>/aiops-demo-app.tgz`.  
To redeploy a previous release, trigger the workflow manually and enter the target SHA.
