import os from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

export interface CpuSnapshot {
  usage: number;
  cores: number;
  timestamp: string;
}

export interface CpuSimulation {
  active: boolean;
  remainingSeconds?: number;
}

/**
 * Samples host CPU usage and runs a deliberately bounded, cooperative CPU load.
 *
 * On a t3.micro (2 vCPUs), a single Node.js event loop can saturate only one
 * core (~50% EC2 CPUUtilization). To reliably cross the CloudWatch alarm
 * threshold, the simulation spawns one Worker thread per additional CPU core so
 * that all cores are loaded simultaneously.
 *
 * Safety controls are unchanged:
 *   - maximum duration: enforced by the caller (default 300 s, max 600 s)
 *   - one simulation at a time
 *   - controlled stop via stopSimulation()
 *   - no shell execution, no child processes, no unbounded loops
 */
export class CpuService {
  private previousSample = this.captureCpuTimes();
  private simulationEndsAt?: number;
  private stopTimer?: NodeJS.Timeout;
  private workHandle?: NodeJS.Immediate;
  private workValue = 0;
  private workers: Worker[] = [];

  snapshot(): CpuSnapshot {
    const currentSample = this.captureCpuTimes();
    const previous = this.previousSample;
    this.previousSample = currentSample;

    const totalDelta = currentSample.total - previous.total;
    const idleDelta = currentSample.idle - previous.idle;
    const usage = totalDelta > 0 ? (1 - idleDelta / totalDelta) * 100 : 0;

    return {
      usage: Number(Math.min(100, Math.max(0, usage)).toFixed(1)),
      cores: os.cpus().length,
      timestamp: new Date().toISOString()
    };
  }

  getSimulation(): CpuSimulation {
    if (!this.simulationEndsAt) return { active: false };
    return {
      active: true,
      remainingSeconds: Math.max(0, Math.ceil((this.simulationEndsAt - Date.now()) / 1000))
    };
  }

  startSimulation(durationSeconds: number): boolean {
    if (this.simulationEndsAt) return false;

    this.simulationEndsAt = Date.now() + durationSeconds * 1_000;
    this.stopTimer = setTimeout(() => this.stopSimulation(), durationSeconds * 1_000);

    // Main-thread work chunk (saturates core 0)
    this.runWorkChunk();

    // One worker thread per additional core (saturates remaining cores)
    const extraCores = Math.max(0, os.cpus().length - 1);
    for (let i = 0; i < extraCores; i++) {
      this.spawnWorker(durationSeconds);
    }

    return true;
  }

  stopSimulation(): boolean {
    if (!this.simulationEndsAt) return false;

    this.simulationEndsAt = undefined;

    if (this.stopTimer) { clearTimeout(this.stopTimer); this.stopTimer = undefined; }
    if (this.workHandle) { clearImmediate(this.workHandle); this.workHandle = undefined; }

    for (const w of this.workers) w.terminate();
    this.workers = [];

    return true;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private runWorkChunk(): void {
    if (!this.simulationEndsAt || Date.now() >= this.simulationEndsAt) {
      this.stopSimulation();
      return;
    }

    const chunkEndsAt = Date.now() + 40;
    while (Date.now() < chunkEndsAt) {
      this.workValue = Math.sqrt(this.workValue + Math.random() + 1);
      if (this.workValue > 10_000) this.workValue = 0;
    }

    this.workHandle = setImmediate(() => this.runWorkChunk());
  }

  private spawnWorker(durationSeconds: number): void {
    // The worker runs an inline script so no separate file is needed.
    // It burns CPU in a tight loop for the given duration then exits cleanly.
    const code = `
      const { workerData, parentPort } = require('worker_threads');
      const endsAt = Date.now() + workerData.durationMs;
      let v = 0;
      function chunk() {
        if (Date.now() >= endsAt) { parentPort.postMessage('done'); return; }
        const stop = Date.now() + 40;
        while (Date.now() < stop) { v = Math.sqrt(v + Math.random() + 1); if (v > 10000) v = 0; }
        setImmediate(chunk);
      }
      chunk();
    `;

    const worker = new Worker(code, {
      eval: true,
      workerData: { durationMs: durationSeconds * 1_000 }
    });

    worker.once("message", () => worker.terminate());
    worker.once("error", () => { /* worker errors are non-fatal */ });
    worker.once("exit", () => {
      this.workers = this.workers.filter(w => w !== worker);
    });

    this.workers.push(worker);
  }

  private captureCpuTimes(): { idle: number; total: number } {
    return os.cpus().reduce(
      (totals, cpu) => {
        const times = cpu.times;
        totals.idle += times.idle;
        totals.total += times.user + times.nice + times.sys + times.idle + times.irq;
        return totals;
      },
      { idle: 0, total: 0 }
    );
  }
}

// ── Worker thread entry point ─────────────────────────────────────────────────
// When this module is loaded as a worker (eval:true path above), isMainThread
// is false and the inline code string handles execution. This block is never
// reached in the eval worker but is kept for clarity.
if (!isMainThread && parentPort) {
  // Handled by the inline eval string above.
}
