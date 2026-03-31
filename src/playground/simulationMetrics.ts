export interface RollingMetricsWindow {
  elapsedSeconds: number;
  frameCount: number;
  totalStepMs: number;
  stepCount: number;
  totalSnapshotMs: number;
  totalDrawMs: number;
}

export interface PerformanceStats {
  fps: number;
  stepMs: number;
  snapshotMs: number;
  drawMs: number;
  idleMs: number;
}

export interface StepSummary {
  averageMs: number;
  p99Ms: number;
  p95Ms: number;
  p5Ms: number;
  p1Ms: number;
}

export function createRollingMetricsWindow(): RollingMetricsWindow {
  return {
    elapsedSeconds: 0,
    frameCount: 0,
    totalStepMs: 0,
    stepCount: 0,
    totalSnapshotMs: 0,
    totalDrawMs: 0,
  };
}

export function recordFrameMetrics(
  windowState: RollingMetricsWindow,
  frame: {
    elapsedSeconds: number;
    stepDurationsMs: number[];
    snapshotMs: number;
    drawMs: number;
  },
): void {
  windowState.elapsedSeconds += frame.elapsedSeconds;
  windowState.frameCount += 1;
  windowState.totalSnapshotMs += frame.snapshotMs;
  windowState.totalDrawMs += frame.drawMs;

  for (const duration of frame.stepDurationsMs) {
    windowState.totalStepMs += duration;
    windowState.stepCount += 1;
  }
}

export function finalizeRollingMetrics(windowState: RollingMetricsWindow): PerformanceStats {
  const safeFrameCount = Math.max(1, windowState.frameCount);
  const averageFrameMs = (windowState.elapsedSeconds * 1000) / safeFrameCount;
  const averageStepMs = windowState.stepCount > 0 ? windowState.totalStepMs / windowState.stepCount : 0;
  const averageSnapshotMs = windowState.totalSnapshotMs / safeFrameCount;
  const averageDrawMs = windowState.totalDrawMs / safeFrameCount;

  return {
    fps: windowState.elapsedSeconds > 0 ? windowState.frameCount / windowState.elapsedSeconds : 0,
    stepMs: averageStepMs,
    snapshotMs: averageSnapshotMs,
    drawMs: averageDrawMs,
    idleMs: Math.max(0, averageFrameMs - averageStepMs - averageSnapshotMs - averageDrawMs),
  };
}

export function summarizeStepDurations(stepDurationsMs: number[]): StepSummary {
  if (stepDurationsMs.length === 0) {
    return {
      averageMs: 0,
      p99Ms: 0,
      p95Ms: 0,
      p5Ms: 0,
      p1Ms: 0,
    };
  }

  const sorted = [...stepDurationsMs].sort((a, b) => a - b);
  const total = stepDurationsMs.reduce((sum, duration) => sum + duration, 0);

  return {
    averageMs: total / stepDurationsMs.length,
    p99Ms: getPercentile(sorted, 99),
    p95Ms: getPercentile(sorted, 95),
    p5Ms: getPercentile(sorted, 5),
    p1Ms: getPercentile(sorted, 1),
  };
}

export function createBenchmarkFilename(date = new Date()): string {
  const parts = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ];

  return `Squish_benchmark_${parts.join('_')}.json`;
}

function getPercentile(sortedValues: number[], percentile: number): number {
  const clampedPercentile = Math.max(0, Math.min(100, percentile));
  const index = (clampedPercentile / 100) * (sortedValues.length - 1);
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);

  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }

  const weight = index - lowerIndex;
  return sortedValues[lowerIndex] + (sortedValues[upperIndex] - sortedValues[lowerIndex]) * weight;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
