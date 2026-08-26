import type { AIRecommendation } from "../ai/analyzeIncident";
import type { IncidentContext } from "../investigation/collectContext";

export interface PolicyDecision {
  decision: "APPROVED" | "APPROVAL_REQUIRED" | "REJECTED";
  action: AIRecommendation["recommendedAction"];
  reason: string;
}

// Mirrors the CloudWatch alarm threshold in template.yaml
const CPU_ALARM_THRESHOLD = 70;
const MIN_CONFIDENCE = 0.90;

const allowedActions: Array<AIRecommendation["recommendedAction"]> = [
  "restart_application",
  "no_action"
];

export function evaluateRecommendation(
  context: IncidentContext,
  recommendation: AIRecommendation
): PolicyDecision {
  const action = recommendation.recommendedAction;

  // 1. Action must be on the allow-list — policy rejects anything else
  if (!allowedActions.includes(action)) {
    return {
      decision: "REJECTED",
      action,
      reason: "Action is not permitted by policy"
    };
  }

  // 2. no_action is always safe to approve immediately
  if (action === "no_action") {
    return {
      decision: "APPROVED",
      action,
      reason: "No remediation action required"
    };
  }

  // ── restart_application safety checks ────────────────────────────────────
  // The policy independently verifies every condition.
  // AI's requiresApproval is advisory only — it cannot override these checks.

  if (context.instanceState !== "running") {
    return {
      decision: "REJECTED",
      action,
      reason: "Restart automation is only allowed for running instances"
    };
  }

  if (context.healthStatus !== "ok") {
    return {
      decision: "REJECTED",
      action,
      reason: "Restart automation requires a healthy EC2 instance"
    };
  }

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

  if (recommendation.confidence < MIN_CONFIDENCE) {
    return {
      decision: "APPROVAL_REQUIRED",
      action,
      reason: `AI confidence ${recommendation.confidence.toFixed(2)} is below the required ${MIN_CONFIDENCE} threshold`
    };
  }

  // 3. AI explicitly flagged human review — honour it even when all other
  //    conditions pass, so the operator retains override capability.
  if (recommendation.requiresApproval) {
    return {
      decision: "APPROVAL_REQUIRED",
      action,
      reason: "AI recommendation requires human approval"
    };
  }

  return {
    decision: "APPROVED",
    action,
    reason: "Action is allowed and meets all policy requirements"
  };
}
