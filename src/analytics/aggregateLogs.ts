import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand
} from "@aws-sdk/client-cloudwatch-logs";

const logs = new CloudWatchLogsClient({ region: process.env.AWS_REGION ?? "us-east-1" });

export interface EndpointStat {
  path: string;
  count: number;
  errorCount: number;
  avgDurationMs: number;
  p95DurationMs: number;
}

export interface ErrorStat {
  path: string;
  statusCode: number;
  count: number;
}

export interface LogAggregation {
  totalRequests: number;
  successfulRequests: number;
  clientErrors: number;
  serverErrors: number;
  errorRate: number;
  avgResponseTimeMs: number;
  p95ResponseTimeMs: number;
  topEndpoints: EndpointStat[];
  topErrors: ErrorStat[];
}

async function runQuery(logGroup: string, query: string, startTime: Date, endTime: Date): Promise<Record<string, string>[]> {
  const start = await logs.send(new StartQueryCommand({
    logGroupName: logGroup,
    startTime: Math.floor(startTime.getTime() / 1000),
    endTime: Math.floor(endTime.getTime() / 1000),
    queryString: query
  }));

  const queryId = start.queryId!;
  const deadline = Date.now() + 55_000;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2_000));
    const result = await logs.send(new GetQueryResultsCommand({ queryId }));

    if (result.status === "Complete") {
      return (result.results ?? []).map(row =>
        Object.fromEntries(row.map(f => [f.field ?? "", f.value ?? ""]))
      );
    }
    if (result.status === "Failed" || result.status === "Cancelled") break;
  }

  return [];
}

export async function aggregateApplicationLogs(
  logGroup: string,
  startTime: Date,
  endTime: Date
): Promise<LogAggregation> {
  const [summaryRows, endpointRows, errorRows] = await Promise.all([
    runQuery(logGroup, `
      fields statusCode, durationMs
      | filter type = "http_request"
      | stats
          count() as total,
          count(statusCode < 400) as successful,
          count(statusCode >= 400 and statusCode < 500) as clientErrors,
          count(statusCode >= 500) as serverErrors,
          avg(durationMs) as avgDuration,
          pct(durationMs, 95) as p95Duration
    `, startTime, endTime),

    runQuery(logGroup, `
      fields path, statusCode, durationMs
      | filter type = "http_request"
      | stats
          count() as count,
          count(statusCode >= 400) as errorCount,
          avg(durationMs) as avgDuration,
          pct(durationMs, 95) as p95Duration
        by path
      | sort count desc
      | limit 10
    `, startTime, endTime),

    runQuery(logGroup, `
      fields path, statusCode
      | filter type = "http_request" and statusCode >= 400
      | stats count() as count by path, statusCode
      | sort count desc
      | limit 10
    `, startTime, endTime)
  ]);

  const s = summaryRows[0] ?? {};
  const total = Number(s["total"] ?? 0);
  const successful = Number(s["successful"] ?? 0);
  const clientErrors = Number(s["clientErrors"] ?? 0);
  const serverErrors = Number(s["serverErrors"] ?? 0);

  return {
    totalRequests: total,
    successfulRequests: successful,
    clientErrors,
    serverErrors,
    errorRate: total > 0 ? Number(((clientErrors + serverErrors) / total * 100).toFixed(2)) : 0,
    avgResponseTimeMs: Number(Number(s["avgDuration"] ?? 0).toFixed(0)),
    p95ResponseTimeMs: Number(Number(s["p95Duration"] ?? 0).toFixed(0)),
    topEndpoints: endpointRows.map(r => ({
      path: r["path"] ?? "",
      count: Number(r["count"] ?? 0),
      errorCount: Number(r["errorCount"] ?? 0),
      avgDurationMs: Number(Number(r["avgDuration"] ?? 0).toFixed(0)),
      p95DurationMs: Number(Number(r["p95Duration"] ?? 0).toFixed(0))
    })),
    topErrors: errorRows.map(r => ({
      path: r["path"] ?? "",
      statusCode: Number(r["statusCode"] ?? 0),
      count: Number(r["count"] ?? 0)
    }))
  };
}
