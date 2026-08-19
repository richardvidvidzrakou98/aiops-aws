import { Router } from "express";

const service = "aiops-demo-app";

function healthPayload(status: "ok" | "ready") {
  return {
    status,
    service,
    timestamp: new Date().toISOString(),
    uptime: Number(process.uptime().toFixed(2))
  };
}

export function createHealthRouter(log: (event: string, details?: Record<string, unknown>) => void): Router {
  const router = Router();

  router.get("/health", (_request, response) => {
    log("Health check", { endpoint: "/health" });
    response.json(healthPayload("ok"));
  });

  router.get("/health/ready", (_request, response) => {
    log("Health check", { endpoint: "/health/ready" });
    response.json(healthPayload("ready"));
  });

  return router;
}
