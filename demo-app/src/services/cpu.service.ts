import os from "node:os";

export interface CpuSnapshot {
  usage: number;
  cores: number;
  timestamp: string;
}

export interface CpuSimulation {
  active: boolean;
  duration?: number;
}

/**
 * Samples host CPU usage and runs a deliberately bounded, cooperative CPU load.
 * Work is scheduled in short chunks so health and stop requests remain responsive.
 */
export class CpuService {
  private previousSample = this.captureCpuTimes();
  private simulationEndsAt?: number;
  private stopTimer?: NodeJS.Timeout;
  private workHandle?: NodeJS.Immediate;
  private workValue = 0;

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
      duration: Math.max(0, Math.ceil((this.simulationEndsAt - Date.now()) / 1000))
    };
  }

  startSimulation(durationSeconds: number): boolean {
    if (this.simulationEndsAt) return false;

    this.simulationEndsAt = Date.now() + durationSeconds * 1_000;
    this.stopTimer = setTimeout(() => this.stopSimulation(), durationSeconds * 1_000);
    this.runWorkChunk();
    return true;
  }

  stopSimulation(): boolean {
    if (!this.simulationEndsAt) return false;

    this.simulationEndsAt = undefined;
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = undefined;
    if (this.workHandle) clearImmediate(this.workHandle);
    this.workHandle = undefined;
    return true;
  }

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
