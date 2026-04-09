import { createWorld } from "../../engine/index.ts";
import { fitCameraToWorld } from "../render.ts";
import type { CameraState } from "../types.ts";
import { evaluateTrainingReward } from "./trainingReward.ts";
import type {
  ScoredTrainingCandidate,
  TrainingCandidate,
  TrainingGenerationSummary,
  TrainingRewardDefinition,
  TrainingRewardWeights,
  TrainingScenarioDefinition,
  TrainingStrategyDefinition,
  TrainingWorldRuntime,
} from "./trainingTypes.ts";

export function createTrainingWorldRuntime(
  scenario: TrainingScenarioDefinition,
  candidate: TrainingCandidate,
): TrainingWorldRuntime {
  const settings = { ...scenario.settings };
  const world = createWorld({
    gravity: { x: 0, y: settings.gravity },
    size: { x: settings.worldWidth, y: settings.worldHeight },
    iterations: settings.iterations,
    globalDamping: settings.globalDamping,
    friction: settings.friction,
    restitution: settings.restitution,
    defaultPointRadius: settings.pointRadius,
    defaultColliderRadius: settings.colliderRadius,
    gridCellSize: Math.max(settings.colliderRadius * 4, 48),
  });
  const controller = scenario.createController(world, candidate.constants);
  return {
    world,
    controller,
    settings,
  };
}

export function createCameraForTrainingWorld(
  canvasSize: { width: number; height: number },
  scenario: TrainingScenarioDefinition,
): CameraState {
  return fitCameraToWorld(
    Math.max(canvasSize.width, 1),
    Math.max(canvasSize.height, 1),
    scenario.settings.worldWidth,
    scenario.settings.worldHeight,
  );
}

export function isTrainingEvaluationComplete(updateNumber: number, evaluationUpdates: number): boolean {
  return updateNumber >= evaluationUpdates;
}

export function scoreTrainingCandidate(
  candidate: TrainingCandidate,
  runtime: TrainingWorldRuntime,
  rewardDefinition: TrainingRewardDefinition,
  rewardWeights: TrainingRewardWeights,
): ScoredTrainingCandidate {
  const evaluation = evaluateTrainingReward(runtime.world, runtime.controller, rewardDefinition, rewardWeights);
  return {
    ...candidate,
    metrics: evaluation.metrics,
    rewardBreakdown: evaluation.rewardBreakdown,
    reward: evaluation.reward,
  };
}

export function summarizeTrainingGeneration(
  generation: number,
  results: readonly ScoredTrainingCandidate[],
): TrainingGenerationSummary {
  const bestCandidate = [...results].sort((left, right) => right.reward - left.reward)[0];
  const rewardTotal = results.reduce((sum, result) => sum + result.reward, 0);
  return {
    generation,
    bestReward: bestCandidate?.reward ?? 0,
    averageReward: results.length === 0 ? 0 : rewardTotal / results.length,
    bestCandidateId: bestCandidate?.id ?? "",
    evaluatedCount: results.length,
    bestDistanceContribution: bestCandidate?.rewardBreakdown.distanceContribution ?? 0,
    bestXOscillationContribution: bestCandidate?.rewardBreakdown.xOscillationContribution ?? 0,
    bestYOscillationContribution: bestCandidate?.rewardBreakdown.yOscillationContribution ?? 0,
  };
}

export function createInitialPopulation(
  strategy: TrainingStrategyDefinition,
  options: {
    populationSize: number;
    eliteCount: number;
    mutationStrength: number;
    generation: number;
    specs: Parameters<TrainingStrategyDefinition["createInitialPopulation"]>[0]["specs"];
  },
): TrainingCandidate[] {
  return strategy.createInitialPopulation({
    ...options,
    rng: Math.random,
  });
}

export function createNextPopulation(
  strategy: TrainingStrategyDefinition,
  options: {
    populationSize: number;
    eliteCount: number;
    mutationStrength: number;
    generation: number;
    previousResults: readonly ScoredTrainingCandidate[];
    specs: Parameters<TrainingStrategyDefinition["createInitialPopulation"]>[0]["specs"];
  },
): TrainingCandidate[] {
  return strategy.createNextPopulation({
    ...options,
    rng: Math.random,
  });
}
