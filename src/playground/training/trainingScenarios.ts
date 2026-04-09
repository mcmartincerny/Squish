import { spawnCharacter } from "../../engine/behaviors/index.ts";
import type { PhysicsWorld, PointId } from "../../engine/index.ts";
import { DEFAULT_SETTINGS, type PlaygroundSettings } from "../types.ts";
import { syncWorldConfig } from "../scenes.ts";
import type { TrainingScenarioDefinition } from "./trainingTypes.ts";

const WALKING_STAIRS_SETTINGS: PlaygroundSettings = {
  ...DEFAULT_SETTINGS,
  worldWidth: 8000,
  worldHeight: 1400,
};

export const TRAINING_SCENARIOS: readonly TrainingScenarioDefinition[] = [
  {
    id: "walking-stairs",
    name: "Walking Stairs",
    description: "Matches the current character demo setup with a long staircase and fixed rightward input.",
    settings: WALKING_STAIRS_SETTINGS,
    input: {
      left: false,
      right: true,
      up: false,
      down: false,
      jump: false,
      aimTarget: null,
    },
    createController: (world, constants) => {
      const settings = { ...WALKING_STAIRS_SETTINGS };
      world.clear();
      syncWorldConfig(world, settings);
      createPinnedConnectedPoints(world, settings, createStairPoints(6, 1000, -25, 50, 900));
      createPinnedConnectedPoints(world, settings, [{ x: 6060, y: 580 }, { x: 7980, y: 580 }]);

      const controller = spawnCharacter(world, {
        position: {
          x: 300,
          y: 750,
        },
        scale: 1.9,
        stiffness: 0.15,
        damping: 1.5,
        tearThreshold: null,
        characterConstants: constants,
      });
      controller.setInput({
        left: false,
        right: true,
        up: false,
        down: false,
        jump: false,
        aimTarget: null,
      });
      return controller;
    },
  },
] as const;

export function getTrainingScenarioById(id: string): TrainingScenarioDefinition {
  return TRAINING_SCENARIOS.find((scenario) => scenario.id === id) ?? TRAINING_SCENARIOS[0];
}

function createStairPoints(
  steps: number,
  stepWidth: number,
  stepHeightIncrement: number,
  startX: number,
  startY: number,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];

  for (let index = 0; index < steps; index += 1) {
    const y = startY + index * stepHeightIncrement * (index + 1) / 2;
    points.push({ x: startX + index * stepWidth, y });
    points.push({ x: startX + (index + 1) * stepWidth, y });
  }

  return points;
}

function createPinnedConnectedPoints(
  world: PhysicsWorld,
  settings: PlaygroundSettings,
  points: Array<{ x: number; y: number }>,
): void {
  const pinnedPoints = points.map((point) => {
    return world.createPoint({
      position: point,
      pinned: true,
      radius: settings.pointRadius,
      mass: Number.POSITIVE_INFINITY,
    });
  });

  for (let index = 0; index < pinnedPoints.length - 1; index += 1) {
    connect(world, pinnedPoints[index], pinnedPoints[index + 1], settings);
  }
}

function connect(world: PhysicsWorld, pointAId: PointId, pointBId: PointId, settings: PlaygroundSettings): void {
  world.createConstraint({
    pointAId,
    pointBId,
    stiffness: settings.constraintStiffness,
    damping: settings.constraintDamping,
    tearThreshold: settings.tearThreshold,
    collisionRadius: settings.colliderRadius,
  });
}
