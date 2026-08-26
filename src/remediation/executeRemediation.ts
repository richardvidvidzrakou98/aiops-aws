import {
  SSMClient,
  SendCommandCommand,
  GetCommandInvocationCommand
} from "@aws-sdk/client-ssm";
import {
  CloudWatchClient,
  GetMetricStatisticsCommand
} from "@aws-sdk/client-cloudwatch";

import type { AIRecommendation } from "../ai/analyzeIncident";
import type { IncidentContext } from "../investigation/collectContext";

const region = process.env.AWS_REGION ?? "us-east-1";
const ssm = new SSMClient({ region });
const cloudWatch = new CloudWatchClient({ region });

// Predefined command map — Gemini never supplies shell commands
const REMEDIATION_COMMANDS: Record<string, string> = {
  restart_application: "systemctl restart aiops-demo-app"
};

const CPU_ALARM_THRESHOLD = 70;

export type RemediationStatus = "RESOLVED" | "REMEDIATION_FAILED" | "SKIPPED";

export interface RemediationResult {
  action: AIRecommendation["recommendedAction"];
  commandId?: string;
  status: RemediationStatus;
  reason: string;
  cpuBefore?: number;
  cpuAfter?: number;
}

export async function executeRemediation(
  context: IncidentContext,
  action: AIRecommendation["recommendedAction"]
): Promise<RemediationResult> {
  if (action === "no_action") {
    return { action, status: "SKIPPED", reason: "No remediation action required" };
  }

  const command = REMEDIATION_COMMANDS[action];
  if (!command) {
    throw new Error(`Unsupported remediation action: ${action}`);
  }

  const cpuBefore = context.cpuUtilization;

  // ── Execute via SSM ───────────────────────────────────────────────────────
  const sendResponse = await ssm.send(
    new SendCommandCommand({
      InstanceIds: [context.instanceId],
      DocumentName: "AWS-RunShellScript",
      Parameters: { commands: [command] },
      Comment: `AIOps autonomous remediation: ${action}`
    })
  );

  const commandId = sendResponse.Command?.CommandId;
  if (!commandId) {
    throw new Error("SSM command was not created");
  }

  // ── Poll for SSM command completion (max 60 s) ────────────────────────────
  const ssmStatus = await pollSsmCommand(commandId, context.instanceId, 60);
  if (ssmStatus !== "Success") {
    return {
      action,
      commandId,
      status: "REMEDIATION_FAILED",
      reason: `SSM command did not succeed (status: ${ssmStatus})`,
      cpuBefore
    };
  }

  // ── Verify recovery: wait for a fresh post-remediation CloudWatch datapoint ─
  const remediationStartedAt = Date.now();
  const cpuAfter = await waitForRecoveredCpu(
    context.instanceId,
    remediationStartedAt,
    CPU_ALARM_THRESHOLD,
    360
  );

  if (cpuAfter === undefined || cpuAfter > CPU_ALARM_THRESHOLD) {
    return {
      action,
      commandId,
      status: "REMEDIATION_FAILED",
      reason: `CPU utilization remains elevated after restart (${cpuAfter?.toFixed(1) ?? "unknown"}%)`,
      cpuBefore,
      cpuAfter
    };
  }

  return {
    action,
    commandId,
    status: "RESOLVED",
    reason: `Application restarted successfully. CPU dropped from ${cpuBefore?.toFixed(1) ?? "unknown"}% to ${cpuAfter.toFixed(1)}%`,
    cpuBefore,
    cpuAfter
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function pollSsmCommand(
  commandId: string,
  instanceId: string,
  timeoutSeconds: number
): Promise<string> {
  const deadline = Date.now() + timeoutSeconds * 1_000;

  while (Date.now() < deadline) {
    await sleep(5_000);
    try {
      const result = await ssm.send(
        new GetCommandInvocationCommand({ CommandId: commandId, InstanceId: instanceId })
      );
      const status = result.Status ?? "Pending";
      if (["Success", "Failed", "Cancelled", "TimedOut"].includes(status)) {
        return status;
      }
    } catch {
      // InvocationDoesNotExist — command not yet registered, keep polling
    }
  }

  return "TimedOut";
}

async function waitForRecoveredCpu(
  instanceId: string,
  remediationStartedAt: number,
  threshold: number,
  timeoutSeconds: number
): Promise<number | undefined> {
  const deadline = Date.now() + timeoutSeconds * 1_000;

  while (Date.now() < deadline) {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 10 * 60 * 1_000);

    const response = await cloudWatch.send(
      new GetMetricStatisticsCommand({
        Namespace: "AWS/EC2",
        MetricName: "CPUUtilization",
        Dimensions: [{ Name: "InstanceId", Value: instanceId }],
        StartTime: startTime,
        EndTime: endTime,
        Period: 300,
        Statistics: ["Average"]
      })
    );

    const datapoints = (response.Datapoints ?? [])
      .filter(p => p.Timestamp)
      .sort((a, b) => b.Timestamp!.getTime() - a.Timestamp!.getTime());

    const freshDatapoint = datapoints.find(
      p => p.Timestamp!.getTime() > remediationStartedAt
    );

    if (freshDatapoint?.Average !== undefined) {
      console.log(
        `Fresh CloudWatch CPU datapoint received: ${freshDatapoint.Average.toFixed(1)}%`
      );
      return freshDatapoint.Average;
    }

    await sleep(30_000);
  }

  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
