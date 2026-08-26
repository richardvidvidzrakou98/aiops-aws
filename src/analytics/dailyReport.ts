import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { collectSystemMetrics } from "./collectMetrics";
import { aggregateApplicationLogs } from "./aggregateLogs";
import { analyzeDailyReport } from "../ai/analyzeDailyReport";

const sns = new SNSClient({ region: process.env.AWS_REGION ?? "us-east-1" });
const REPORTS_TOPIC_ARN = process.env.REPORTS_TOPIC_ARN;
const INSTANCE_ID = process.env.EC2_INSTANCE_ID;
const APP_LOG_GROUP = process.env.APP_LOG_GROUP ?? "/aiops/demo-app/application";

export const handler = async () => {
  console.log("AIOps Analytics Engine triggered");

  if (!INSTANCE_ID) throw new Error("EC2_INSTANCE_ID environment variable is not set");

  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1_000);
  const reportDate = startTime.toISOString().slice(0, 10);

  console.log(`Collecting metrics and logs for ${reportDate}`);

  // ── Deterministic aggregation ─────────────────────────────────────────────
  const [systemMetrics, logStats] = await Promise.all([
    collectSystemMetrics(INSTANCE_ID, startTime, endTime),
    aggregateApplicationLogs(APP_LOG_GROUP, startTime, endTime)
  ]);

  const stats = {
    period: reportDate,
    requests: {
      total: logStats.totalRequests,
      successful: logStats.successfulRequests,
      clientErrors: logStats.clientErrors,
      serverErrors: logStats.serverErrors,
      errorRate: logStats.errorRate
    },
    performance: {
      avgResponseTimeMs: logStats.avgResponseTimeMs,
      p95ResponseTimeMs: logStats.p95ResponseTimeMs,
      topEndpoints: logStats.topEndpoints,
      topErrors: logStats.topErrors
    },
    system: {
      cpu: systemMetrics.cpu,
      memory: systemMetrics.memory,
      disk: systemMetrics.disk,
      network: systemMetrics.network
    }
  };

  console.log("Aggregated stats:", JSON.stringify(stats, null, 2));

  // ── AI analysis ───────────────────────────────────────────────────────────
  const insights = await analyzeDailyReport(stats);
  console.log("AI insights generated:", JSON.stringify(insights, null, 2));

  // ── Format and publish report ─────────────────────────────────────────────
  const report = formatReport(reportDate, stats, insights);

  if (!REPORTS_TOPIC_ARN) {
    console.log("REPORTS_TOPIC_ARN not configured — skipping SNS publish");
    console.log("Report:\n", report);
    return;
  }

  await sns.send(new PublishCommand({
    TopicArn: REPORTS_TOPIC_ARN,
    Subject: `AIOps Daily Report — ${reportDate}`,
    Message: report
  }));

  console.log(`Daily report published to SNS for ${reportDate}`);
};

function formatReport(
  date: string,
  stats: {
    requests: { total: number; successful: number; clientErrors: number; serverErrors: number; errorRate: number };
    performance: { avgResponseTimeMs: number; p95ResponseTimeMs: number; topEndpoints: { path: string; count: number; avgDurationMs: number; p95DurationMs: number }[]; topErrors: { path: string; statusCode: number; count: number }[] };
    system: { cpu: { average: number; peak: number }; memory: { average: number; peak: number }; disk: { average: number; peak: number }; network: { totalBytesIn: number; totalBytesOut: number } };
  },
  insights: { summary: string; performanceTrends: string; anomalies: string; topIssues: string; recommendations: string }
): string {
  const mb = (bytes: number) => (bytes / 1_048_576).toFixed(1) + " MB";

  return [
    `AIOps Daily Report — ${date}`,
    "=".repeat(50),
    "",
    "SUMMARY",
    insights.summary,
    "",
    "TRAFFIC",
    `  Total requests:      ${stats.requests.total.toLocaleString()}`,
    `  Successful:          ${stats.requests.successful.toLocaleString()}`,
    `  Client errors (4xx): ${stats.requests.clientErrors.toLocaleString()}`,
    `  Server errors (5xx): ${stats.requests.serverErrors.toLocaleString()}`,
    `  Error rate:          ${stats.requests.errorRate}%`,
    "",
    "PERFORMANCE",
    `  Avg response time:   ${stats.performance.avgResponseTimeMs} ms`,
    `  P95 response time:   ${stats.performance.p95ResponseTimeMs} ms`,
    "",
    "TOP ENDPOINTS",
    ...stats.performance.topEndpoints.slice(0, 5).map(e =>
      `  ${e.path.padEnd(30)} ${String(e.count).padStart(6)} reqs  avg ${e.avgDurationMs} ms  p95 ${e.p95DurationMs} ms`
    ),
    "",
    "TOP ERRORS",
    stats.performance.topErrors.length === 0
      ? "  None"
      : stats.performance.topErrors.slice(0, 5).map(e =>
          `  ${e.path.padEnd(30)} HTTP ${e.statusCode}  ${e.count} occurrences`
        ).join("\n"),
    "",
    "INFRASTRUCTURE",
    `  CPU    — avg ${stats.system.cpu.average}%   peak ${stats.system.cpu.peak}%`,
    `  Memory — avg ${stats.system.memory.average}%   peak ${stats.system.memory.peak}%`,
    `  Disk   — avg ${stats.system.disk.average}%   peak ${stats.system.disk.peak}%`,
    `  Network in:  ${mb(stats.system.network.totalBytesIn)}`,
    `  Network out: ${mb(stats.system.network.totalBytesOut)}`,
    "",
    "AI INSIGHTS",
    "",
    "Performance Trends",
    insights.performanceTrends,
    "",
    "Anomalies",
    insights.anomalies,
    "",
    "Top Issues",
    insights.topIssues,
    "",
    "Recommendations",
    insights.recommendations,
    "",
    "=".repeat(50),
    `Generated by AIOps Analytics Engine at ${new Date().toISOString()}`
  ].join("\n");
}

