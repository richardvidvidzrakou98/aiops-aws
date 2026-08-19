import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "./app";

function startServer() {
  const server = createApp({ controlToken: "test-token", log: () => undefined }).listen(0, "127.0.0.1");
  return new Promise<{ baseUrl: string; close: () => void }>((resolve) => {
    server.once("listening", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ baseUrl: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

test("health and system metadata", async (t) => {
  const originalVersion = process.env.APP_VERSION;
  process.env.APP_VERSION = "test-sha";
  const { baseUrl, close } = await startServer();
  t.after(() => { process.env.APP_VERSION = originalVersion; close(); });

  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");

  const ready = await fetch(`${baseUrl}/health/ready`);
  assert.equal(ready.status, 200);

  const system = await fetch(`${baseUrl}/api/system`);
  assert.equal(system.status, 200);
  const payload = await system.json() as { service: string; version: string };
  assert.equal(payload.service, "aiops-demo-app");
  assert.equal(payload.version, "test-sha");
});

test("internal simulate/cpu requires token", async (t) => {
  const { baseUrl, close } = await startServer();
  t.after(close);

  const unauthorized = await fetch(`${baseUrl}/internal/simulate/cpu`, { method: "POST" });
  assert.equal(unauthorized.status, 401);

  const wrongToken = await fetch(`${baseUrl}/internal/simulate/cpu`, {
    method: "POST",
    headers: { authorization: "Bearer wrong" }
  });
  assert.equal(wrongToken.status, 401);
});

test("demo proxy simulation lifecycle", async (t) => {
  const { baseUrl, close } = await startServer();
  t.after(close);

  // Initial state: not active
  const state = await fetch(`${baseUrl}/api/demo/simulate/cpu`);
  assert.equal(state.status, 200);
  assert.equal((await state.json()).active, false);

  // Start simulation
  const start = await fetch(`${baseUrl}/api/demo/simulate/cpu`, { method: "POST" });
  assert.equal(start.status, 202);
  const startBody = await start.json() as { status: string; duration: number };
  assert.equal(startBody.status, "started");
  assert.ok(startBody.duration > 0);

  // Concurrent start returns 409
  const conflict = await fetch(`${baseUrl}/api/demo/simulate/cpu`, { method: "POST" });
  assert.equal(conflict.status, 409);

  // State now active
  const activeState = await fetch(`${baseUrl}/api/demo/simulate/cpu`);
  assert.equal((await activeState.json()).active, true);

  // Stop simulation
  const stop = await fetch(`${baseUrl}/api/demo/simulate/cpu/stop`, { method: "POST" });
  assert.equal(stop.status, 200);
  const stopBody = await stop.json() as { status: string; wasActive: boolean };
  assert.equal(stopBody.status, "stopped");
  assert.equal(stopBody.wasActive, true);

  // State back to inactive
  const idleState = await fetch(`${baseUrl}/api/demo/simulate/cpu`);
  assert.equal((await idleState.json()).active, false);
});

test("demo proxy rejects invalid duration", async (t) => {
  const { baseUrl, close } = await startServer();
  t.after(close);

  const bad = await fetch(`${baseUrl}/api/demo/simulate/cpu?duration=notanumber`, { method: "POST" });
  assert.equal(bad.status, 400);
});

test("homepage does not expose control token", async (t) => {
  const { baseUrl, close } = await startServer();
  t.after(close);

  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(!html.includes("test-token"), "control token must not appear in HTML");
  assert.ok(!html.includes("DEMO_CONTROL_TOKEN"), "token env var name must not appear in HTML");
  assert.ok(html.includes("/api/system"), "page should reference /api/system");
  assert.ok(html.includes("/api/demo/simulate/cpu"), "page should reference demo proxy route");
});

test("internal simulate/cpu works with correct token", async (t) => {
  const { baseUrl, close } = await startServer();
  t.after(close);

  const start = await fetch(`${baseUrl}/internal/simulate/cpu`, {
    method: "POST",
    headers: { authorization: "Bearer test-token" }
  });
  assert.equal(start.status, 202);

  // Clean up
  await fetch(`${baseUrl}/internal/simulate/cpu/stop`, {
    method: "POST",
    headers: { authorization: "Bearer test-token" }
  });
});
