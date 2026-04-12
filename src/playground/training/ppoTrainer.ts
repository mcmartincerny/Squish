import { PpoBuffer, createEmptyRewardBreakdown } from "./ppoBuffer.ts";
import { PpoPolicy } from "./ppoPolicy.ts";
import type { PpoEpisodeSummary, PpoNetworkConfig, PpoTrainingConfig, PolicyDecision, PpoUpdateMetrics } from "./ppoTypes.ts";
import type { TrainingRewardBreakdown } from "./trainingTypes.ts";

export interface TrainerSnapshot {
  totalEnvironmentSteps: number;
  updatesCompleted: number;
  episodesCompleted: number;
  currentEpisodeSteps: number;
  currentEpisodeReward: number;
  currentEpisodeBreakdown: TrainingRewardBreakdown;
  lastUpdateMetrics: PpoUpdateMetrics | null;
  recentEpisodeRewards: number[];
  bestEpisode: PpoEpisodeSummary | null;
}

export class PpoTrainer {
  readonly policy: PpoPolicy;

  private readonly buffer = new PpoBuffer();
  private readonly trainingConfig: PpoTrainingConfig;
  private totalEnvironmentSteps = 0;
  private updatesCompleted = 0;
  private episodesCompleted = 0;
  private currentEpisodeSteps = 0;
  private currentEpisodeReward = 0;
  private currentEpisodeBreakdown = createEmptyRewardBreakdown();
  private recentEpisodeRewards: number[] = [];
  private bestEpisode: PpoEpisodeSummary | null = null;
  private lastUpdateMetrics: PpoUpdateMetrics | null = null;

  constructor(observationSize: number, actionSize: number, networkConfig: PpoNetworkConfig, trainingConfig: PpoTrainingConfig) {
    this.policy = new PpoPolicy(observationSize, actionSize, networkConfig, trainingConfig.learningRate);
    this.trainingConfig = trainingConfig;
  }

  get config(): PpoTrainingConfig {
    return this.trainingConfig;
  }

  act(observation: readonly number[], stochastic = true): PolicyDecision {
    return this.policy.act(observation, stochastic);
  }

  recordTransition(transition: {
    observation: number[];
    action: number[];
    reward: number;
    done: boolean;
    value: number;
    logProb: number;
    rewardBreakdown: TrainingRewardBreakdown;
  }): void {
    this.buffer.add(transition);
    this.totalEnvironmentSteps += 1;
    this.currentEpisodeSteps += 1;
    this.currentEpisodeReward += transition.reward;
    this.currentEpisodeBreakdown = addBreakdown(this.currentEpisodeBreakdown, transition.rewardBreakdown);
  }

  finishEpisode(finalLowerBodyX: number): PpoEpisodeSummary {
    this.buffer.finishTrajectory(0, this.trainingConfig.gamma, this.trainingConfig.gaeLambda);
    this.episodesCompleted += 1;

    const summary: PpoEpisodeSummary = {
      episodeIndex: this.episodesCompleted,
      totalReward: this.currentEpisodeReward,
      steps: this.currentEpisodeSteps,
      finalLowerBodyX,
      breakdown: this.currentEpisodeBreakdown,
    };

    if (!this.bestEpisode || summary.totalReward > this.bestEpisode.totalReward) {
      this.bestEpisode = summary;
    }

    this.recentEpisodeRewards = [...this.recentEpisodeRewards.slice(-49), summary.totalReward];
    this.currentEpisodeReward = 0;
    this.currentEpisodeSteps = 0;
    this.currentEpisodeBreakdown = createEmptyRewardBreakdown();
    return summary;
  }

  maybeUpdate(nextObservation: readonly number[]): PpoUpdateMetrics | null {
    if (this.buffer.size < this.trainingConfig.rolloutHorizon) {
      return null;
    }

    const bootstrapValue = this.policy.predictValue(nextObservation);
    this.buffer.finishTrajectory(bootstrapValue, this.trainingConfig.gamma, this.trainingConfig.gaeLambda);
    const batch = this.buffer.createBatchAndClear();
    this.policy.setLearningRate(this.trainingConfig.learningRate);
    this.lastUpdateMetrics = this.policy.update(batch, {
      clipEpsilon: this.trainingConfig.clipEpsilon,
      entropyCoefficient: this.trainingConfig.entropyCoefficient,
      valueLossCoefficient: this.trainingConfig.valueLossCoefficient,
      maxGradNorm: this.trainingConfig.maxGradNorm,
      epochs: this.trainingConfig.ppoEpochs,
      minibatchSize: this.trainingConfig.minibatchSize,
    });
    this.updatesCompleted += 1;
    return this.lastUpdateMetrics;
  }

  getSnapshot(): TrainerSnapshot {
    return {
      totalEnvironmentSteps: this.totalEnvironmentSteps,
      updatesCompleted: this.updatesCompleted,
      episodesCompleted: this.episodesCompleted,
      currentEpisodeSteps: this.currentEpisodeSteps,
      currentEpisodeReward: this.currentEpisodeReward,
      currentEpisodeBreakdown: this.currentEpisodeBreakdown,
      lastUpdateMetrics: this.lastUpdateMetrics,
      recentEpisodeRewards: this.recentEpisodeRewards,
      bestEpisode: this.bestEpisode,
    };
  }

  dispose(): void {
    this.buffer.clear();
    this.policy.dispose();
  }
}

function addBreakdown(left: TrainingRewardBreakdown, right: TrainingRewardBreakdown): TrainingRewardBreakdown {
  return {
    distanceContribution: left.distanceContribution + right.distanceContribution,
    xOscillationContribution: left.xOscillationContribution + right.xOscillationContribution,
    yOscillationContribution: left.yOscillationContribution + right.yOscillationContribution,
    uprightContribution: left.uprightContribution + right.uprightContribution,
    heightContribution: left.heightContribution + right.heightContribution,
    actionChangeContribution: left.actionChangeContribution + right.actionChangeContribution,
  };
}
