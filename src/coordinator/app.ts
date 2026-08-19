import type { EventBridgeEvent } from "aws-lambda";
import { collectIncidentContext } from "../investigation/collectContext";
import { analyzeIncident } from "../ai/analyzeIncident";
import { evaluateRecommendation } from "../policy/evaluateRecommendation";

interface AlarmStateChange {
  alarmName?: string;
  state?: {
    value?: string;
    reason?: string;
    reasonData?: string;
  };
  configuration?: {
    metrics?: Array<{
      metricStat?: {
        metric?: {
          dimensions?: {
            InstanceId?: string;
          };
        };
      };
    }>;
  };
}

export const handler = async (
  event: EventBridgeEvent<
    "CloudWatch Alarm State Change",
    AlarmStateChange
  >
) => {
  console.log("AIOps Coordinator triggered");

  const alarmName = event.detail?.alarmName;
  const alarmState = event.detail?.state?.value;
  const alarmReason = event.detail?.state?.reason;

  console.log(`Alarm: ${alarmName}`);
  console.log(`State: ${alarmState}`);
  console.log(`Reason: ${alarmReason}`);

  const instanceId =
    event.detail?.configuration?.metrics?.[0]?.metricStat
      ?.metric?.dimensions?.InstanceId;

  if (!instanceId) {
    throw new Error(
      "Unable to determine affected EC2 instance from alarm event"
    );
  }

  console.log(`Affected instance: ${instanceId}`);

  const context = await collectIncidentContext(instanceId);

  const recommendation = await analyzeIncident(context);
  const policyDecision = evaluateRecommendation(
    context,
    recommendation
  );

  console.log(
    "AI recommendation:",
    JSON.stringify(recommendation, null, 2)
  );

  console.log(
    "Policy decision:",
    JSON.stringify(policyDecision, null, 2)
  );

  console.log(
    "Incident context:",
    JSON.stringify(context, null, 2)
  );

  return {
    statusCode: 200,
    body: JSON.stringify({
      alarmName,
      alarmState,
      alarmReason,
      context,
      recommendation,
      policyDecision
    })
  };
};