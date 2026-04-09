import { localMutationStrategy } from "./localMutationStrategy.ts";
import type { TrainingStrategyDefinition } from "./trainingTypes.ts";

export const TRAINING_STRATEGIES: readonly TrainingStrategyDefinition[] = [localMutationStrategy] as const;

export function getTrainingStrategyById(id: string): TrainingStrategyDefinition {
  return TRAINING_STRATEGIES.find((strategy) => strategy.id === id) ?? TRAINING_STRATEGIES[0];
}
