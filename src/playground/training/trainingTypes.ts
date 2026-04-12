import type { CharacterConstantsOverride, CharacterController, CharacterControlInput } from "../../engine/behaviors/index.ts";
import type { PhysicsWorld } from "../../engine/index.ts";
import type { PlaygroundSettings } from "../types.ts";

export type CharacterConstantKey = keyof CharacterConstantsOverride;

export interface CharacterConstantSpec {
  key: CharacterConstantKey;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}

export const CHARACTER_CONSTANT_SPECS: readonly CharacterConstantSpec[] = [
  { key: "WALK_SWING_LEG_LENGTH_MULTIPLIER", label: "Swing leg length", min: 0.1, max: 1.5, step: 0.02, defaultValue: 0.7 },
  { key: "WALK_STANCE_MAX_FORCE", label: "Stance force", min: 1000, max: 35000, step: 100, defaultValue: 11000 },
  { key: "WALK_SWING_MAX_FORCE", label: "Swing force", min: 1000, max: 35000, step: 100, defaultValue: 7500 },
  { key: "WALK_STANCE_BODY_ANGLE_OFFSET_DEG", label: "Stance angle", min: -180, max: 180, step: 1, defaultValue: 14 },
  { key: "WALK_SWING_BODY_ANGLE_OFFSET_DEG", label: "Swing angle", min: -18, max: 180, step: 1, defaultValue: 14 },
  { key: "WALK_SWING_REEXTEND_ANGLE_THRESHOLD_DEG", label: "Reextend threshold", min: -90, max: 90, step: 1, defaultValue: 10 },
  { key: "WALK_LEG_CHANGE_LENGTH_PER_SECOND", label: "Leg length speed", min: 10, max: 2000, step: 10, defaultValue: 200 },
  { key: "WALK_SWITCH_X_OFFSET", label: "Switch X offset", min: 0, max: 30, step: 0.25, defaultValue: 3 },
] as const;

export interface TrainingRewardWeights {
  distanceWeight: number;
  xOscillationPenalty: number;
  yOscillationPenalty: number;
  uprightWeight: number;
  heightPenalty: number;
  actionChangePenalty: number;
}

export interface TrainingMetrics {
  lowerBodyPositionX: number;
  lowerBodyXOscillations: number;
  lowerBodyYOscillations: number;
}

export interface TrainingRewardBreakdown {
  distanceContribution: number;
  xOscillationContribution: number;
  yOscillationContribution: number;
  uprightContribution: number;
  heightContribution: number;
  actionChangeContribution: number;
}

export interface TrainingRewardDefinition {
  id: string;
  name: string;
  description: string;
  defaultWeights: TrainingRewardWeights;
  evaluate: (metrics: TrainingMetrics, weights: TrainingRewardWeights) => number;
}

export interface TrainingCandidate {
  id: string;
  generation: number;
  constants: CharacterConstantsOverride;
  parentId: string | null;
  strategyId: string;
}

export interface ScoredTrainingCandidate extends TrainingCandidate {
  metrics: TrainingMetrics;
  rewardBreakdown: TrainingRewardBreakdown;
  reward: number;
}

export interface TrainingGenerationSummary {
  generation: number;
  bestReward: number;
  averageReward: number;
  bestCandidateId: string;
  evaluatedCount: number;
  bestDistanceContribution: number;
  bestXOscillationContribution: number;
  bestYOscillationContribution: number;
}

export interface TrainingEpisodeHistoryEntry {
  episodeIndex: number;
  totalReward: number;
  movingAverageReward: number;
  distanceContribution: number;
  xOscillationContribution: number;
  yOscillationContribution: number;
  uprightContribution: number;
  heightContribution: number;
  actionChangeContribution: number;
  finalLowerBodyX: number;
  steps: number;
}

export interface TrainingUpdateHistoryEntry {
  updateIndex: number;
  policyLoss: number;
  valueLoss: number;
  entropy: number;
  approxKl: number;
}

export interface TrainingScenarioDefinition {
  id: string;
  name: string;
  description: string;
  settings: PlaygroundSettings;
  input: CharacterControlInput;
  createController: (world: PhysicsWorld, constants: CharacterConstantsOverride) => CharacterController;
}

export interface TrainingWorldRuntime {
  world: PhysicsWorld;
  controller: CharacterController;
  settings: PlaygroundSettings;
}

export interface TrainingStrategyContext {
  generation: number;
  populationSize: number;
  eliteCount: number;
  mutationStrength: number;
  specs: readonly CharacterConstantSpec[];
  rng: () => number;
}

export interface TrainingStrategyDefinition {
  id: string;
  name: string;
  description: string;
  createInitialPopulation: (context: TrainingStrategyContext) => TrainingCandidate[];
  createNextPopulation: (
    context: TrainingStrategyContext & {
      previousResults: readonly ScoredTrainingCandidate[];
    },
  ) => TrainingCandidate[];
}
