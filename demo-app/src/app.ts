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
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AIOps Demo Application</title><style>
:root{--bg:#07111f;--panel:#0d1b2d;--line:#243750;--text:#e9f1fa;--muted:#9db0c7;--good:#43d19e;--warn:#ffb454}*{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,#07111f,#0b1728);color:var(--text);font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:980px;margin:auto;padding:28px 18px 48px}.eyebrow{color:#6ea8ff;letter-spacing:.12em;font-size:.75rem;font-weight:700}h1{font-size:clamp(2rem,5vw,3.3rem);line-height:1.08;margin:.4rem 0}h2{font-size:1.1rem;margin:0 0 18px}.intro,.note{color:var(--muted);max-width:680px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:30px 0}.card,.flow{background:rgba(13,27,45,.92);border:1px solid var(--line);border-radius:14px;padding:18px}.card small{display:block;color:var(--muted);margin-bottom:6px}.value{font-size:1.35rem;font-weight:650;overflow-wrap:anywhere}.status{display:flex;align-items:center;gap:9px}.dot{width:10px;height:10px;border-radius:50%;background:var(--good);box-shadow:0 0 14px var(--good)}.warning .dot{background:var(--warn);box-shadow:0 0 14px var(--warn)}.warning .value{color:var(--warn)}.flow-steps{display:flex;flex-wrap:wrap;align-items:center;gap:9px}.step{background:#13243a;border:1px solid #2a405c;border-radius:8px;padding:8px 11px;font-size:.88rem}.arrow{color:#6ea8ff}.footer{color:var(--muted);font-size:.87rem;margin-top:22px}button{margin-left:10px;padding:7px 10px;border:1px solid #416288;border-radius:7px;background:#132d4b;color:var(--text);font:inherit;font-size:.8rem;cursor:pointer}button:hover{background:#1a3b60}@media(max-width:560px){.grid{grid-template-columns:1fr}.wrap{padding-top:24px}.arrow{transform:rotate(90deg)}}
</style></head><body><main class="wrap"><div class="eyebrow">AIOPS DEMO APPLICATION</div><h1>Autonomous incident detection and remediation</h1><p class="intro">A professional demonstration workload intentionally monitored by the AIOps control plane.</p><section class="grid" aria-live="polite"><article class="card" id="status-card"><small>Current Status</small><div class="value status"><span class="dot"></span><span id="status">Operational</span></div></article><article class="card"><small>Service</small><div class="value">aiops-demo-app</div></article><article class="card"><small>Version</small><div class="value" id="version">Loading…</div></article><article class="card"><small>Health</small><div class="value" id="health">Healthy</div></article><article class="card"><small>Uptime</small><div class="value" id="uptime">Loading…</div></article><article class="card"><small>CPU</small><div class="value" id="cpu">Loading…</div></article><article class="card"><small>Memory</small><div class="value" id="memory">Loading…</div></article><article class="card"><small>Node.js</small><div class="value" id="node">Loading…</div></article><article class="card"><small>Hostname</small><div class="value" id="hostname">Loading…</div></article></section><section class="flow"><h2>How This Works</h2><div class="flow-steps"><span class="step">Application</span><span class="arrow">↓</span><span class="step">CloudWatch</span><span class="arrow">↓</span><span class="step">AIOps Detection</span><span class="arrow">↓</span><span class="step">Policy</span><span class="arrow">↓</span><span class="step">Remediation</span><span class="arrow">↓</span><span class="step">Verification</span></div><p class="note">This application is intentionally used as the workload monitored by the AIOps system during incident detection and remediation demonstrations.</p></section><p class="footer">Last updated: <span id="updated">Loading…</span> <button id="refresh" type="button">Refresh status</button></p></main><script nonce="${nonce}">
const formatUptime=s=>{s=Math.floor(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return h?h+'h '+m+'m '+x+'s':m?m+'m '+x+'s':x+'s'};const formatBytes=b=>(b/1024/1024).toFixed(1)+' MB';async function refresh(){try{const r=await fetch('/api/system',{cache:'no-store'});if(!r.ok)throw Error();const d=await r.json(),high=d.cpu.usage>=80;document.querySelector('#status').textContent=high?'High CPU Utilization Detected':'Operational';document.querySelector('#status-card').classList.toggle('warning',high);document.querySelector('#version').textContent=d.version;document.querySelector('#health').textContent='Healthy';document.querySelector('#uptime').textContent=formatUptime(d.uptime);document.querySelector('#cpu').textContent=d.cpu.usage+'% ('+d.cpu.cores+' cores)';document.querySelector('#memory').textContent=formatBytes(d.memory.used)+' / '+formatBytes(d.memory.total);document.querySelector('#node').textContent=d.nodeVersion;document.querySelector('#hostname').textContent=d.hostname;document.querySelector('#updated').textContent=new Date(d.timestamp).toLocaleString()}catch{document.querySelector('#status').textContent='Status unavailable';document.querySelector('#health').textContent='Unavailable'}}document.querySelector('#refresh').addEventListener('click',refresh);refresh();setInterval(refresh,5000);
</script></body></html>`;
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
