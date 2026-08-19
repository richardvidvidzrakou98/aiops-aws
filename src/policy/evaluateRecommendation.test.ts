import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateRecommendation,
  type PolicyDecision
} from "./evaluateRecommendation";
import type { AIRecommendation } from "../ai/analyzeIncident";
import type { IncidentContext } from "../investigation/collectContext";

function createContext(
  overrides: Partial<IncidentContext> = {}
): IncidentContext {
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

function createRecommendation(
  overrides: Partial<AIRecommendation> = {}
): AIRecommendation {
  return {
    severity: "HIGH",
    diagnosis: "CPU saturation detected",
    confidence: 0.92,
    recommendedAction: "restart_application",
    reason: "Healthy instance with sustained high CPU",
    requiresApproval: false,
    ...overrides
  };
}

function assertDecision(
  actual: PolicyDecision,
  expected: PolicyDecision
): void {
  assert.deepEqual(actual, expected);
}

test(
  "returns approval required when AI marks the action for review",
  () => {
    const decision = evaluateRecommendation(
      createContext(),
      createRecommendation({ requiresApproval: true })
    );

    assertDecision(decision, {
      decision: "APPROVAL_REQUIRED",
      action: "restart_application",
      reason: "AI recommendation requires human approval"
    });
  }
);

test(
  "approves an allowed restart when the instance is running and healthy",
  () => {
    const decision = evaluateRecommendation(
      createContext(),
      createRecommendation()
    );

    assertDecision(decision, {
      decision: "APPROVED",
      action: "restart_application",
      reason:
        "Action is allowed and meets policy requirements"
    });
  }
);

test(
  "rejects restart when the instance is not running",
  () => {
    const decision = evaluateRecommendation(
      createContext({ instanceState: "stopped" }),
      createRecommendation()
    );

    assertDecision(decision, {
      decision: "REJECTED",
      action: "restart_application",
      reason:
        "Restart automation is only allowed for running instances"
    });
  }
);

test(
  "rejects restart when the instance is unhealthy",
  () => {
    const decision = evaluateRecommendation(
      createContext({ healthStatus: "impaired" }),
      createRecommendation()
    );

    assertDecision(decision, {
      decision: "REJECTED",
      action: "restart_application",
      reason:
        "Restart automation requires a healthy EC2 instance"
    });
  }
);
