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
  dimensions: { Name: string; Value: string }[],
  startTime: Date,
  endTime: Date,
  statistics: ("Average" | "Maximum" | "Sum")[]
): Promise<{ average: number; max: number; sum: number }> {
  const response = await cloudWatch.send(
    new GetMetricStatisticsCommand({
      Namespace: namespace,
      MetricName: metricName,
      Dimensions: dimensions,
      StartTime: startTime,
      EndTime: endTime,
      Period: 3600,
      Statistics: statistics
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
  const id = { Name: "InstanceId", Value: instanceId };

  const [cpu, memory, disk, netIn, netOut] = await Promise.all([
    getStats("CWAgent", "cpu_usage_active",
      [id, { Name: "cpu", Value: "cpu-total" }],
      startTime, endTime, ["Average", "Maximum"]),
    getStats("CWAgent", "mem_used_percent",
      [id],
      startTime, endTime, ["Average", "Maximum"]),
    getStats("CWAgent", "disk_used_percent",
      [id, { Name: "path", Value: "/" }, { Name: "device", Value: "nvme0n1p1" }, { Name: "fstype", Value: "xfs" }],
      startTime, endTime, ["Average", "Maximum"]),
    getStats("CWAgent", "net_bytes_recv",
      [id, { Name: "interface", Value: "ens5" }],
      startTime, endTime, ["Sum"]),
    getStats("CWAgent", "net_bytes_sent",
      [id, { Name: "interface", Value: "ens5" }],
      startTime, endTime, ["Sum"])
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
