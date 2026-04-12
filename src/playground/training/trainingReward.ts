import type { CharacterController } from "../../engine/behaviors/index.ts";
import type { PhysicsWorld } from "../../engine/index.ts";
import type { TrainingMetrics, TrainingRewardBreakdown, TrainingRewardDefinition, TrainingRewardWeights } from "./trainingTypes.ts";

export const TRAINING_REWARD_DEFINITIONS: readonly TrainingRewardDefinition[] = [
  {
    id: "ppo-walking-reward",
    name: "PPO Walking Reward",
    description: "Rewards forward progress and stable upright walking while penalizing oscillation, falling, and jerky actions.",
    defaultWeights: {
      distanceWeight: 1,
      xOscillationPenalty: 0.05,
      yOscillationPenalty: 0.15,
      uprightWeight: 0.25,
      heightPenalty: 1,
      actionChangePenalty: 0.04,
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
  const rewardBreakdown = buildEpisodeRewardBreakdown(metrics, weights);
  return {
    metrics,
    rewardBreakdown,
    reward: definition.evaluate(metrics, weights),
  };
}

export function evaluateTrainingStepReward(
  world: PhysicsWorld,
  controller: CharacterController,
  previousAction: readonly number[] | null,
  currentAction: readonly number[],
  weights: TrainingRewardWeights,
): { reward: number; rewardBreakdown: TrainingRewardBreakdown; done: boolean } {
  const bodyParts = controller.getBodyParts();
  const worldConfig = world.getConfig();
  const { lowerBody, upperChest, leftFoot, rightFoot } = bodyParts;

  if (!lowerBody || !upperChest || !leftFoot || !rightFoot) {
    return {
      reward: -1,
      rewardBreakdown: createZeroBreakdown(),
      done: true,
    };
  }

  const deltaX = lowerBody.position.x - lowerBody.previousPosition.x;
  const deltaY = lowerBody.position.y - lowerBody.previousPosition.y;
  const supportCenterX = (leftFoot.position.x + rightFoot.position.x) * 0.5;
  const supportCenterY = (leftFoot.position.y + rightFoot.position.y) * 0.5;
  const swayX = Math.abs(lowerBody.position.x - supportCenterX);
  const lowerBodyUpFromFeet = Math.abs(lowerBody.position.y - supportCenterY);
  const actionChange = previousAction
    ? previousAction.reduce((sum, value, index) => sum + Math.abs(currentAction[index] - value), 0) / previousAction.length
    : 0;
  const fallen = lowerBody.position.y > worldConfig.size.y * 0.92 || upperChest.position.y > lowerBody.position.y - 8;

  const rewardBreakdown: TrainingRewardBreakdown = {
    distanceContribution: deltaX * weights.distanceWeight,
    xOscillationContribution: -(Math.abs(deltaX) * 0.1) * weights.xOscillationPenalty,
    yOscillationContribution: -Math.abs(deltaY) * weights.yOscillationPenalty,
    uprightContribution:  (swayX * -0.01 + lowerBodyUpFromFeet * 0.01) * weights.uprightWeight,
    heightContribution: -(fallen ? 1 : 0) * weights.heightPenalty,
    actionChangeContribution: -actionChange * weights.actionChangePenalty,
  };

  return {
    reward: sumBreakdown(rewardBreakdown),
    rewardBreakdown,
    done: fallen,
  };
}

function buildEpisodeRewardBreakdown(metrics: TrainingMetrics, weights: TrainingRewardWeights): TrainingRewardBreakdown {
  return {
    distanceContribution: metrics.lowerBodyPositionX * weights.distanceWeight,
    xOscillationContribution: -metrics.lowerBodyXOscillations * weights.xOscillationPenalty,
    yOscillationContribution: -metrics.lowerBodyYOscillations * weights.yOscillationPenalty,
    uprightContribution: 0,
    heightContribution: 0,
    actionChangeContribution: 0,
  };
}

function sumBreakdown(breakdown: TrainingRewardBreakdown): number {
  return (
    breakdown.distanceContribution
    + breakdown.xOscillationContribution
    + breakdown.yOscillationContribution
    + breakdown.uprightContribution
    + breakdown.heightContribution
    + breakdown.actionChangeContribution
  );
}

function createZeroBreakdown(): TrainingRewardBreakdown {
  return {
    distanceContribution: 0,
    xOscillationContribution: 0,
    yOscillationContribution: 0,
    uprightContribution: 0,
    heightContribution: 0,
    actionChangeContribution: 0,
  };
}
