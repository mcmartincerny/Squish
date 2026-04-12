import type { TrainingRewardBreakdown } from "./trainingTypes.ts";

export type PpoActivation = "tanh" | "relu";

export interface PpoNetworkConfig {
  hiddenLayerCount: number;
  hiddenLayerWidth: number;
  activation: PpoActivation;
  initialActionStd: number;
}

export interface PpoTrainingConfig {
  learningRate: number;
  rolloutHorizon: number;
  ppoEpochs: number;
  minibatchSize: number;
  clipEpsilon: number;
  gamma: number;
  gaeLambda: number;
  entropyCoefficient: number;
  valueLossCoefficient: number;
  maxGradNorm: number;
  maxEpisodeSteps: number;
}

export interface PolicyDecision {
  action: number[];
  logProb: number;
  value: number;
  mean: number[];
}

export interface RolloutTransition {
  observation: number[];
  action: number[];
  reward: number;
  done: boolean;
  value: number;
  logProb: number;
  rewardBreakdown: TrainingRewardBreakdown;
}

export interface PpoUpdateMetrics {
  policyLoss: number;
  valueLoss: number;
  entropy: number;
  approxKl: number;
}

export interface PpoEpisodeSummary {
  episodeIndex: number;
  totalReward: number;
  steps: number;
  finalLowerBodyX: number;
  breakdown: TrainingRewardBreakdown;
}
