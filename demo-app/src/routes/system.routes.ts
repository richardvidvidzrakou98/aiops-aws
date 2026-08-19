import os from "node:os";
import { Router, type Request, type Response } from "express";
import type { CpuService } from "../services/cpu.service";

const service = "aiops-demo-app";
const defaultDuration = 300;
const maxDuration = 600;

type Log = (event: string, details?: Record<string, unknown>) => void;

function getDuration(value: unknown): number | undefined {
  if (value === undefined) return defaultDuration;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const duration = Number(value);
  return duration >= 1 && duration <= maxDuration ? duration : undefined;
}

function authorized(request: Request, token: string): boolean {
  return request.get("authorization") === `Bearer ${token}`;
}

function requireControlToken(token: string, log: Log) {
  return (request: Request, response: Response, next: () => void): void => {
    if (!authorized(request, token)) {
      log("Unauthorized control request", { path: request.path });
      response.status(401).json({
        error: "Unauthorized",
        message: "Valid demo control token required"
      });
      return;
    }
    next();
  };
}

export function createSystemRouter(cpu: CpuService, controlToken: string, log: Log): Router {
  const router = Router();

  router.get("/api/system", (_request, response) => {
    const memory = process.memoryUsage();
    response.json({
      service,
      version: process.env.APP_VERSION ?? "development",
      status: "operational",
      environment: process.env.NODE_ENV ?? "development",
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      hostname: os.hostname(),
      uptime: Number(process.uptime().toFixed(2)),
      memory: { used: memory.rss, total: os.totalmem() },
      cpu: cpu.snapshot(),
      timestamp: new Date().toISOString()
    });
  });

  router.get("/api/system/cpu", (_request, response) => {
    response.json(cpu.snapshot());
  });

  // ── Browser-safe demo control proxy ────────────────────────────────────────
  // The browser calls these same-origin routes; the token never leaves the server.

  router.get("/api/demo/simulate/cpu", (_request, response) => {
    response.json(cpu.getSimulation());
  });

  router.post("/api/demo/simulate/cpu", (request, response) => {
    const duration = getDuration(request.query.duration);
    if (!duration) {
      response.status(400).json({
        error: "Invalid duration",
        message: `Duration must be an integer between 1 and ${maxDuration} seconds`
      });
      return;
    }

    if (!cpu.startSimulation(duration)) {
      response.status(409).json({
        error: "Simulation already running",
        message: "Stop the active CPU simulation before starting another one"
      });
      return;
    }

    log("CPU simulation started via demo proxy", { duration });
    response.status(202).json({ status: "started", duration });
  });

  router.post("/api/demo/simulate/cpu/stop", (_request, response) => {
    const stopped = cpu.stopSimulation();
    if (stopped) log("CPU simulation stopped via demo proxy");
    response.json({ status: "stopped", wasActive: stopped });
  });

  // ── Protected internal endpoints (existing contract preserved) ─────────────
  const control = requireControlToken(controlToken, log);

  router.post("/internal/simulate/cpu", control, (request, response) => {
    const duration = getDuration(request.query.duration);
    if (!duration) {
      response.status(400).json({
        error: "Invalid duration",
        message: `Duration must be an integer between 1 and ${maxDuration} seconds`
      });
      return;
    }

    if (!cpu.startSimulation(duration)) {
      response.status(409).json({
        error: "Simulation already running",
        message: "Stop the active CPU simulation before starting another one"
      });
      return;
    }

    log("CPU simulation started", { duration });
    response.status(202).json({
      status: "started",
      duration,
      message: "Controlled CPU stress simulation started"
    });
  });

  router.post("/internal/simulate/cpu/stop", control, (_request, response) => {
    const stopped = cpu.stopSimulation();
    if (stopped) log("CPU simulation stopped");
    response.json({
      status: "stopped",
      message: stopped ? "CPU stress simulation stopped" : "No CPU stress simulation was active"
    });
  });

  return router;
}
