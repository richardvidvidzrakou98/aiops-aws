# Building Intelligent Cloud Automation on AWS

Autonomous incident detection and remediation on AWS — a fully event-driven AIOps pipeline that detects a real infrastructure incident, reasons about it with a large language model, enforces a safety policy, and remediates without human intervention.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [How It Works](#how-it-works)
- [Repository Layout](#repository-layout)
- [Source Modules](#source-modules)
- [Demo Application](#demo-application)
- [CI/CD Pipeline](#cicd-pipeline)
- [Safety Design](#safety-design)
- [Prerequisites](#prerequisites)
- [1 — Deploy Infrastructure](#1--deploy-infrastructure)
- [2 — Bootstrap EC2](#2--bootstrap-ec2)
- [3 — Configure GitHub Actions](#3--configure-github-actions)
- [4 — First Automated Deployment](#4--first-automated-deployment)
- [5 — Run the Live Demo](#5--run-the-live-demo)
- [Rollback](#rollback)
- [Infrastructure Reference](#infrastructure-reference)

---

## Overview

This project demonstrates a production-grade AIOps pattern on AWS. When a CloudWatch alarm fires, an event-driven pipeline automatically:

1. Collects live EC2 and CloudWatch context
2. Sends that context to Gemini AI for analysis
3. Runs the AI recommendation through an independent safety policy
4. Executes a predefined remediation action via SSM — only if the policy approves
5. Verifies CPU recovery using a fresh CloudWatch datapoint
6. Publishes the outcome to SNS

The AI never executes arbitrary commands. Every remediation action is a hardcoded mapping inside the Lambda. The policy independently verifies all safety conditions regardless of what the AI returns.

---

## Architecture

![Architecture diagram](docs/ARCHITECTURE.png)

```
GitHub Actions                    CloudWatch Alarm (CPU > 70%)
      │                                      │
      │  deploy                              │ state → ALARM
      ▼                                      ▼
   S3 Bucket                           EventBridge Rule
      │                                      │
      │  SSM Run Command                     │ invoke
      ▼                                      ▼
EC2 (aiops-demo-app) ◄──────── Coordinator Lambda
                                             │
                          ┌──────────────────┼──────────────────┐
                          ▼                  ▼                  ▼
                    Investigation       Gemini AI           Policy Engine
                    (EC2 + CW)         Analysis            (independent
                    collectContext     analyzeIncident      safety checks)
                                                                │
                                                    APPROVED / REJECTED /
                                                    APPROVAL_REQUIRED
                                                                │
                                                    ┌───────────┘
                                                    ▼
                                             SSM Run Command
                                        (systemctl restart aiops-demo-app)
                                                    │
                                                    ▼
                                          Poll for SSM Success
                                                    │
                                                    ▼
                                       Wait for fresh CW datapoint
                                                    │
                                          CPU recovered?
                                          ├── YES → RESOLVED
                                          └── NO  → REMEDIATION_FAILED
                                                    │
                                                    ▼
                                              SNS Notification
```

CI/CD and AIOps both reach EC2 through SSM, for completely different reasons:

| Path | Purpose |
|---|---|
| GitHub Actions → SSM | Deploy application releases |
| AIOps Lambda → SSM | Remediate incidents autonomously |

---

## How It Works

### 1. Detection

A CloudWatch alarm (`AIOps-Test-HighCPU`) monitors `CPUUtilization` on the demo EC2 instance. When the 5-minute average exceeds 70%, the alarm transitions to `ALARM` and EventBridge immediately invokes the Coordinator Lambda.

### 2. Investigation

The Coordinator calls `collectIncidentContext`, which queries:
- **EC2 API** — instance state, instance type, health status, AZ, IP addresses
- **CloudWatch** — latest CPU utilization datapoint (10-minute window)

This context is passed to the AI and the policy. The AI never has direct AWS access.

### 3. AI Analysis

`analyzeIncident` sends the incident context to **Gemini 2.0 Flash Lite** with a strict prompt. The model returns a structured JSON recommendation:

```json
{
  "severity": "HIGH",
  "diagnosis": "CPU saturation detected",
  "confidence": 0.95,
  "recommendedAction": "restart_application",
  "reason": "Healthy instance with sustained high CPU",
  "requiresApproval": false
}
```

The response is validated — only `restart_application` and `no_action` are accepted as actions.

### 4. Policy Evaluation

`evaluateRecommendation` independently verifies every safety condition before approving any action. The AI's `requiresApproval` field is advisory only — it cannot bypass the checks.

| Condition | Failure outcome |
|---|---|
| `instanceState === "running"` | `REJECTED` |
| `healthStatus === "ok"` | `REJECTED` |
| `cpuUtilization > 70` | `REJECTED` |
| `confidence >= 0.90` | `APPROVAL_REQUIRED` |
| `requiresApproval === false` | `APPROVAL_REQUIRED` if true |

Only when all five conditions pass does the policy return `APPROVED`.

### 5. Remediation

`executeRemediation` uses a hardcoded command map — Gemini never supplies shell commands:

```
restart_application  →  systemctl restart aiops-demo-app
```

The flow:
1. `ssm:SendCommand` targets the specific EC2 instance from the trusted alarm event
2. `ssm:GetCommandInvocation` polls until the command reaches a terminal state (max 60 s)
3. If the command fails, returns `REMEDIATION_FAILED` immediately

### 6. Verification

After a successful SSM command, the verifier polls CloudWatch every 30 seconds (up to 6 minutes) waiting for a **fresh datapoint** — one whose timestamp is strictly after the remediation started. This prevents a stale pre-remediation CPU reading from being mistaken for recovery.

```
SSM command succeeds
        ↓
Poll CloudWatch every 30 s (max 360 s)
        ↓
Fresh datapoint received?
        ├── CPU ≤ 70%  →  RESOLVED
        └── CPU > 70%  →  REMEDIATION_FAILED
```

### 7. Notification

The Coordinator publishes to SNS:

| Outcome | Subject |
|---|---|
| `RESOLVED` | `AIOps Incident Resolved` |
| `REMEDIATION_FAILED` | `AIOps Incident Escalated` with `ENGINEER_INTERVENTION_REQUIRED` |

---

## Repository Layout

```
aiops-aws/
├── .github/
│   └── workflows/
│       └── deploy-demo-app.yml     # CI/CD pipeline
├── demo-app/                       # Demo workload (Node.js / Express)
│   ├── src/
│   │   ├── routes/
│   │   │   ├── health.routes.ts    # /health/live, /health/ready
│   │   │   └── system.routes.ts    # /api/system, /internal/simulate/cpu
│   │   ├── services/
│   │   │   └── cpu.service.ts      # CPU simulation worker threads
│   │   ├── app.ts
│   │   └── server.ts
│   ├── aiops-demo-app.service      # systemd unit for EC2
│   └── scripts/
│       └── ec2-setup.sh            # One-time EC2 bootstrap
├── docs/
│   └── ARCHITECTURE.png            # Architecture diagram
├── events/
│   └── cloudwatch-alarm.json       # Sample EventBridge payload
├── src/                            # AIOps Lambda source
│   ├── coordinator/
│   │   └── app.ts                  # Lambda handler — orchestrates the pipeline
│   ├── investigation/
│   │   └── collectContext.ts       # EC2 + CloudWatch context collection
│   ├── ai/
│   │   └── analyzeIncident.ts      # Gemini AI integration
│   ├── policy/
│   │   ├── evaluateRecommendation.ts       # Safety policy engine
│   │   └── evaluateRecommendation.test.ts  # 13 policy unit tests
│   └── remediation/
│       └── executeRemediation.ts   # SSM execution + CPU verification
├── template.yaml                   # SAM infrastructure definition
├── samconfig.toml                  # SAM deploy defaults
├── package.json
└── tsconfig.json
```

---

## Source Modules

### `src/coordinator/app.ts`

The Lambda entry point. Receives the EventBridge alarm event, extracts the affected instance ID, and orchestrates the full pipeline in sequence: investigate → analyse → evaluate → remediate → notify. Remediation is only called when `policyDecision.decision === "APPROVED"`.

### `src/investigation/collectContext.ts`

Queries EC2 (`DescribeInstances`, `DescribeInstanceStatus`) and CloudWatch (`GetMetricStatistics`) to build an `IncidentContext` object. This is the only source of truth for instance state — the AI receives this context but cannot query AWS directly.

### `src/ai/analyzeIncident.ts`

Sends the incident context to Gemini 2.0 Flash Lite using `application/json` response mode. Validates the response structure and rejects any recommendation with an unsupported action, out-of-range confidence, or missing fields.

### `src/policy/evaluateRecommendation.ts`

The authoritative safety gate. Independently verifies instance state, health status, CPU threshold, AI confidence, and the `requiresApproval` flag — in that order. Returns `APPROVED`, `APPROVAL_REQUIRED`, or `REJECTED` with a reason. Covered by 13 unit tests.

### `src/remediation/executeRemediation.ts`

Executes the remediation via SSM using a hardcoded command map, polls for completion, then waits for a fresh post-remediation CloudWatch datapoint to confirm CPU recovery. Returns `RESOLVED`, `REMEDIATION_FAILED`, or `SKIPPED`.

---

## Demo Application

The demo workload is a Node.js / Express application (`aiops-demo-app`) running as a systemd service on EC2. It exposes:

| Endpoint | Description |
|---|---|
| `GET /` | Dashboard — shows version, uptime, live CPU |
| `GET /health/live` | Liveness probe |
| `GET /health/ready` | Readiness probe |
| `GET /api/system` | JSON — version, uptime, CPU |
| `POST /internal/simulate/cpu?duration=<s>` | Start CPU simulation (requires Bearer token) |
| `DELETE /internal/simulate/cpu` | Stop CPU simulation (requires Bearer token) |

The CPU simulation spawns worker threads to generate real CPU load, which triggers the CloudWatch alarm and drives the AIOps workflow.

---

## CI/CD Pipeline

`.github/workflows/deploy-demo-app.yml` runs on every push to `demo-app/` on `main`, and supports manual redeploy of any previous release by SHA.

```
push to main (demo-app/**)
        ↓
npm ci → npm test → npm run build
        ↓
tar artifact → S3 (releases/<sha>/aiops-demo-app.tgz)
        ↓
SSM Run Command → EC2
        ↓
atomic symlink swap (current → releases/<sha>)
        ↓
systemctl restart aiops-demo-app
        ↓
readiness probe + version verification
        ↓
automatic rollback on failure
```

Authentication uses GitHub Actions OIDC — no long-lived AWS credentials are stored. The deployment role (`AIOpsDemoAppDeploymentRole`) is scoped to the specific repository and branch.

---

## Safety Design

The system is designed so that no single component can cause unintended remediation.

**The AI cannot:**
- Execute AWS API calls
- Supply shell commands
- Override the safety policy
- Approve its own recommendation

**The policy independently verifies:**
- Instance is in `running` state
- Instance health status is `ok`
- CPU utilization exceeds the alarm threshold (70%)
- AI confidence is at least 0.90
- AI has not flagged the recommendation for human review

**SSM permissions are scoped to:**
- A single document: `AWS-RunShellScript`
- A single instance: the stack-managed EC2 resource

**The command map is hardcoded:**
```typescript
const REMEDIATION_COMMANDS = {
  restart_application: "systemctl restart aiops-demo-app"
};
```

Any action not in this map throws immediately. The AI recommendation is used only to select a key from this map.

**Verification requires a fresh datapoint:**
The incident is only marked `RESOLVED` when CloudWatch returns a CPU datapoint with a timestamp strictly after the remediation started. Stale pre-remediation data cannot produce a false positive.

---

## Prerequisites

- AWS CLI configured for account `056793557028`, region `us-east-1`
- AWS SAM CLI
- Node.js 22
- An existing S3 bucket for deployment artifacts
- A Gemini API key (Google AI Studio)

---

## 1 — Deploy Infrastructure

```bash
sam build
sam deploy \
  --parameter-overrides \
    "GeminiApiKey=<your-key> \
     DeploymentBucketName=aiops-demo-deploy-<account-id>"
```

SAM creates and manages:

| Resource | Description |
|---|---|
| `AIOpsEC2` | EC2 instance running the demo workload |
| `AIOpsEC2SecurityGroup` | Security group for the instance |
| `AIOpsEC2InstanceRole` | IAM role with SSM and S3 read access |
| `AIOpsHighCPUAlarm` | CloudWatch alarm — CPU > 70% for 5 minutes |
| `IncidentTopic` | SNS topic for incident notifications |
| `CoordinatorFunction` | AIOps Coordinator Lambda (480 s timeout) |
| `IncidentEventRule` | EventBridge rule — routes ALARM events to Lambda |

After deployment, retrieve the instance ID:

```bash
aws cloudformation describe-stacks \
  --stack-name aiops-mvp \
  --query "Stacks[0].Outputs[?OutputKey=='AIOpsEC2'].OutputValue" \
  --output text
```

---

## 2 — Bootstrap EC2

Run once after the first `sam deploy` to install the application and its dependencies on the instance:

```bash
INSTANCE_ID=$(aws cloudformation describe-stacks \
  --stack-name aiops-mvp \
  --query "Stacks[0].Outputs[?OutputKey=='AIOpsEC2'].OutputValue" \
  --output text)

aws ssm send-command \
  --document-name AWS-RunShellScript \
  --instance-ids "$INSTANCE_ID" \
  --parameters "commands=[\"bash -s\"]" \
  --comment "Bootstrap aiops-demo-app" \
  < demo-app/scripts/ec2-setup.sh
```

Then set the secret control token used to authenticate the CPU simulation endpoint:

```bash
aws ssm send-command \
  --document-name AWS-RunShellScript \
  --instance-ids "$INSTANCE_ID" \
  --parameters 'commands=["sed -i s/change-me/<strong-token>/ /opt/aiops-demo-app/config/production.env"]'
```

---

## 3 — Configure GitHub Actions

In your GitHub repository → **Settings → Environments → production**, add the following variables:

| Variable | Value |
|---|---|
| `AWS_ACCOUNT_ID` | Your 12-digit AWS account ID |
| `AWS_REGION` | `us-east-1` |
| `DEPLOYMENT_BUCKET` | `aiops-demo-deploy-<account-id>` |
| `EC2_INSTANCE_ID` | Instance ID from SAM outputs |

No secrets are required — authentication uses OIDC.

---

## 4 — First Automated Deployment

Push any change to `demo-app/` on `main`, or trigger the workflow manually from the Actions tab. The pipeline will build, test, package, upload to S3, and deploy to EC2 via SSM.

The application will be live at:

```
http://<ec2-public-ip>:3000
```

---

## 5 — Run the Live Demo

**Step 1 — Confirm the baseline**

Open `http://<ec2-public-ip>:3000`. Note the version (7-character commit SHA) and confirm CPU is low.

**Step 2 — Trigger the incident**

```bash
curl -X POST "http://<ec2-public-ip>:3000/internal/simulate/cpu?duration=360" \
  -H "Authorization: Bearer <control-token>"
```

The application UI will show CPU climbing. CloudWatch uses 5-minute evaluation periods, so the alarm will fire approximately 5–10 minutes after CPU exceeds 70%.

**Step 3 — Watch the pipeline run**

```
CloudWatch alarm → ALARM
        ↓
EventBridge invokes Coordinator Lambda
        ↓
Investigation: EC2 state + CPU collected
        ↓
Gemini AI: diagnosis + confidence + recommended action
        ↓
Policy: APPROVED (all safety checks pass)
        ↓
SSM: systemctl restart aiops-demo-app
        ↓
Verification: fresh CloudWatch datapoint confirms CPU recovery
        ↓
SNS: AIOps Incident Resolved
```

Monitor progress in CloudWatch Logs → log group `/aws/lambda/aiops-coordinator`.

**Step 4 — Confirm resolution**

The application dashboard will show the service is active and CPU has returned to baseline. The CPU simulation is terminated by the service restart.

**Step 5 — Deploy a new release**

Push a code change to `demo-app/` on `main`. GitHub Actions will build and deploy it. Refresh the dashboard — the version SHA will update.

---

## Rollback

Every release is stored immutably in S3 under `releases/<sha>/aiops-demo-app.tgz`. To redeploy a previous release, trigger the workflow manually from the Actions tab and enter the target SHA in the `release_sha` input.

The deployment script performs an atomic symlink swap and automatically rolls back to the previous release if the readiness probe fails.

---

## Infrastructure Reference

### Lambda timeout

The Coordinator Lambda is configured with a **480-second timeout** to accommodate the full worst-case workflow:

| Stage | Max duration |
|---|---|
| Investigation + AI analysis | ~10 s |
| SSM command poll | 60 s |
| CloudWatch verification poll | 360 s |
| **Total** | **~430 s** |

### CloudWatch alarm settings

| Setting | Value |
|---|---|
| Metric | `AWS/EC2 CPUUtilization` |
| Statistic | Average |
| Period | 300 s (5 minutes) |
| Evaluation periods | 1 |
| Threshold | > 70% |
| Missing data treatment | `notBreaching` |

### IAM permissions (Coordinator Lambda)

| Permission | Resource scope |
|---|---|
| `ec2:DescribeInstances`, `ec2:DescribeInstanceStatus` | `*` (read-only, no resource ARN supported) |
| `cloudwatch:GetMetricStatistics` | `*` (read-only, no resource ARN supported) |
| `ssm:SendCommand` | Specific document + specific EC2 instance |
| `ssm:GetCommandInvocation` | `*` (command invocation ARNs are not scopeable) |
| `sns:Publish` | Specific `IncidentTopic` ARN |
