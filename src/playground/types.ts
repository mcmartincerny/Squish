export interface PlaygroundSettings {
  worldWidth: number;
  worldHeight: number;
  gravity: number;
  iterations: number;
  globalDamping: number;
  friction: number;
  restitution: number;
  pointRadius: number;
  colliderRadius: number;
  useXPBDSolver: boolean;
  constraintStiffness: number;
  constraintDamping: number;
  tearThreshold: number;
  timeScale: number;
  mouseRadius: number;
  mouseStrength: number;
  dragStiffness: number;
  playerSize: number;
  createPointMass: number;
  createPointPinned: boolean;
  snapToGrid: boolean;
  createPointLayerNegativeOne: boolean;
  createPointLayerZero: boolean;
  createPointLayerOne: boolean;
  snapGridSpacing: number;
  createConstraintLayer: "auto" | -1 | 0 | 1;
}

export interface CameraState {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export const DEFAULT_SETTINGS: PlaygroundSettings = {
  worldWidth: 1200,
  worldHeight: 800,
  gravity: 900,
  iterations: 9,
  globalDamping: 0,
  friction: 5,
  restitution: 0.2,
  pointRadius: 10,
  colliderRadius: 10,
  useXPBDSolver: false,
  constraintStiffness: 0.03,
  constraintDamping: 15,
  tearThreshold: 2.4,
  timeScale: 1,
  mouseRadius: 150,
  mouseStrength: 4000,
  dragStiffness: 0.18,
  playerSize: 1,
  createPointMass: 1,
  createPointPinned: false,
  snapToGrid: false,
  createPointLayerNegativeOne: false,
  createPointLayerZero: true,
  createPointLayerOne: false,
  snapGridSpacing: 20,
  createConstraintLayer: "auto",
};
