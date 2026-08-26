import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateRecommendation
} from "./evaluateRecommendation";

import type { AIRecommendation } from "../ai/analyzeIncident";
import type { IncidentContext } from "../investigation/collectContext";

const baseContext: IncidentContext = {
  instanceId: "i-1234567890",
  instanceState: "running",
  instanceType: "t3.micro",
  availabilityZone: "us-east-1a",
  privateIp: "10.0.0.10",
  publicIp: "1.2.3.4",
  healthStatus: "ok",
  cpuUtilization: 85
};

const baseRecommendation: AIRecommendation = {
  severity: "HIGH",
  diagnosis: "High CPU utilization",
  confidence: 0.95,
  recommendedAction: "restart_application",
  reason: "CPU utilization is above the configured threshold",
  requiresApproval: false
};

// ─────────────────────────────────────────────────────────────────────────────
// APPROVED
// ─────────────────────────────────────────────────────────────────────────────

test("approves restart when all deterministic conditions are met", () => {
  const result = evaluateRecommendation(
    baseContext,
    baseRecommendation
  );

  assert.equal(result.decision, "APPROVED");
  assert.equal(result.action, "restart_application");
});

test("approves no_action unconditionally", () => {
  const recommendation: AIRecommendation = {
    ...baseRecommendation,
    recommendedAction: "no_action"
  };

  const context: IncidentContext = {
    ...baseContext,
    cpuUtilization: 10
  };

  const result = evaluateRecommendation(context, recommendation);

  assert.equal(result.decision, "APPROVED");
  assert.equal(result.action, "no_action");
});

// AI confidence is advisory only

test("approves restart when AI confidence is below 0.90", () => {
  const recommendation: AIRecommendation = {
    ...baseRecommendation,
    confidence: 0.85
  };

  const result = evaluateRecommendation(
    baseContext,
    recommendation
  );

  assert.equal(result.decision, "APPROVED");
  assert.equal(result.action, "restart_application");
});

test("approves restart when AI confidence is very low but deterministic checks pass", () => {
  const recommendation: AIRecommendation = {
    ...baseRecommendation,
    confidence: 0.50
  };

  const result = evaluateRecommendation(
    baseContext,
    recommendation
  );

  assert.equal(result.decision, "APPROVED");
  assert.equal(result.action, "restart_application");
});

// AI requiresApproval is advisory only

test("AI requiresApproval flag does not override deterministic policy", () => {
  const recommendation: AIRecommendation = {
    ...baseRecommendation,
    confidence: 0.95,
    requiresApproval: true
  };

  const result = evaluateRecommendation(
    baseContext,
    recommendation
  );

  assert.equal(result.decision, "APPROVED");
  assert.equal(result.action, "restart_application");
});

test("AI requiresApproval with low confidence does not block a safe restart", () => {
  const recommendation: AIRecommendation = {
    ...baseRecommendation,
    confidence: 0.70,
    requiresApproval: true
  };

  const result = evaluateRecommendation(
    baseContext,
    recommendation
  );

  assert.equal(result.decision, "APPROVED");
  assert.equal(result.action, "restart_application");
});

// ─────────────────────────────────────────────────────────────────────────────
// REJECTED — ACTION
// ─────────────────────────────────────────────────────────────────────────────

test("rejects unsupported action", () => {
  const recommendation = {
    ...baseRecommendation,
    recommendedAction: "terminate_instance"
  } as unknown as AIRecommendation;

  const result = evaluateRecommendation(
    baseContext,
    recommendation
  );

  assert.equal(result.decision, "REJECTED");
  assert.equal(result.action, "terminate_instance");
});

// ─────────────────────────────────────────────────────────────────────────────
// REJECTED — INSTANCE STATE
// ─────────────────────────────────────────────────────────────────────────────

test("rejects restart when instance is not running", () => {
  const context: IncidentContext = {
    ...baseContext,
    instanceState: "stopped"
  };

  const result = evaluateRecommendation(
    context,
    baseRecommendation
  );

  assert.equal(result.decision, "REJECTED");
  assert.match(result.reason, /running instances/i);
});

test("AI requiresApproval false does not bypass instance-state check", () => {
  const context: IncidentContext = {
    ...baseContext,
    instanceState: "stopped"
  };

  const recommendation: AIRecommendation = {
    ...baseRecommendation,
    requiresApproval: false
  };

  const result = evaluateRecommendation(
    context,
    recommendation
  );

  assert.equal(result.decision, "REJECTED");
});

// ─────────────────────────────────────────────────────────────────────────────
// REJECTED — INSTANCE HEALTH
// ─────────────────────────────────────────────────────────────────────────────

test("rejects restart when instance is unhealthy", () => {
  const context: IncidentContext = {
    ...baseContext,
    healthStatus: "impaired"
  };

  const result = evaluateRecommendation(
    context,
    baseRecommendation
  );

  assert.equal(result.decision, "REJECTED");
  assert.match(result.reason, /healthy EC2 instance/i);
});

test("AI requiresApproval false does not bypass health check", () => {
  const context: IncidentContext = {
    ...baseContext,
    healthStatus: "impaired"
  };

  const recommendation: AIRecommendation = {
    ...baseRecommendation,
    requiresApproval: false
  };

  const result = evaluateRecommendation(
    context,
    recommendation
  );

  assert.equal(result.decision, "REJECTED");
});

// ─────────────────────────────────────────────────────────────────────────────
// REJECTED — CPU THRESHOLD
// ─────────────────────────────────────────────────────────────────────────────

test("rejects restart when CPU is at or below alarm threshold", () => {
  const context: IncidentContext = {
    ...baseContext,
    cpuUtilization: 70
  };

  const result = evaluateRecommendation(
    context,
    baseRecommendation
  );

  assert.equal(result.decision, "REJECTED");
  assert.match(result.reason, /70%/);
});

test("rejects restart when CPU utilization is below alarm threshold", () => {
  const context: IncidentContext = {
    ...baseContext,
    cpuUtilization: 45
  };

  const result = evaluateRecommendation(
    context,
    baseRecommendation
  );

  assert.equal(result.decision, "REJECTED");
});

test("rejects restart when CPU utilization is missing", () => {
  const context: IncidentContext = {
    ...baseContext,
    cpuUtilization: undefined
  };

  const result = evaluateRecommendation(
    context,
    baseRecommendation
  );

  assert.equal(result.decision, "REJECTED");
  assert.match(result.reason, /CPU utilization/i);
});

test("AI requiresApproval false does not bypass CPU threshold check", () => {
  const context: IncidentContext = {
    ...baseContext,
    cpuUtilization: 50
  };

  const recommendation: AIRecommendation = {
    ...baseRecommendation,
    requiresApproval: false
  };

  const result = evaluateRecommendation(
    context,
    recommendation
  );

  assert.equal(result.decision, "REJECTED");
});