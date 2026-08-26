import type { EventBridgeEvent } from "aws-lambda";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { collectIncidentContext } from "../investigation/collectContext";
import { analyzeIncident } from "../ai/analyzeIncident";
import { evaluateRecommendation } from "../policy/evaluateRecommendation";
import { executeRemediation } from "../remediation/executeRemediation";

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

const region = process.env.AWS_REGION ?? "us-east-1";
const sns = new SNSClient({ region });
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

export const handler = async (
  event: EventBridgeEvent<"CloudWatch Alarm State Change", AlarmStateChange>
) => {
  console.log("AIOps Coordinator triggered");

  const alarmName = event.detail?.alarmName;
  const alarmState = event.detail?.state?.value;
  const alarmReason = event.detail?.state?.reason;

  console.log(`Alarm: ${alarmName} | State: ${alarmState}`);
  console.log(`Reason: ${alarmReason}`);

  const instanceId =
    event.detail?.configuration?.metrics?.[0]?.metricStat?.metric?.dimensions?.InstanceId;

  if (!instanceId) {
    throw new Error("Unable to determine affected EC2 instance from alarm event");
  }

  console.log(`Incident detected — affected instance: ${instanceId}`);

  // ── Investigate ───────────────────────────────────────────────────────────
  const context = await collectIncidentContext(instanceId);
  console.log("Incident context collected:", JSON.stringify(context, null, 2));

  // ── AI Analysis ───────────────────────────────────────────────────────────
  const recommendation = await analyzeIncident(context);
  console.log("AI recommendation generated:", JSON.stringify(recommendation, null, 2));

  // ── Policy ────────────────────────────────────────────────────────────────
  const policyDecision = evaluateRecommendation(context, recommendation);
  console.log(`Policy decision: ${policyDecision.decision} — ${policyDecision.reason}`);

  // ── Remediation (only when APPROVED) ─────────────────────────────────────
  let remediationResult;

  if (policyDecision.decision === "APPROVED") {
    console.log("Remediation started");
    remediationResult = await executeRemediation(context, policyDecision.action);
    console.log("Remediation completed:", JSON.stringify(remediationResult, null, 2));

    if (remediationResult.status === "RESOLVED") {
      console.log("Verification result: RESOLVED");
      await publishNotification({
        subject: "AIOps Incident Resolved",
        message: [
          "AIOps Incident Resolved",
          "",
          `Instance:   ${instanceId}`,
          `Incident:   High CPU utilization`,
          `Action:     ${remediationResult.action}`,
          `CPU before: ${remediationResult.cpuBefore?.toFixed(1) ?? "unknown"}%`,
          `CPU after:  ${remediationResult.cpuAfter?.toFixed(1) ?? "unknown"}%`,
          `Status:     RESOLVED`
        ].join("\n")
      });
    } else {
      console.log("Verification result: REMEDIATION_FAILED — escalating");
      await publishNotification({
        subject: "AIOps Incident Escalated",
        message: [
          "AIOps Incident Escalated — Engineer Intervention Required",
          "",
          `Instance:   ${instanceId}`,
          `Incident:   High CPU utilization`,
          `Action:     ${remediationResult.action}`,
          `Reason:     ${remediationResult.reason}`,
          `CPU before: ${remediationResult.cpuBefore?.toFixed(1) ?? "unknown"}%`,
          `CPU after:  ${remediationResult.cpuAfter?.toFixed(1) ?? "unknown"}%`,
          `Status:     ENGINEER_INTERVENTION_REQUIRED`
        ].join("\n")
      });
    }
  } else {
    console.log(`Remediation skipped — policy decision: ${policyDecision.decision}`);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      alarmName,
      alarmState,
      instanceId,
      recommendation,
      policyDecision,
      remediationResult
    })
  };
};

async function publishNotification(params: {
  subject: string;
  message: string;
}): Promise<void> {
  if (!SNS_TOPIC_ARN) {
    console.log("SNS_TOPIC_ARN not configured — skipping notification");
    return;
  }
  try {
    await sns.send(
      new PublishCommand({
        TopicArn: SNS_TOPIC_ARN,
        Subject: params.subject,
        Message: params.message
      })
    );
    console.log(`SNS notification published: ${params.subject}`);
  } catch (error) {
    console.error("Failed to publish SNS notification:", (error as Error).message);
  }
}
