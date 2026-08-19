import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeInstanceStatusCommand
} from "@aws-sdk/client-ec2";

import {
  CloudWatchClient,
  GetMetricStatisticsCommand
} from "@aws-sdk/client-cloudwatch";

const region = process.env.AWS_REGION || "us-east-1";

const ec2 = new EC2Client({ region });
const cloudWatch = new CloudWatchClient({ region });

export interface IncidentContext {
  instanceId: string;
  instanceState: string;
  instanceType?: string;
  availabilityZone?: string;
  privateIp?: string;
  publicIp?: string;
  healthStatus: string;
  cpuUtilization?: number;
}

export async function collectIncidentContext(
  instanceId: string
): Promise<IncidentContext> {
  const instanceResponse = await ec2.send(
    new DescribeInstancesCommand({
      InstanceIds: [instanceId]
    })
  );

  const instance =
    instanceResponse.Reservations?.[0]?.Instances?.[0];

  if (!instance) {
    throw new Error(`EC2 instance not found: ${instanceId}`);
  }

  const statusResponse = await ec2.send(
    new DescribeInstanceStatusCommand({
      InstanceIds: [instanceId],
      IncludeAllInstances: true
    })
  );

  const status = statusResponse.InstanceStatuses?.[0];

  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 10 * 60 * 1000);

  const metricResponse = await cloudWatch.send(
    new GetMetricStatisticsCommand({
      Namespace: "AWS/EC2",
      MetricName: "CPUUtilization",
      Dimensions: [
        {
          Name: "InstanceId",
          Value: instanceId
        }
      ],
      StartTime: startTime,
      EndTime: endTime,
      Period: 300,
      Statistics: ["Average"]
    })
  );

  const datapoints = metricResponse.Datapoints ?? [];

  const latestDatapoint = datapoints
    .filter((point) => point.Timestamp)
    .sort(
      (a, b) =>
        (b.Timestamp?.getTime() ?? 0) -
        (a.Timestamp?.getTime() ?? 0)
    )[0];

  return {
    instanceId,
    instanceState: instance.State?.Name ?? "unknown",
    instanceType: instance.InstanceType,
    availabilityZone: instance.Placement?.AvailabilityZone,
    privateIp: instance.PrivateIpAddress,
    publicIp: instance.PublicIpAddress,
    healthStatus:
      status?.InstanceStatus?.Status ?? "unknown",
    cpuUtilization: latestDatapoint?.Average
  };
}