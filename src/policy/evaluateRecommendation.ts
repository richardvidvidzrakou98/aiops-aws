import type { AIRecommendation } from "../ai/analyzeIncident";
import type { IncidentContext } from "../investigation/collectContext";

export interface PolicyDecision {
  decision: "APPROVED" | "APPROVAL_REQUIRED" | "REJECTED";
  action: AIRecommendation["recommendedAction"];
  reason: string;
}

// Mirrors the CloudWatch alarm threshold in template.yaml
const CPU_ALARM_THRESHOLD = 70;

const allowedActions: Array<AIRecommendation["recommendedAction"]> = [
  "restart_application",
  "no_action"
];

export function evaluateRecommendation(
  context: IncidentContext,
  recommendation: AIRecommendation
): PolicyDecision {
  const action = recommendation.recommendedAction;

  // 1. Action must be on the allow-list
  if (!allowedActions.includes(action)) {
    return {
      decision: "REJECTED",
      action,
      reason: "Action is not permitted by policy"
    };
  }

  // 2. no_action is always safe
  if (action === "no_action") {
    return {
      decision: "APPROVED",
      action,
      reason: "No remediation action required"
    };
  }

  // 3. Restart is only allowed for running instances
  if (context.instanceState !== "running") {
    return {
      decision: "REJECTED",
      action,
      reason: "Restart automation is only allowed for running instances"
    };
  }

  // 4. Restart requires a healthy EC2 instance
  if (context.healthStatus !== "ok") {
    return {
      decision: "REJECTED",
      action,
      reason: "Restart automation requires a healthy EC2 instance"
    };
  }

  // 5. CPU must still exceed the trusted CloudWatch threshold
  if (
    context.cpuUtilization === undefined ||
    context.cpuUtilization <= CPU_ALARM_THRESHOLD
  ) {
    return {
      decision: "REJECTED",
      action,
      reason: `CPU utilization must exceed the alarm threshold (${CPU_ALARM_THRESHOLD}%) to justify autonomous restart`
    };
  }

  // AI confidence is advisory only.
  // The policy does not allow or deny remediation based on model confidence.
  return {
    decision: "APPROVED",
    action,
    reason: `Action is allowlisted and all deterministic safety checks passed. AI confidence: ${recommendation.confidence.toFixed(2)}`
  };
}