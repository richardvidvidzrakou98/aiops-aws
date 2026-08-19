import "dotenv/config";
import { createApp, type Log } from "./app";

function requiredControlToken(): string {
  const token = process.env.DEMO_CONTROL_TOKEN;
  if (!token) throw new Error("DEMO_CONTROL_TOKEN must be configured");
  if (process.env.NODE_ENV === "production" && token === "change-me") {
    throw new Error("DEMO_CONTROL_TOKEN must be changed before production use");
  }
  return token;
}

function configuredPort(): number {
  const port = Number(process.env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

const log: Log = (event, details = {}) => {
  console.log(JSON.stringify({ level: "info", event, timestamp: new Date().toISOString(), ...details }));
};

try {
  const port = configuredPort();
  const app = createApp({ controlToken: requiredControlToken(), log });
  const server = app.listen(port, "0.0.0.0", () => {
    log("Application started", { service: "aiops-demo-app", environment: process.env.NODE_ENV ?? "development" });
    log("Server listening", { port, host: "0.0.0.0" });
  });
  server.once("error", (error) => {
    console.error(JSON.stringify({ level: "error", event: "Application startup failed", message: error.message }));
    process.exitCode = 1;
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("Graceful shutdown started", { signal });
    server.close((error) => {
      if (error) {
        console.error(JSON.stringify({ level: "error", event: "Graceful shutdown failed", message: error.message }));
        process.exitCode = 1;
      } else {
        log("Graceful shutdown complete");
      }
    });
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  console.error(JSON.stringify({ level: "error", event: "Application startup failed", message }));
  process.exitCode = 1;
}
