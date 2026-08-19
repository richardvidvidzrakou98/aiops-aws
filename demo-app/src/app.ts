import cors from "cors";
import { randomBytes } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { createHealthRouter } from "./routes/health.routes";
import { createSystemRouter } from "./routes/system.routes";
import { CpuService } from "./services/cpu.service";

export type Log = (event: string, details?: Record<string, unknown>) => void;

export interface AppOptions {
  controlToken: string;
  log: Log;
}

function homepage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AIOps Demo Application</title>
<style>
:root{
  --bg:#07111f;--surface:#0d1b2d;--surface2:#111f33;--border:#1e3048;--border2:#243750;
  --text:#e9f1fa;--muted:#7a95b0;--muted2:#9db0c7;
  --good:#2dd4a0;--good-glow:rgba(45,212,160,.25);
  --warn:#ffb454;--warn-glow:rgba(255,180,84,.25);
  --err:#f87171;--err-glow:rgba(248,113,113,.2);
  --accent:#4f8ef7;--accent2:#6ea8ff;
  --btn:#132d4b;--btn-hover:#1a3b60;--btn-border:#2a4d72;
  --radius:12px;--radius-sm:8px;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font:15px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh}
.page{max-width:960px;margin:0 auto;padding:40px 20px 64px}

/* ── Typography ── */
.eyebrow{color:var(--accent2);letter-spacing:.14em;font-size:.7rem;font-weight:700;text-transform:uppercase;margin-bottom:10px}
h1{font-size:clamp(1.8rem,4.5vw,2.9rem);line-height:1.1;font-weight:700;letter-spacing:-.02em;margin-bottom:12px}
.subtitle{color:var(--muted2);max-width:600px;font-size:.95rem;line-height:1.6}
.section-label{font-size:.7rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:16px}

/* ── Divider ── */
.divider{height:1px;background:var(--border);margin:36px 0}

