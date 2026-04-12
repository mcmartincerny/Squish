import type { CharacterController } from "../../engine/behaviors/index.ts";
import type { PhysicsWorld } from "../../engine/index.ts";
import { clamp } from "./ppoMath.ts";

const MAX_RAY_DISTANCE = 180;
const VELOCITY_SCALE = 400;

export const OBSERVATION_LABELS = [
  "moveIntent",
  "lowerBodyVelX",
  "lowerBodyVelY",
  "torsoAngle",
  "leftLegAngle",
  "rightLegAngle",
  "leftLegLengthRatio",
  "rightLegLengthRatio",
  "leftFootRelX",
  "leftFootRelY",
  "rightFootRelX",
  "rightFootRelY",
  "leftGrounded",
  "rightGrounded",
  "leftGroundDistance",
  "rightGroundDistance",
  "lowerBodyGroundDistance",
  "forwardLeftDistance",
  "forwardRightDistance",
  "lowerBodyHeightNorm",
] as const;

export const OBSERVATION_SIZE = OBSERVATION_LABELS.length;

export function buildTrainingObservation(
  world: PhysicsWorld,
  controller: CharacterController,
  deltaTime: number,
  moveIntent: number,
): number[] {
  const bodyParts = controller.getBodyParts();
  const rays = controller.raycastBellow(MAX_RAY_DISTANCE);
  const ignoreConstraintIds = controller.getBodyConstraintIds();
  const initialLegLengths = controller.getInitialLegLengths();
  const leftLeg = world.getConstraint(controller.rig.leftLegConstraintId);
  const rightLeg = world.getConstraint(controller.rig.rightLegConstraintId);

  const { lowerBody, upperChest, leftFoot, rightFoot } = bodyParts;
  if (!lowerBody || !upperChest || !leftFoot || !rightFoot || !leftLeg || !rightLeg) {
    return new Array<number>(OBSERVATION_SIZE).fill(0);
  }

  const direction = moveIntent >= 0 ? 1 : -1;
  const forwardLeft = castForwardDownRay(world, leftFoot.position.x, leftFoot.position.y, leftFoot.layers, direction, ignoreConstraintIds);
  const forwardRight = castForwardDownRay(world, rightFoot.position.x, rightFoot.position.y, rightFoot.layers, direction, ignoreConstraintIds);
  const deltaSeconds = Math.max(deltaTime, 1e-6);

  return [
    clamp(moveIntent, -1, 1),
    clamp((lowerBody.position.x - lowerBody.previousPosition.x) / deltaSeconds / VELOCITY_SCALE, -3, 3),
    clamp((lowerBody.position.y - lowerBody.previousPosition.y) / deltaSeconds / VELOCITY_SCALE, -3, 3),
    angleToUnit(upperChest.position.x - lowerBody.position.x, upperChest.position.y - lowerBody.position.y),
    angleToUnit(leftFoot.position.x - lowerBody.position.x, leftFoot.position.y - lowerBody.position.y),
    angleToUnit(rightFoot.position.x - lowerBody.position.x, rightFoot.position.y - lowerBody.position.y),
    leftLeg.currentLength / Math.max(initialLegLengths.left, 1e-6),
    rightLeg.currentLength / Math.max(initialLegLengths.right, 1e-6),
    (leftFoot.position.x - lowerBody.position.x) / Math.max(initialLegLengths.left, 1e-6),
    (leftFoot.position.y - lowerBody.position.y) / Math.max(initialLegLengths.left, 1e-6),
    (rightFoot.position.x - lowerBody.position.x) / Math.max(initialLegLengths.right, 1e-6),
    (rightFoot.position.y - lowerBody.position.y) / Math.max(initialLegLengths.right, 1e-6),
    rays.leftFoot ? 1 : 0,
    rays.rightFoot ? 1 : 0,
    normalizeDistance(rays.leftFoot?.distance ?? MAX_RAY_DISTANCE),
    normalizeDistance(rays.rightFoot?.distance ?? MAX_RAY_DISTANCE),
    normalizeDistance(rays.lowerBody?.distance ?? MAX_RAY_DISTANCE),
    normalizeDistance(forwardLeft),
    normalizeDistance(forwardRight),
    clamp(lowerBody.position.y / 1000, -2, 2),
  ];
}

function castForwardDownRay(
  world: PhysicsWorld,
  x: number,
  y: number,
  layers: readonly number[],
  direction: number,
  ignoreConstraintIds: number[],
): number {
  const hit = world.raycast({
    origin: { x, y },
    direction: normalize(direction, 1),
    maxDistance: MAX_RAY_DISTANCE,
    layers: Array.from(layers),
    ignoreConstraintIds,
  });
  return hit?.distance ?? MAX_RAY_DISTANCE;
}

function normalizeDistance(distance: number): number {
  return clamp(distance / MAX_RAY_DISTANCE, 0, 1);
}

function angleToUnit(deltaX: number, deltaY: number): number {
  return Math.atan2(deltaY, deltaX) / Math.PI;
}

function normalize(x: number, y: number): { x: number; y: number } {
  const length = Math.hypot(x, y);
  if (length <= 1e-6) {
    return { x: 0, y: 1 };
  }
  return {
    x: x / length,
    y: y / length,
  };
}
