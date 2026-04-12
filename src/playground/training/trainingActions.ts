import type { LearnedCharacterAction } from "../../engine/behaviors/index.ts";
import { clamp } from "./ppoMath.ts";

export const LEARNED_ACTION_SIZE = 5;

export function decodeLearnedAction(actionVector: readonly number[]): LearnedCharacterAction {
  return {
    leftLegAngleOffsetDeg: scale(actionVector[0] ?? 0, -80, 80),
    rightLegAngleOffsetDeg: scale(actionVector[1] ?? 0, -80, 80),
    leftLegLengthMultiplier: scale(actionVector[2] ?? 0, 0.55, 1.45),
    rightLegLengthMultiplier: scale(actionVector[3] ?? 0, 0.55, 1.45),
    torsoLeanOffsetDeg: scale(actionVector[4] ?? 0, -25, 25),
  };
}

function scale(value: number, min: number, max: number): number {
  const clamped = clamp(value, -1, 1);
  const normalized = (clamped + 1) * 0.5;
  return min + (max - min) * normalized;
}
