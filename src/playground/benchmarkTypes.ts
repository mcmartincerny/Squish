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
  counts: BenchmarkScenarioCounts;
  averageMs: number;
  p99Ms: number;
  p95Ms: number;
  p5Ms: number;
  p1Ms: number;
  samples: number;
}
