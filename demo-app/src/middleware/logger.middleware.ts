import fs from "node:fs";
import path from "node:path";
import type { Request, Response, NextFunction } from "express";

const LOG_DIR = process.env.LOG_DIR ?? "/var/log/aiops-demo-app";
const LOG_FILE = path.join(LOG_DIR, "app.log");
const ERROR_FILE = path.join(LOG_DIR, "error.log");

function openStream(file: string): fs.WriteStream | null {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    return fs.createWriteStream(file, { flags: "a" });
  } catch {
    return null;
  }
}

const appStream = openStream(LOG_FILE);
const errorStream = openStream(ERROR_FILE);

function writeLine(stream: fs.WriteStream | null, record: Record<string, unknown>): void {
  if (!stream) return;
  try {
    stream.write(JSON.stringify(record) + "\n");
  } catch {
    // non-fatal — log file unavailable
  }
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const record: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
      type: "http_request",
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
      userAgent: req.get("user-agent") ?? null
    };

    writeLine(appStream, record);

    if (res.statusCode >= 500) {
      writeLine(errorStream, record);
    }
  });

  next();
}