/* ── Status banner ── */
.status-banner{border:1px solid var(--border2);border-radius:var(--radius);padding:20px 24px;background:var(--surface);transition:border-color .3s,background .3s}
.status-banner.high{border-color:var(--warn);background:rgba(255,180,84,.06)}
.status-banner.err{border-color:var(--err);background:rgba(248,113,113,.06)}
.status-row{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.dot{width:9px;height:9px;border-radius:50%;background:var(--good);box-shadow:0 0 10px var(--good-glow);flex-shrink:0;transition:background .3s,box-shadow .3s}
.status-banner.high .dot{background:var(--warn);box-shadow:0 0 10px var(--warn-glow)}
.status-banner.err .dot{background:var(--err);box-shadow:0 0 10px var(--err-glow)}
.status-text{font-size:1rem;font-weight:600}
.status-desc{color:var(--muted2);font-size:.875rem}

/* ── Metric grid ── */
.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:18px 20px;transition:border-color .3s}
.card.high{border-color:var(--warn)}
.card-label{font-size:.7rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
.card-value{font-size:1.5rem;font-weight:700;line-height:1.1;overflow-wrap:anywhere;transition:color .3s}
.card.high .card-value{color:var(--warn)}
.card-sub{font-size:.8rem;color:var(--muted2);margin-top:5px}
.card.high .card-sub{color:var(--warn)}

/* ── Skeleton ── */
.skel{display:inline-block;border-radius:4px;background:linear-gradient(90deg,var(--surface2) 25%,var(--border2) 50%,var(--surface2) 75%);background-size:200% 100%;animation:shimmer 1.4s infinite}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.skel-val{height:1.5rem;width:70%;margin-bottom:6px}
.skel-sub{height:.75rem;width:50%}

/* ── Demo control ── */
.demo-card{background:var(--surface);border:1px solid var(--border2);border-radius:var(--radius);padding:24px}
.demo-desc{color:var(--muted2);font-size:.9rem;margin-bottom:20px;max-width:520px}
.demo-state{display:inline-flex;align-items:center;gap:7px;font-size:.78rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:16px}
.demo-state-dot{width:7px;height:7px;border-radius:50%;background:var(--muted);transition:background .3s}
.demo-state.active .demo-state-dot{background:var(--warn);box-shadow:0 0 8px var(--warn-glow)}
.demo-state.active{color:var(--warn)}
.demo-state.good .demo-state-dot{background:var(--good)}
.demo-state.good{color:var(--good)}
.sim-active-msg{background:rgba(255,180,84,.08);border:1px solid rgba(255,180,84,.25);border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:16px;font-size:.875rem;color:var(--warn)}
.sim-active-msg strong{display:block;margin-bottom:3px}
.btn-row{display:flex;gap:10px;flex-wrap:wrap}
button{padding:10px 20px;border-radius:var(--radius-sm);border:1px solid var(--btn-border);background:var(--btn);color:var(--text);font:inherit;font-size:.875rem;font-weight:500;cursor:pointer;transition:background .15s,opacity .15s}
button:hover:not(:disabled){background:var(--btn-hover)}
button:disabled{opacity:.45;cursor:not-allowed}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.btn-danger{border-color:rgba(248,113,113,.4);background:rgba(248,113,113,.1);color:var(--err)}
.btn-danger:hover:not(:disabled){background:rgba(248,113,113,.18)}
.sim-feedback{margin-top:12px;font-size:.85rem;color:var(--muted2);min-height:1.2em}
.sim-feedback.err{color:var(--err)}

/* ── Workflow ── */
.workflow{display:flex;flex-direction:column;align-items:flex-start;gap:0}
.wf-step{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:9px 16px;font-size:.875rem;font-weight:500}
.wf-arrow{color:var(--border2);font-size:1rem;padding:3px 0 3px 20px;line-height:1}

/* ── About ── */
.about{color:var(--muted2);font-size:.875rem;line-height:1.7;max-width:600px}

/* ── Footer ── */
.footer{display:flex;align-items:center;gap:12px;color:var(--muted);font-size:.82rem;margin-top:36px;flex-wrap:wrap}
.footer button{padding:6px 14px;font-size:.8rem}

/* ── Responsive ── */
@media(max-width:640px){
  .metrics{grid-template-columns:1fr 1fr}
  .page{padding:28px 16px 48px}
}
@media(max-width:400px){
  .metrics{grid-template-columns:1fr}
}
</style>
</head>
<body>
<main class="page">

  <!-- Header -->
  <div class="eyebrow">AIOps Demo Application</div>
  <h1>Autonomous incident detection<br>and remediation</h1>
  <p class="subtitle">A professional demonstration workload intentionally monitored by the AIOps control plane.</p>

  <div class="divider"></div>

  <!-- Status -->
  <div class="section-label">System Status</div>
  <div class="status-banner" id="status-banner" role="status" aria-live="polite">
    <div class="status-row">
      <span class="dot" id="status-dot"></span>
      <span class="status-text" id="status-text">Operational</span>
    </div>
    <p class="status-desc" id="status-desc">The application is healthy and operating normally.</p>
  </div>

  <div class="divider"></div>

  <!-- Metrics -->
  <div class="section-label">System Metrics</div>
  <div class="metrics" aria-live="polite">

    <article class="card" id="card-cpu">
      <div class="card-label">CPU Usage</div>
      <div class="card-value" id="cpu-value"><span class="skel skel-val"></span></div>
      <div class="card-sub" id="cpu-sub"><span class="skel skel-sub"></span></div>
    </article>

    <article class="card" id="card-mem">
      <div class="card-label">Memory</div>
      <div class="card-value" id="mem-value"><span class="skel skel-val"></span></div>
      <div class="card-sub" id="mem-sub"><span class="skel skel-sub"></span></div>
    </article>

    <article class="card" id="card-health">
      <div class="card-label">Health</div>
      <div class="card-value" id="health-value"><span class="skel skel-val"></span></div>
      <div class="card-sub" id="health-sub"><span class="skel skel-sub"></span></div>
    </article>

    <article class="card" id="card-uptime">
      <div class="card-label">Uptime</div>
      <div class="card-value" id="uptime-value"><span class="skel skel-val"></span></div>
      <div class="card-sub" id="uptime-sub"></div>
    </article>

    <article class="card" id="card-version">
      <div class="card-label">Version</div>
      <div class="card-value" id="version-value"><span class="skel skel-val"></span></div>
      <div class="card-sub" id="version-sub"></div>
    </article>

    <article class="card" id="card-node">
      <div class="card-label">Node.js</div>
      <div class="card-value" id="node-value"><span class="skel skel-val"></span></div>
      <div class="card-sub" id="node-sub" id="hostname-value"></div>
    </article>

  </div>

  <div class="divider"></div>

  <!-- Demo Control -->
  <div class="section-label">Demo Control</div>
  <div class="demo-card">
    <p class="demo-desc">Create a controlled CPU incident to demonstrate the AIOps detection and remediation workflow.</p>

    <div class="demo-state" id="demo-state-badge">
      <span class="demo-state-dot"></span>
      <span id="demo-state-text">Ready</span>
    </div>

    <div class="sim-active-msg" id="sim-active-msg" hidden>
      <strong>CPU simulation active</strong>
      <span id="sim-active-detail">CPU load is intentionally elevated for the demonstration.</span>
    </div>

    <div class="btn-row">
      <button type="button" id="btn-start">Start CPU Simulation</button>
      <button type="button" id="btn-stop" class="btn-danger" hidden>Stop Simulation</button>
    </div>
    <p class="sim-feedback" id="sim-feedback" aria-live="polite"></p>
  </div>

  <div class="divider"></div>

  <!-- AIOps Workflow -->
  <div class="section-label">AIOps Workflow</div>
  <nav class="workflow" aria-label="AIOps workflow steps">
    <div class="wf-step">Application</div>
    <div class="wf-arrow">↓</div>
    <div class="wf-step">CloudWatch</div>
    <div class="wf-arrow">↓</div>
    <div class="wf-step">AIOps Detection</div>
    <div class="wf-arrow">↓</div>
    <div class="wf-step">Policy Evaluation</div>
    <div class="wf-arrow">↓</div>
    <div class="wf-step">Remediation</div>
    <div class="wf-arrow">↓</div>
    <div class="wf-step">Verification</div>
  </nav>

  <div class="divider"></div>

  <!-- About -->
  <div class="section-label">About This Demonstration</div>
  <p class="about">
    This application is the monitored workload in the AIOps AWS MVP. When CPU utilization exceeds the
    CloudWatch alarm threshold, the AIOps system automatically investigates the incident, consults an
    AI model for analysis, evaluates the recommendation against a policy, and executes a safe remediation
    action — all without human intervention.
  </p>

  <!-- Footer -->
  <div class="footer">
    <span>Last updated: <span id="updated">—</span></span>
    <button type="button" id="btn-refresh">Refresh</button>
  </div>

</main>
<script nonce="${nonce}">
(function () {
  'use strict';

  const CPU_HIGH = 80;

  // ── Helpers ──────────────────────────────────────────────────────────────
  function fmtUptime(s) {
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? h + 'h ' + m + 'm ' + x + 's' : m ? m + 'm ' + x + 's' : x + 's';
  }
  function fmtMB(b) { return (b / 1048576).toFixed(1) + ' MB'; }
  function setText(id, val) { document.getElementById(id).textContent = val; }
  function setHidden(id, hidden) { document.getElementById(id).hidden = hidden; }

  // ── Metrics refresh ───────────────────────────────────────────────────────
  async function refreshMetrics() {
    try {
      const r = await fetch('/api/system', { cache: 'no-store' });
      if (!r.ok) throw new Error('non-ok');
      const d = await r.json();
      const high = d.cpu.usage >= CPU_HIGH;

      // Status banner
      const banner = document.getElementById('status-banner');
      banner.className = 'status-banner' + (high ? ' high' : '');
      setText('status-text', high ? 'High CPU Utilization Detected' : 'Operational');
      setText('status-desc', high
        ? 'The application is experiencing elevated CPU usage.'
        : 'The application is healthy and operating normally.');

      // CPU card
      document.getElementById('card-cpu').className = 'card' + (high ? ' high' : '');
      setText('cpu-value', d.cpu.usage + '%');
      setText('cpu-sub', (high ? 'High utilization' : 'Normal') + ' · ' + d.cpu.cores + ' cores');

      // Memory
      setText('mem-value', fmtMB(d.memory.used));
      setText('mem-sub', 'of ' + fmtMB(d.memory.total));

      // Health
      setText('health-value', 'Healthy');
      setText('health-sub', 'Application ready');

      // Uptime
      setText('uptime-value', fmtUptime(d.uptime));

      // Version
      setText('version-value', d.version);
      setText('version-sub', d.hostname);

      // Node
      setText('node-value', d.nodeVersion);
      setText('node-sub', d.environment);

      setText('updated', new Date(d.timestamp).toLocaleTimeString());
    } catch {
      const banner = document.getElementById('status-banner');
      banner.className = 'status-banner err';
      setText('status-text', 'Status Unavailable');
      setText('status-desc', 'Unable to retrieve current application metrics.');
      ['cpu-value','mem-value','health-value','uptime-value','version-value','node-value']
        .forEach(id => setText(id, 'Unavailable'));
    }
  }

  // ── Simulation state ──────────────────────────────────────────────────────
  let simBusy = false;

  function setDemoState(state, detail) {
    const badge = document.getElementById('demo-state-badge');
    const text  = document.getElementById('demo-state-text');
    const msg   = document.getElementById('sim-active-msg');
    const det   = document.getElementById('sim-active-detail');
    const start = document.getElementById('btn-start');
    const stop  = document.getElementById('btn-stop');

    badge.className = 'demo-state';
    text.textContent = state;

    if (state === 'Simulation Active') {
      badge.classList.add('active');
      msg.hidden = false;
      det.textContent = detail || 'CPU load is intentionally elevated for the demonstration.';
      start.hidden = true;
      stop.hidden = false;
    } else if (state === 'Stopped' || state === 'Ready') {
      badge.classList.add('good');
      msg.hidden = true;
      start.hidden = false;
      stop.hidden = true;
    } else {
      msg.hidden = true;
      start.hidden = false;
      stop.hidden = true;
    }
  }

  function setFeedback(msg, isErr) {
    const el = document.getElementById('sim-feedback');
    el.textContent = msg;
    el.className = 'sim-feedback' + (isErr ? ' err' : '');
  }

  async function startSim() {
    if (simBusy) return;
    simBusy = true;
    const btn = document.getElementById('btn-start');
    btn.disabled = true;
    setDemoState('Starting');
    setFeedback('Starting simulation…', false);
    try {
      const r = await fetch('/api/demo/simulate/cpu', { method: 'POST', cache: 'no-store' });
      const body = await r.json();
      if (r.status === 409) {
        setDemoState('Simulation Active', 'Simulation already running.');
        setFeedback('', false);
      } else if (!r.ok) {
        setDemoState('Ready');
        setFeedback('Unable to start simulation: ' + (body.message || r.status), true);
      } else {
        const mins = body.duration ? Math.round(body.duration / 60) + ' minute' + (body.duration >= 120 ? 's' : '') : '';
        setDemoState('Simulation Active', mins ? 'Simulation active · ' + mins + '.' : 'CPU load is intentionally elevated.');
        setFeedback('', false);
      }
    } catch {
      setDemoState('Ready');
      setFeedback('Unable to start simulation.', true);
    } finally {
      btn.disabled = false;
      simBusy = false;
    }
  }

  async function stopSim() {
    if (simBusy) return;
    simBusy = true;
    const btn = document.getElementById('btn-stop');
    btn.disabled = true;
    setDemoState('Stopping');
    setFeedback('Stopping simulation…', false);
    try {
      const r = await fetch('/api/demo/simulate/cpu/stop', { method: 'POST', cache: 'no-store' });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setDemoState('Simulation Active');
        setFeedback('Unable to stop simulation: ' + (body.message || r.status), true);
      } else {
        setDemoState('Stopped');
        setFeedback('CPU simulation stopped.', false);
        await refreshMetrics();
      }
    } catch {
      setDemoState('Simulation Active');
      setFeedback('Unable to stop simulation.', true);
    } finally {
      btn.disabled = false;
      simBusy = false;
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  document.getElementById('btn-start').addEventListener('click', startSim);
  document.getElementById('btn-stop').addEventListener('click', stopSim);
  document.getElementById('btn-refresh').addEventListener('click', refreshMetrics);

  refreshMetrics();
  setInterval(refreshMetrics, 5000);
}());
</script>
</body>
</html>`;
}

export function createApp(options: AppOptions): express.Express {
  const app = express();
  const cpu = new CpuService();

  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.locals.cspNonce = randomBytes(16).toString("base64");
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          scriptSrc: [
            "'self'",
            (_request, response) =>
              `'nonce-${(response as unknown as Response).locals.cspNonce}'`
          ],
          upgradeInsecureRequests: null
        }
      },
      strictTransportSecurity: false
    })
  );
  // This service is accessed from its own origin; no cross-origin browser access is required.
  app.use(cors({ origin: false }));
  app.use(express.json({ limit: "8kb" }));

  app.get("/", (_request, response) => {
    response.type("html").send(homepage(response.locals.cspNonce));
  });
  app.use(createHealthRouter(options.log));
  app.use(createSystemRouter(cpu, options.controlToken, options.log));

  app.use((request, response) => {
    if (request.path.startsWith("/api/") || request.path.startsWith("/health") || request.path.startsWith("/internal/")) {
      response.status(404).json({ error: "Not Found", message: "Endpoint not found" });
      return;
    }
    response.status(404).type("html").send("Not found");
  });

  app.use((error: Error, _request: Request, response: Response, _next: NextFunction) => {
    options.log("Unhandled application error", { message: error.message });
    response.status(500).json({ error: "Internal Server Error", message: "An unexpected error occurred" });
  });

  return app;
}
