import type { CharacterConstantsOverride } from "../../engine/behaviors/index.ts";
import { createWorld } from "../../engine/index.ts";
import { fitCameraToWorld } from "../render.ts";
import type { CameraState } from "../types.ts";
import type { TrainingScenarioDefinition, TrainingWorldRuntime } from "./trainingTypes.ts";

export function createTrainingWorldRuntime(
  scenario: TrainingScenarioDefinition,
  characterConstants: CharacterConstantsOverride = {},
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
  const controller = scenario.createController(world, characterConstants);
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
