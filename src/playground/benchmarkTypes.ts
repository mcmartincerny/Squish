import type { PhysicsWorld } from '../engine/index.ts';
import type { PlaygroundSettings } from './types.ts';

export interface BenchmarkScenario {
  id: string;
  name: string;
  description: string;
  settings: PlaygroundSettings;
  setup: (world: PhysicsWorld) => void;
}

export interface BenchmarkScenarioCounts {
  points: number;
  constraints: number;
  bodies: number;
}

export interface BenchmarkResult {
  scenarioId: string;
  scenarioName: string;
  description: string;
  signature: string;
  signatureVersion: 'world-setup-v1';
  counts: BenchmarkScenarioCounts;
  averageMs: number;
  p99Ms: number;
  p95Ms: number;
  p5Ms: number;
  p1Ms: number;
  samples: number;
}

export interface BenchmarkRunConfig {
  warmupSeconds: number;
  measureSeconds: number;
  cooldownSeconds: number;
  fixedDt: number;
}

export interface BenchmarkRunFile {
  version: number;
  generatedAt: string;
  label: string | null;
  sourceFilename: string;
  runConfig: BenchmarkRunConfig;
  results: BenchmarkResult[];
}

export type BenchmarkMetricKey = 'averageMs' | 'p99Ms' | 'p95Ms' | 'p5Ms' | 'p1Ms';

export const BENCHMARK_METRICS: BenchmarkMetricKey[] = ['averageMs', 'p99Ms', 'p95Ms', 'p5Ms', 'p1Ms'];
