export interface Vec2Like {
  x: number;
  y: number;
}

export type Vec2 = Vec2Like;

export type PointId = number;
export type ConstraintId = number;
export type BodyId = number;

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
  tearThreshold?: number;
  collisionRadius?: number;
  enabled?: boolean;
}

export interface ApplyRadialForceOptions {
  center: Vec2Like;
  radius: number;
  strength: number;
}

export interface PointSnapshot {
  id: PointId;
  position: Vec2;
  previousPosition: Vec2;
  radius: number;
  mass: number;
  pinned: boolean;
  bodyId: BodyId;
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
}

export interface BodySnapshot {
  id: BodyId;
  pointIds: PointId[];
  constraintIds: ConstraintId[];
  colliderConstraintIds: ConstraintId[];
}

export interface GridCellSnapshot {
  cellX: number;
  cellY: number;
  size: number;
  itemCount: number;
}

export interface WorldSnapshot {
  config: WorldConfig;
  points: PointSnapshot[];
  constraints: ConstraintSnapshot[];
  bodies: BodySnapshot[];
  gridCells: GridCellSnapshot[];
}

export interface PhysicsWorld {
  createPoint(options: CreatePointOptions): PointId;
  createConstraint(options: CreateConstraintOptions): ConstraintId;
  setPointPosition(options: SetPointPositionOptions): void;
  removePoint(pointId: PointId): void;
  removeConstraint(constraintId: ConstraintId): void;
  applyRadialForce(options: ApplyRadialForceOptions): void;
  setConfig(config: Partial<WorldConfig>): void;
  getConfig(): WorldConfig;
  getSnapshot(): WorldSnapshot;
  step(deltaTime: number): void;
  clear(): void;
}
