import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "./app";

test("serves health and versioned system metadata", async (t) => {
  const originalVersion = process.env.APP_VERSION;
  process.env.APP_VERSION = "test-sha";
  const server = createApp({ controlToken: "test-token", log: () => undefined }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => {
    process.env.APP_VERSION = originalVersion;
    server.close();
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");

  const system = await fetch(`${baseUrl}/api/system`);
  assert.equal(system.status, 200);
  const payload = await system.json() as { service: string; version: string };
  assert.equal(payload.service, "aiops-demo-app");
  assert.equal(payload.version, "test-sha");

  const unauthorized = await fetch(`${baseUrl}/internal/simulate/cpu`, { method: "POST" });
  assert.equal(unauthorized.status, 401);
});
