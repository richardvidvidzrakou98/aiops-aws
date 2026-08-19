import type { AIRecommendation } from "../ai/analyzeIncident";
import type { IncidentContext } from "../investigation/collectContext";

export interface PolicyDecision {
  decision:
    | "APPROVED"
    | "APPROVAL_REQUIRED"
    | "REJECTED";
  action: AIRecommendation["recommendedAction"];
  reason: string;
}

const autoExecutableActions: Array<
  AIRecommendation["recommendedAction"]
> = ["restart_application", "no_action"];

export function evaluateRecommendation(
  context: IncidentContext,
  recommendation: AIRecommendation
): PolicyDecision {
  if (
    !autoExecutableActions.includes(
      recommendation.recommendedAction
    )
  ) {
    return {
      decision: "REJECTED",
      action: recommendation.recommendedAction,
      reason: "Action is not permitted by policy"
    };
  }

  if (recommendation.requiresApproval) {
    return {
      decision: "APPROVAL_REQUIRED",
      action: recommendation.recommendedAction,
      reason:
        "AI recommendation requires human approval"
    };
  }

  if (
    recommendation.recommendedAction ===
      "restart_application"
  ) {
    if (context.instanceState !== "running") {
      return {
        decision: "REJECTED",
        action: recommendation.recommendedAction,
        reason:
          "Restart automation is only allowed for running instances"
      };
    }

    if (context.healthStatus !== "ok") {
      return {
        decision: "REJECTED",
        action: recommendation.recommendedAction,
        reason:
          "Restart automation requires a healthy EC2 instance"
      };
    }
  }

  return {
    decision: "APPROVED",
    action: recommendation.recommendedAction,
    reason:
      "Action is allowed and meets policy requirements"
  };
}
