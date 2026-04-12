import type { RolloutTransition } from "./ppoTypes.ts";
import { discountAdvantages, normalizeVector } from "./ppoMath.ts";
import type { TrainingRewardBreakdown } from "./trainingTypes.ts";

export interface RolloutBatch {
  observations: number[][];
  actions: number[][];
  oldLogProbs: number[];
  advantages: number[];
  returns: number[];
}

export class PpoBuffer {
  private transitions: RolloutTransition[] = [];
  private advantages: number[] = [];
  private returns: number[] = [];
  private trajectoryStartIndex = 0;

  add(transition: RolloutTransition): void {
    this.transitions.push(transition);
  }

  get size(): number {
    return this.transitions.length;
  }

  get isEmpty(): boolean {
    return this.transitions.length === 0;
  }

  finishTrajectory(lastValue: number, gamma: number, gaeLambda: number): void {
    const trajectory = this.transitions.slice(this.trajectoryStartIndex);

    if (trajectory.length === 0) {
      return;
    }

    const { advantages, returns } = discountAdvantages(
      trajectory.map((entry) => entry.reward),
      trajectory.map((entry) => entry.value),
      trajectory.map((entry) => entry.done),
      lastValue,
      gamma,
      gaeLambda,
    );

    this.advantages.push(...advantages);
    this.returns.push(...returns);
    this.trajectoryStartIndex = this.transitions.length;
  }

  createBatchAndClear(): RolloutBatch {
    const normalizedAdvantages = normalizeVector(this.advantages);
    const batch: RolloutBatch = {
      observations: this.transitions.map((entry) => entry.observation),
      actions: this.transitions.map((entry) => entry.action),
      oldLogProbs: this.transitions.map((entry) => entry.logProb),
      advantages: normalizedAdvantages,
      returns: [...this.returns],
    };

    this.clear();
    return batch;
  }

  clear(): void {
    this.transitions = [];
    this.advantages = [];
    this.returns = [];
    this.trajectoryStartIndex = 0;
  }
}

export function createEmptyRewardBreakdown(): TrainingRewardBreakdown {
  return {
    distanceContribution: 0,
    xOscillationContribution: 0,
    yOscillationContribution: 0,
    uprightContribution: 0,
    heightContribution: 0,
    actionChangeContribution: 0,
  };
}
