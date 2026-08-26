import {
  CloudWatchClient,
  GetMetricStatisticsCommand
} from "@aws-sdk/client-cloudwatch";

const cloudWatch = new CloudWatchClient({ region: process.env.AWS_REGION ?? "us-east-1" });

export interface SystemMetrics {
  cpu: { average: number; peak: number };
  memory: { average: number; peak: number };
  disk: { average: number; peak: number };
  network: { totalBytesIn: number; totalBytesOut: number };
}

async function getStats(
  namespace: string,
  metricName: string,
  instanceId: string,
  startTime: Date,
  endTime: Date,
  statistics: string[]
): Promise<{ average: number; max: number; sum: number }> {
  const response = await cloudWatch.send(
    new GetMetricStatisticsCommand({
      Namespace: namespace,
      MetricName: metricName,
      Dimensions: [{ Name: "InstanceId", Value: instanceId }],
      StartTime: startTime,
      EndTime: endTime,
      Period: 3600,
      Statistics: statistics as ("Average" | "Maximum" | "Sum")[]
    })
  );

  const points = response.Datapoints ?? [];
  const averages = points.map(p => p.Average ?? 0).filter(v => v > 0);
  const maxes = points.map(p => p.Maximum ?? 0).filter(v => v > 0);
  const sums = points.map(p => p.Sum ?? 0);

  return {
    average: averages.length ? averages.reduce((a, b) => a + b, 0) / averages.length : 0,
    max: maxes.length ? Math.max(...maxes) : 0,
    sum: sums.reduce((a, b) => a + b, 0)
  };
}

export async function collectSystemMetrics(
  instanceId: string,
  startTime: Date,
  endTime: Date
): Promise<SystemMetrics> {
  const [cpu, memory, disk, netIn, netOut] = await Promise.all([
    getStats("CWAgent", "cpu_usage_active", instanceId, startTime, endTime, ["Average", "Maximum"]),
    getStats("CWAgent", "mem_used_percent", instanceId, startTime, endTime, ["Average", "Maximum"]),
    getStats("CWAgent", "disk_used_percent", instanceId, startTime, endTime, ["Average", "Maximum"]),
    getStats("CWAgent", "net_bytes_recv", instanceId, startTime, endTime, ["Sum"]),
    getStats("CWAgent", "net_bytes_sent", instanceId, startTime, endTime, ["Sum"])
  ]);

  return {
    cpu: { average: Number(cpu.average.toFixed(1)), peak: Number(cpu.max.toFixed(1)) },
    memory: { average: Number(memory.average.toFixed(1)), peak: Number(memory.max.toFixed(1)) },
    disk: { average: Number(disk.average.toFixed(1)), peak: Number(disk.max.toFixed(1)) },
    network: {
      totalBytesIn: Math.round(netIn.sum),
      totalBytesOut: Math.round(netOut.sum)
    }
  };
}
