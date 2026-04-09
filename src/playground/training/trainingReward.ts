import type { CharacterController } from "../../engine/behaviors/index.ts";
import type { PhysicsWorld } from "../../engine/index.ts";
import type { TrainingMetrics, TrainingRewardBreakdown, TrainingRewardDefinition, TrainingRewardWeights } from "./trainingTypes.ts";

export const TRAINING_REWARD_DEFINITIONS: readonly TrainingRewardDefinition[] = [
  {
    id: "distance-minus-xy-oscillation",
    name: "Distance Minus XY Oscillation",
    description: "Rewards walking farther to the right while penalizing lower-body oscillation on both axes.",
    defaultWeights: {
      distanceWeight: 0.8,
      xOscillationPenalty: 0.05,
      yOscillationPenalty: 0.15,
    },
    evaluate: (metrics, weights) =>
      metrics.lowerBodyPositionX * weights.distanceWeight
      - metrics.lowerBodyXOscillations * weights.xOscillationPenalty
      - metrics.lowerBodyYOscillations * weights.yOscillationPenalty,
  },
] as const;

export function getTrainingRewardDefinitionById(id: string): TrainingRewardDefinition {
  return TRAINING_REWARD_DEFINITIONS.find((definition) => definition.id === id) ?? TRAINING_REWARD_DEFINITIONS[0];
}

export function readTrainingMetrics(world: PhysicsWorld, controller: CharacterController): TrainingMetrics {
  const lowerBodyPoint = world.getPoint(controller.rig.lowerBodyId);
  return {
    lowerBodyPositionX: lowerBodyPoint?.position.x ?? 0,
    lowerBodyXOscillations: controller.lowerBodyXOscillations,
    lowerBodyYOscillations: controller.lowerBodyYOscillations,
  };
}

export function evaluateTrainingReward(
  world: PhysicsWorld,
  controller: CharacterController,
  definition: TrainingRewardDefinition,
  weights: TrainingRewardWeights,
): { metrics: TrainingMetrics; rewardBreakdown: TrainingRewardBreakdown; reward: number } {
  const metrics = readTrainingMetrics(world, controller);
  const rewardBreakdown = buildRewardBreakdown(metrics, weights);
  return {
    metrics,
    rewardBreakdown,
    reward: definition.evaluate(metrics, weights),
  };
}

function buildRewardBreakdown(metrics: TrainingMetrics, weights: TrainingRewardWeights): TrainingRewardBreakdown {
  return {
    distanceContribution: metrics.lowerBodyPositionX * weights.distanceWeight,
    xOscillationContribution: -metrics.lowerBodyXOscillations * weights.xOscillationPenalty,
    yOscillationContribution: -metrics.lowerBodyYOscillations * weights.yOscillationPenalty,
  };
}
