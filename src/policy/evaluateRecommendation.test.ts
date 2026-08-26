import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRecommendation } from "./evaluateRecommendation";
import type { AIRecommendation } from "../ai/analyzeIncident";
import type { IncidentContext } from "../investigation/collectContext";

function ctx(overrides: Partial<IncidentContext> = {}): IncidentContext {
  return {
    instanceId: "i-1234567890abcdef0",
    instanceState: "running",
    instanceType: "t3.micro",
    availabilityZone: "us-east-1a",
    privateIp: "10.0.0.10",
    publicIp: "203.0.113.10",
    healthStatus: "ok",
    cpuUtilization: 95,
    ...overrides
  };
}

function rec(overrides: Partial<AIRecommendation> = {}): AIRecommendation {
  return {
    severity: "HIGH",
    diagnosis: "CPU saturation detected",
    confidence: 0.95,
    recommendedAction: "restart_application",
    reason: "Healthy instance with sustained high CPU",
    requiresApproval: false,
    ...overrides
  };
}

// ── Approved path ─────────────────────────────────────────────────────────────

test("approves restart when all conditions are met", () => {
  const d = evaluateRecommendation(ctx(), rec());
  assert.equal(d.decision, "APPROVED");
  assert.equal(d.action, "restart_application");
});

test("approves no_action unconditionally", () => {
  const d = evaluateRecommendation(
    ctx({ instanceState: "stopped", healthStatus: "impaired", cpuUtilization: 0 }),
    rec({ recommendedAction: "no_action", confidence: 0.1, requiresApproval: true })
  );
  assert.equal(d.decision, "APPROVED");
  assert.equal(d.action, "no_action");
});

// ── Rejected paths ────────────────────────────────────────────────────────────

test("rejects unsupported action", () => {
  const d = evaluateRecommendation(
    ctx(),
    rec({ recommendedAction: "reboot_instance" as AIRecommendation["recommendedAction"] })
  );
  assert.equal(d.decision, "REJECTED");
  assert.match(d.reason, /not permitted/);
});

test("rejects restart when instance is not running", () => {
  const d = evaluateRecommendation(ctx({ instanceState: "stopped" }), rec());
  assert.equal(d.decision, "REJECTED");
  assert.match(d.reason, /running/);
});

test("rejects restart when instance is unhealthy", () => {
  const d = evaluateRecommendation(ctx({ healthStatus: "impaired" }), rec());
  assert.equal(d.decision, "REJECTED");
  assert.match(d.reason, /healthy/);
});

test("rejects restart when CPU is at or below alarm threshold", () => {
  const d = evaluateRecommendation(ctx({ cpuUtilization: 70 }), rec());
  assert.equal(d.decision, "REJECTED");
  assert.match(d.reason, /threshold/);
});

test("rejects restart when CPU utilization is missing", () => {
  const d = evaluateRecommendation(ctx({ cpuUtilization: undefined }), rec());
  assert.equal(d.decision, "REJECTED");
  assert.match(d.reason, /threshold/);
});

// ── Approval required paths ───────────────────────────────────────────────────

test("requires approval when confidence is below 0.90", () => {
  const d = evaluateRecommendation(ctx(), rec({ confidence: 0.89, requiresApproval: false }));
  assert.equal(d.decision, "APPROVAL_REQUIRED");
  assert.match(d.reason, /confidence/);
});

test("requires approval when AI sets requiresApproval true even with high confidence", () => {
  const d = evaluateRecommendation(ctx(), rec({ confidence: 0.99, requiresApproval: true }));
  assert.equal(d.decision, "APPROVAL_REQUIRED");
  assert.match(d.reason, /human approval/);
});

// ── Safety: requiresApproval:false alone cannot authorize execution ───────────

test("requiresApproval:false does not bypass instance-state check", () => {
  const d = evaluateRecommendation(
    ctx({ instanceState: "stopped" }),
    rec({ requiresApproval: false })
  );
  assert.equal(d.decision, "REJECTED");
});

test("requiresApproval:false does not bypass health check", () => {
  const d = evaluateRecommendation(
    ctx({ healthStatus: "impaired" }),
    rec({ requiresApproval: false })
  );
  assert.equal(d.decision, "REJECTED");
});

test("requiresApproval:false does not bypass CPU threshold check", () => {
  const d = evaluateRecommendation(
    ctx({ cpuUtilization: 50 }),
    rec({ requiresApproval: false })
  );
  assert.equal(d.decision, "REJECTED");
});

test("requiresApproval:false does not bypass confidence check", () => {
  const d = evaluateRecommendation(
    ctx(),
    rec({ confidence: 0.5, requiresApproval: false })
  );
  assert.equal(d.decision, "APPROVAL_REQUIRED");
});
