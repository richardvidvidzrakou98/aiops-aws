import {
  SSMClient,
  SendCommandCommand
} from "@aws-sdk/client-ssm";

import type { AIRecommendation } from "../ai/analyzeIncident";
import type { IncidentContext } from "../investigation/collectContext";

const region = process.env.AWS_REGION || "us-east-1";

const ssm = new SSMClient({ region });

export interface RemediationResult {
  action: AIRecommendation["recommendedAction"];
  commandId?: string;
  status: "EXECUTED" | "SKIPPED";
  reason: string;
}

export async function executeRemediation(
  context: IncidentContext,
  action: AIRecommendation["recommendedAction"]
): Promise<RemediationResult> {
  if (action === "no_action") {
    return {
      action,
      status: "SKIPPED",
      reason: "No remediation action required"
    };
  }

  if (action !== "restart_application") {
    throw new Error(
      `Unsupported remediation action: ${action}`
    );
  }

  const command = new SendCommandCommand({
    InstanceIds: [context.instanceId],
    DocumentName: "AWS-RunShellScript",
    Parameters: {
      commands: [
        "sudo systemctl restart nginx"
      ]
    }
  });

  const response = await ssm.send(command);

  if (!response.Command?.CommandId) {
    throw new Error(
      "SSM command was not created"
    );
  }

  return {
    action,
    commandId: response.Command.CommandId,
    status: "EXECUTED",
    reason:
      "Pre-approved application restart command sent through SSM"
  };
}