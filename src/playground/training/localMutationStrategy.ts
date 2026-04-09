import type { CharacterConstantsOverride } from "../../engine/behaviors/index.ts";
import type { CharacterConstantSpec, ScoredTrainingCandidate, TrainingCandidate, TrainingStrategyDefinition } from "./trainingTypes.ts";

const STRATEGY_ID = "local-mutation";

export const localMutationStrategy: TrainingStrategyDefinition = {
  id: STRATEGY_ID,
  name: "Local Mutation / Hill Climbing",
  description: "Keeps the best candidates and mutates them locally to search nearby solutions.",
  createInitialPopulation: ({ generation, populationSize, mutationStrength, specs, rng }) => {
    const defaults = buildDefaultConstants(specs);
    return Array.from({ length: populationSize }, (_, index) => ({
      id: createCandidateId(generation, index, rng),
      generation,
      constants: index === 0 ? defaults : mutateConstants(defaults, specs, mutationStrength, rng),
      parentId: null,
      strategyId: STRATEGY_ID,
    }));
  },
  createNextPopulation: ({ generation, populationSize, eliteCount, mutationStrength, previousResults, specs, rng }) => {
    const sorted = [...previousResults].sort((left, right) => right.reward - left.reward);
    const elitePool = sorted.slice(0, Math.max(1, Math.min(eliteCount, sorted.length)));
    const nextPopulation: TrainingCandidate[] = [];

    for (let index = 0; index < elitePool.length && nextPopulation.length < populationSize; index += 1) {
      const elite = elitePool[index];
      nextPopulation.push({
        id: createCandidateId(generation, nextPopulation.length, rng),
        generation,
        constants: { ...elite.constants },
        parentId: elite.id,
        strategyId: STRATEGY_ID,
      });
    }

    while (nextPopulation.length < populationSize) {
      const parent = pickParent(elitePool, rng);
      nextPopulation.push({
        id: createCandidateId(generation, nextPopulation.length, rng),
        generation,
        constants: mutateConstants(parent.constants, specs, mutationStrength, rng),
        parentId: parent.id,
        strategyId: STRATEGY_ID,
      });
    }

    return nextPopulation;
  },
};

function buildDefaultConstants(specs: readonly CharacterConstantSpec[]): CharacterConstantsOverride {
  return Object.fromEntries(specs.map((spec) => [spec.key, spec.defaultValue])) as CharacterConstantsOverride;
}

function mutateConstants(
  base: CharacterConstantsOverride,
  specs: readonly CharacterConstantSpec[],
  mutationStrength: number,
  rng: () => number,
): CharacterConstantsOverride {
  const next: CharacterConstantsOverride = { ...base };
  let mutatedAny = false;

  for (const spec of specs) {
    const shouldMutate = rng() < 0.75;

    if (!shouldMutate) {
      continue;
    }

    mutatedAny = true;
    const span = spec.max - spec.min;
    const delta = (rng() * 2 - 1) * span * mutationStrength;
    const currentValue = next[spec.key] ?? spec.defaultValue;
    next[spec.key] = snapAndClamp(currentValue + delta, spec);
  }

  if (!mutatedAny && specs.length > 0) {
    const forcedSpec = specs[Math.floor(rng() * specs.length)];
    const span = forcedSpec.max - forcedSpec.min;
    const delta = (rng() * 2 - 1) * span * mutationStrength;
    const currentValue = next[forcedSpec.key] ?? forcedSpec.defaultValue;
    next[forcedSpec.key] = snapAndClamp(currentValue + delta, forcedSpec);
  }

  return next;
}

function pickParent(pool: readonly ScoredTrainingCandidate[], rng: () => number): ScoredTrainingCandidate {
  const index = Math.floor(rng() * pool.length);
  return pool[index] ?? pool[0];
}

function snapAndClamp(value: number, spec: CharacterConstantSpec): number {
  const clamped = Math.max(spec.min, Math.min(spec.max, value));
  if (spec.step <= 0) {
    return clamped;
  }

  const snapped = Math.round((clamped - spec.min) / spec.step) * spec.step + spec.min;
  return Number(snapped.toFixed(6));
}

function createCandidateId(generation: number, index: number, rng: () => number): string {
  return `g${generation}-c${index}-${Math.round(rng() * 1_000_000)}`;
}
