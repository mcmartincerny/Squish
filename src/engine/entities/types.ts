import type { ConstraintState, PointState } from "../core/world";

export interface Vec2Like {
  x: number;
  y: number;
}

export type Vec2 = Vec2Like;

export type PointId = number;
export type ConstraintId = number;
export type LayerId = number;

export interface WorldConfig {
  gravity: Vec2;
  size: Vec2;
  iterations: number;
  globalDamping: number;
  friction: number;
  restitution: number;
  defaultPointRadius: number;
  defaultColliderRadius: number;
  gridCellSize: number;
}

export interface CreateWorldOptions extends Partial<WorldConfig> {
  gravity: Vec2Like;
  size: Vec2Like;
}

export interface CreatePointOptions {
  position: Vec2Like;
  previousPosition?: Vec2Like;
  mass?: number;
  radius?: number;
  pinned?: boolean;
  layers?: LayerId[];
  collisionsEnabled?: boolean;
  ignoredConstraintIds?: ConstraintId[];
}

export interface SetPointPositionOptions {
  pointId: PointId;
  position: Vec2Like;
  previousPosition?: Vec2Like;
}

export interface CreateConstraintOptions {
  pointAId: PointId;
  pointBId: PointId;
  length?: number;
  stiffness?: number;
  damping?: number;
  tearThreshold?: number | null;
  collisionRadius?: number;
  enabled?: boolean;
  layer?: LayerId;
}

export interface ApplyRadialForceOptions {
  center: Vec2Like;
  radius: number;
  strength: number;
}

export interface ApplyPointForceOptions {
  pointId: PointId;
  force: Vec2Like;
}

export interface SetConstraintRestLengthOptions {
  constraintId: ConstraintId;
  length: number;
}

export interface SetPointIgnoredConstraintsOptions {
  pointId: PointId;
  ignoredConstraintIds: ConstraintId[];
}

export interface RaycastOptions {
  origin: Vec2Like;
  direction: Vec2Like;
  maxDistance: number;
  layers?: LayerId[];
  ignoreConstraintIds?: ConstraintId[];
  includeWorldBounds?: boolean;
}

export interface RaycastHit {
  kind: "constraint" | "worldBounds";
  point: Vec2;
  normal: Vec2;
  distance: number;
  constraintId?: ConstraintId;
  layer?: LayerId;
}

export interface PointSnapshot {
  id: PointId;
  position: Vec2;
  previousPosition: Vec2;
  radius: number;
  mass: number;
  pinned: boolean;
  layers: LayerId[];
  collisionsEnabled: boolean;
}

export interface WorldController {
  update(deltaTime: number): void;
}

export interface ConstraintSnapshot {
  id: ConstraintId;
  pointAId: PointId;
  pointBId: PointId;
  restLength: number;
  currentLength: number;
  stiffness: number;
  damping: number;
  tearThreshold: number | null;
  collisionRadius: number;
  stretchRatio: number;
  enabled: boolean;
  layer: LayerId;
}

export interface GridCellSnapshot {
  cellX: number;
  cellY: number;
  size: number;
  itemCount: number;
  layer?: LayerId;
}

/** Optional radius (world units), color, and lifespan (getSnapshot calls, default 1); other keys for tagging. */
export type DebugDrawMetadata = {
  radius?: number;
  color?: string;
  /** How many consecutive `getSnapshot` calls include this draw; default 1. */
  lifespan?: number;
} & Record<string, string | number | undefined>;

export interface WorldDebugPoint {
  x: number;
  y: number;
  radius: number;
  color: string;
  /** Remaining lifespan after this snapshot (0 = last frame). */
  lifespan: number;
}

export interface WorldDebugLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  radius: number;
  color: string;
  /** Remaining lifespan after this snapshot (0 = last frame). */
  lifespan: number;
}

export interface WorldSnapshot {
  config: WorldConfig;
  points: PointSnapshot[];
  constraints: ConstraintSnapshot[];
  gridCells: GridCellSnapshot[];
  debugPoints: WorldDebugPoint[];
  debugLines: WorldDebugLine[];
}

export interface PhysicsWorld {
  createPoint(options: CreatePointOptions): PointId;
  createConstraint(options: CreateConstraintOptions): ConstraintId;
  registerController(controller: WorldController): void;
  deregisterController(controller: WorldController): void;
  getPoint(pointId: PointId): PointState | null;
  getConstraint(constraintId: ConstraintId): ConstraintState | null;
  getPointSnapshot(pointId: PointId): PointSnapshot | null;
  getConstraintSnapshot(constraintId: ConstraintId): ConstraintSnapshot | null;
  setPointPosition(options: SetPointPositionOptions): void;
  setConstraintRestLength(options: SetConstraintRestLengthOptions): void;
  setPointIgnoredConstraints(options: SetPointIgnoredConstraintsOptions): void;
  removePoint(pointId: PointId): void;
  removeConstraint(constraintId: ConstraintId): void;
  applyRadialForce(options: ApplyRadialForceOptions): void;
  applyPointForce(options: ApplyPointForceOptions): void;
  raycast(options: RaycastOptions): RaycastHit | null;
  setConfig(config: Partial<WorldConfig>): void;
  getConfig(): WorldConfig;
  getSnapshot(): WorldSnapshot;
  debugPoint(x?: number, y?: number, metadata?: DebugDrawMetadata): void;
  debugLine(x1: number, y1: number, x2: number, y2: number, metadata?: DebugDrawMetadata): void;
  step(deltaTime: number, useXPBDSolver?: boolean): void;
  clear(): void;
}
