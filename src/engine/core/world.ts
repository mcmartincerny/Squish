import { SpatialHashGrid } from "../collision/spatialHashGrid.ts";
import type {
  ApplyRadialForceOptions,
  ConstraintId,
  ConstraintSnapshot,
  CreateConstraintOptions,
  CreatePointOptions,
  CreateWorldOptions,
  GridCellSnapshot,
  LayerId,
  PhysicsWorld,
  PointId,
  PointSnapshot,
  SetPointPositionOptions,
  WorldConfig,
  WorldSnapshot,
} from "../entities/types.ts";
import { normalizePointLayers, resolveConstraintLayer } from "./layers.ts";
import { closestPointOnSegment } from "../math/geometry.ts";
import { cloneVec2, distance } from "../math/vector.ts";

interface PointState {
  id: PointId;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  ax: number;
  ay: number;
  invMass: number;
  radius: number;
  pinned: boolean;
  layers: LayerId[];
  collisionsEnabled: boolean;
}

interface ConstraintState {
  id: ConstraintId;
  pointAId: PointId;
  pointBId: PointId;
  restLength: number;
  stiffness: number;
  damping: number;
  tearThreshold: number | null;
  collisionRadius: number;
  enabled: boolean;
  layer: LayerId;
  xpbdLambda: number;
}

const DEFAULT_WORLD_CONFIG: WorldConfig = {
  gravity: { x: 0, y: 900 },
  size: { x: 1200, y: 800 },
  iterations: 8,
  globalDamping: 1.25,
  friction: 10,
  restitution: 0.2,
  defaultPointRadius: 8,
  defaultColliderRadius: 10,
  gridCellSize: 64,
};

const EPSILON = 1e-6;
const REFERENCE_DELTA_TIME = 1 / 60;

function toWorldConfig(options: CreateWorldOptions): WorldConfig {
  return {
    gravity: cloneVec2(options.gravity),
    size: cloneVec2(options.size),
    iterations: options.iterations ?? DEFAULT_WORLD_CONFIG.iterations,
    globalDamping: options.globalDamping ?? DEFAULT_WORLD_CONFIG.globalDamping,
    friction: options.friction ?? DEFAULT_WORLD_CONFIG.friction,
    restitution: options.restitution ?? DEFAULT_WORLD_CONFIG.restitution,
    defaultPointRadius: options.defaultPointRadius ?? DEFAULT_WORLD_CONFIG.defaultPointRadius,
    defaultColliderRadius: options.defaultColliderRadius ?? DEFAULT_WORLD_CONFIG.defaultColliderRadius,
    gridCellSize: options.gridCellSize ?? DEFAULT_WORLD_CONFIG.gridCellSize,
  };
}

class SoftBodyWorld implements PhysicsWorld {
  private readonly points: Array<PointState | undefined> = [];
  private readonly constraints: Array<ConstraintState | undefined> = [];
  private readonly broadphase: SpatialHashGrid;

  private maxColliderRadius = 0;
  private config: WorldConfig;

  constructor(options: CreateWorldOptions) {
    this.config = toWorldConfig(options);
    this.broadphase = new SpatialHashGrid(this.config.gridCellSize);
  }

  createPoint(options: CreatePointOptions): PointId {
    const id = this.points.length;
    const mass = options.pinned ? Number.POSITIVE_INFINITY : Math.max(options.mass ?? 1, EPSILON);
    const layers = normalizePointLayers(options.layers);
    const point: PointState = {
      id,
      x: options.position.x,
      y: options.position.y,
      prevX: options.previousPosition?.x ?? options.position.x,
      prevY: options.previousPosition?.y ?? options.position.y,
      ax: 0,
      ay: 0,
      invMass: options.pinned ? 0 : 1 / mass,
      radius: Math.max(0, options.radius ?? this.config.defaultPointRadius),
      pinned: Boolean(options.pinned),
      layers,
      collisionsEnabled: options.collisionsEnabled ?? true,
    };

    this.points[id] = point;

    return id;
  }

  createConstraint(options: CreateConstraintOptions): ConstraintId {
    const pointA = this.requirePoint(options.pointAId);
    const pointB = this.requirePoint(options.pointBId);
    const id = this.constraints.length;
    const restLength = options.length ?? distance({ x: pointA.x, y: pointA.y }, { x: pointB.x, y: pointB.y });
    const layer = resolveConstraintLayer(pointA.layers, pointB.layers, options.layer);

    const constraint: ConstraintState = {
      id,
      pointAId: options.pointAId,
      pointBId: options.pointBId,
      restLength: Math.max(restLength, EPSILON),
      stiffness: clamp01(options.stiffness ?? 1),
      damping: Math.max(0, options.damping ?? 0),
      tearThreshold: options.tearThreshold ?? null,
      collisionRadius: Math.max(0, options.collisionRadius ?? 0),
      enabled: options.enabled ?? true,
      layer,
      xpbdLambda: 0,
    };

    this.constraints[id] = constraint;

    return id;
  }

  setPointPosition(options: SetPointPositionOptions): void {
    const point = this.requirePoint(options.pointId);

    point.x = options.position.x;
    point.y = options.position.y;
    point.prevX = options.previousPosition?.x ?? options.position.x;
    point.prevY = options.previousPosition?.y ?? options.position.y;
    point.ax = 0;
    point.ay = 0;
  }

  removePoint(pointId: PointId): void {
    this.requirePoint(pointId);
    this.points[pointId] = undefined;

    for (const constraint of this.constraints) {
      if (!constraint) {
        continue;
      }

      if (constraint.pointAId === pointId || constraint.pointBId === pointId) {
        this.constraints[constraint.id] = undefined;
      }
    }

  }

  removeConstraint(constraintId: ConstraintId): void {
    this.requireConstraint(constraintId);
    this.constraints[constraintId] = undefined;
  }

  applyRadialForce(options: ApplyRadialForceOptions): void {
    const radiusSquared = options.radius * options.radius;

    for (const point of this.points) {
      if (!point || point.pinned) {
        continue;
      }

      const dx = options.center.x - point.x;
      const dy = options.center.y - point.y;
      const distanceSquared = dx * dx + dy * dy;

      if (distanceSquared > radiusSquared || distanceSquared <= EPSILON) {
        continue;
      }

      const distanceToCenter = Math.sqrt(distanceSquared);
      const strengthScale = 1 - distanceToCenter / options.radius;
      const directionX = dx / distanceToCenter;
      const directionY = dy / distanceToCenter;

      point.ax += directionX * options.strength * strengthScale;
      point.ay += directionY * options.strength * strengthScale;
    }
  }

  setConfig(config: Partial<WorldConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      gravity: config.gravity ? cloneVec2(config.gravity) : this.config.gravity,
      size: config.size ? cloneVec2(config.size) : this.config.size,
    };

    this.broadphase.setCellSize(this.config.gridCellSize);
  }

  getConfig(): WorldConfig {
    return {
      ...this.config,
      gravity: cloneVec2(this.config.gravity),
      size: cloneVec2(this.config.size),
    };
  }

  getSnapshot(): WorldSnapshot {
    this.rebuildBroadphase();

    const points: PointSnapshot[] = [];
    const constraints: ConstraintSnapshot[] = [];
    const gridCells: GridCellSnapshot[] = this.broadphase.getSnapshot();

    for (const point of this.points) {
      if (!point) {
        continue;
      }

      points.push({
        id: point.id,
        position: { x: point.x, y: point.y },
        previousPosition: { x: point.prevX, y: point.prevY },
        radius: point.radius,
        mass: point.invMass === 0 ? Number.POSITIVE_INFINITY : 1 / point.invMass,
        pinned: point.pinned,
        layers: [...point.layers],
        collisionsEnabled: point.collisionsEnabled,
      });
    }

    for (const constraint of this.constraints) {
      if (!constraint) {
        continue;
      }

      const pointA = this.points[constraint.pointAId];
      const pointB = this.points[constraint.pointBId];

      if (!pointA || !pointB) {
        continue;
      }

      const currentLength = distance(pointA, pointB);

      constraints.push({
        id: constraint.id,
        pointAId: constraint.pointAId,
        pointBId: constraint.pointBId,
        restLength: constraint.restLength,
        currentLength,
        stiffness: constraint.stiffness,
        damping: constraint.damping,
        tearThreshold: constraint.tearThreshold,
        collisionRadius: constraint.collisionRadius,
        stretchRatio: currentLength / constraint.restLength,
        enabled: constraint.enabled,
        layer: constraint.layer,
      });
    }

    return {
      config: this.getConfig(),
      points,
      constraints,
      gridCells,
    };
  }

  step(deltaTime: number, useXPBDSolver = false): void {
    if (deltaTime <= 0) {
      return;
    }

    this.integrate(deltaTime);
    this.rebuildBroadphase();
    if (useXPBDSolver) {
      this.resetConstraintLambdas();
    }

    for (let iteration = 0; iteration < this.config.iterations; iteration += 1) {
      this.solveWorldBounds(deltaTime);
      if (useXPBDSolver) {
        this.solveConstraintsXPBD(deltaTime);
      } else {
        this.solveConstraints(deltaTime);
      }
      this.solvePointVsCapsuleContacts(deltaTime);
    }

    this.applyGlobalVelocityDamping(deltaTime);
    this.breakTornConstraints();
  }

  clear(): void {
    this.points.length = 0;
    this.constraints.length = 0;
    this.maxColliderRadius = 0;
    this.broadphase.clear();
  }

  private requirePoint(pointId: PointId): PointState {
    const point = this.points[pointId];

    if (!point) {
      throw new Error(`Point ${pointId} does not exist.`);
    }

    return point;
  }

  private requireConstraint(constraintId: ConstraintId): ConstraintState {
    const constraint = this.constraints[constraintId];

    if (!constraint) {
      throw new Error(`Constraint ${constraintId} does not exist.`);
    }

    return constraint;
  }

  private integrate(deltaTime: number): void {
    const deltaTimeSquared = deltaTime * deltaTime;

    for (const point of this.points) {
      if (!point) {
        continue;
      }

      if (point.pinned) {
        point.ax = 0;
        point.ay = 0;
        point.prevX = point.x;
        point.prevY = point.y;
        continue;
      }

      const velocityX = point.x - point.prevX;
      const velocityY = point.y - point.prevY;
      const nextX = point.x + velocityX + (point.ax + this.config.gravity.x) * deltaTimeSquared;
      const nextY = point.y + velocityY + (point.ay + this.config.gravity.y) * deltaTimeSquared;

      point.prevX = point.x;
      point.prevY = point.y;
      point.x = nextX;
      point.y = nextY;
      point.ax = 0;
      point.ay = 0;
    }
  }

  private rebuildBroadphase(): void {
    this.broadphase.clear();
    this.maxColliderRadius = 0;

    for (const constraint of this.constraints) {
      if (!constraint?.enabled || constraint.collisionRadius <= 0) {
        continue;
      }

      const pointA = this.points[constraint.pointAId];
      const pointB = this.points[constraint.pointBId];

      if (!pointA || !pointB) {
        continue;
      }

      this.maxColliderRadius = Math.max(this.maxColliderRadius, constraint.collisionRadius);
      this.broadphase.insert(
        constraint.id,
        {
          minX: Math.min(pointA.x, pointB.x) - constraint.collisionRadius,
          minY: Math.min(pointA.y, pointB.y) - constraint.collisionRadius,
          maxX: Math.max(pointA.x, pointB.x) + constraint.collisionRadius,
          maxY: Math.max(pointA.y, pointB.y) + constraint.collisionRadius,
        },
        constraint.layer,
      );
    }
  }

  private solveWorldBounds(deltaTime: number): void {
    const minX = 0;
    const minY = 0;
    const maxX = this.config.size.x;
    const maxY = this.config.size.y;

    for (const point of this.points) {
      if (!point) {
        continue;
      }

      let correctedX = point.x;
      let correctedY = point.y;
      let correctionX = 0;
      let correctionY = 0;

      if (point.x < minX + point.radius) {
        correctedX = minX + point.radius;
        correctionX = correctedX - point.x;
      } else if (point.x > maxX - point.radius) {
        correctedX = maxX - point.radius;
        correctionX = correctedX - point.x;
      }

      if (point.y < minY + point.radius) {
        correctedY = minY + point.radius;
        correctionY = correctedY - point.y;
      } else if (point.y > maxY - point.radius) {
        correctedY = maxY - point.radius;
        correctionY = correctedY - point.y;
      }

      if (correctionX === 0 && correctionY === 0) {
        continue;
      }

      point.x = correctedX;
      point.y = correctedY;

      const normalLength = Math.hypot(correctionX, correctionY);
      const normalX = normalLength > EPSILON ? correctionX / normalLength : 0;
      const normalY = normalLength > EPSILON ? correctionY / normalLength : -1;

      this.solveVelocityContact(
        deltaTime,
        [
          {
            point,
            normalWeight: 1,
          },
        ],
        normalX,
        normalY,
      );
    }
  }

  private solveConstraints(deltaTime: number): void {
    for (const constraint of this.constraints) {
      if (!constraint?.enabled) {
        continue;
      }

      const pointA = this.points[constraint.pointAId];
      const pointB = this.points[constraint.pointBId];

      if (!pointA || !pointB) {
        continue;
      }

      const deltaX = pointB.x - pointA.x;
      const deltaY = pointB.y - pointA.y;
      const currentLength = Math.hypot(deltaX, deltaY);

      if (currentLength <= EPSILON) {
        continue;
      }

      const invMassSum = pointA.invMass + pointB.invMass;

      if (invMassSum <= EPSILON) {
        continue;
      }

      const difference = currentLength - constraint.restLength;
      const perIterationStiffness = this.mapLegacyStiffnessToPerIterationStiffness(constraint.stiffness, deltaTime);
      const correctionScale = (difference / currentLength) * perIterationStiffness;
      const correctionX = deltaX * correctionScale;
      const correctionY = deltaY * correctionScale;
      const weightA = pointA.invMass / invMassSum;
      const weightB = pointB.invMass / invMassSum;

      if (!pointA.pinned) {
        pointA.x += correctionX * weightA;
        pointA.y += correctionY * weightA;
      }

      if (!pointB.pinned) {
        pointB.x -= correctionX * weightB;
        pointB.y -= correctionY * weightB;
      }

      this.applyConstraintDamping(constraint, pointA, pointB, deltaTime);
    }
  }

  private solveConstraintsXPBD(deltaTime: number): void {
    for (const constraint of this.constraints) {
      if (!constraint?.enabled) {
        continue;
      }

      const pointA = this.points[constraint.pointAId];
      const pointB = this.points[constraint.pointBId];

      if (!pointA || !pointB) {
        continue;
      }

      const deltaX = pointB.x - pointA.x;
      const deltaY = pointB.y - pointA.y;
      const currentLength = Math.hypot(deltaX, deltaY);

      if (currentLength <= EPSILON) {
        continue;
      }

      const invMassSum = pointA.invMass + pointB.invMass;

      if (invMassSum <= EPSILON) {
        continue;
      }

      const compliance = this.mapLegacyStiffnessToXPBDCompliance(constraint.stiffness);
      const alpha = compliance / (deltaTime * deltaTime);
      const constraintError = currentLength - constraint.restLength;
      const deltaLambda = -(constraintError + alpha * constraint.xpbdLambda) / (invMassSum + alpha);
      const directionX = deltaX / currentLength;
      const directionY = deltaY / currentLength;

      constraint.xpbdLambda += deltaLambda;

      if (!pointA.pinned) {
        pointA.x -= directionX * deltaLambda * pointA.invMass;
        pointA.y -= directionY * deltaLambda * pointA.invMass;
      }

      if (!pointB.pinned) {
        pointB.x += directionX * deltaLambda * pointB.invMass;
        pointB.y += directionY * deltaLambda * pointB.invMass;
      }

      this.applyConstraintDamping(constraint, pointA, pointB, deltaTime);
    }
  }

  private solvePointVsCapsuleContacts(deltaTime: number): void {
    for (const point of this.points) {
      if (!point || !point.collisionsEnabled) {
        continue;
      }

      const candidateConstraintIds = this.broadphase.queryCircle(point.x, point.y, point.radius + this.maxColliderRadius, point.layers);

      for (const constraintId of candidateConstraintIds) {
        const constraint = this.constraints[constraintId];

        if (!constraint?.enabled || constraint.collisionRadius <= 0) {
          continue;
        }

        const pointA = this.points[constraint.pointAId];
        const pointB = this.points[constraint.pointBId];

        if (!pointA || !pointB) {
          continue;
        }

        if (point.id === pointA.id || point.id === pointB.id) {
          continue;
        }

        if (!point.layers.includes(constraint.layer)) {
          continue;
        }

        const closestPoint = closestPointOnSegment(point, pointA, pointB);
        const deltaX = point.x - closestPoint.x;
        const deltaY = point.y - closestPoint.y;
        const minimumDistance = point.radius + constraint.collisionRadius;
        const distanceSquared = deltaX * deltaX + deltaY * deltaY;

        if (distanceSquared >= minimumDistance * minimumDistance) {
          continue;
        }

        const distanceToCapsule = Math.sqrt(distanceSquared);
        let normalX = 0;
        let normalY = -1;

        if (distanceToCapsule > EPSILON) {
          normalX = deltaX / distanceToCapsule;
          normalY = deltaY / distanceToCapsule;
        } else {
          const segmentX = pointB.x - pointA.x;
          const segmentY = pointB.y - pointA.y;
          const segmentLength = Math.hypot(segmentX, segmentY);

          if (segmentLength > EPSILON) {
            normalX = -segmentY / segmentLength;
            normalY = segmentX / segmentLength;
          }
        }

        const weightA = 1 - closestPoint.t;
        const weightB = closestPoint.t;
        const invMassDenominator = point.invMass + pointA.invMass * weightA * weightA + pointB.invMass * weightB * weightB;

        if (invMassDenominator <= EPSILON) {
          continue;
        }

        const penetration = minimumDistance - distanceToCapsule;
        const lambda = penetration / invMassDenominator;

        if (!point.pinned) {
          point.x += normalX * lambda * point.invMass;
          point.y += normalY * lambda * point.invMass;
        }

        if (!pointA.pinned) {
          pointA.x -= normalX * lambda * pointA.invMass * weightA;
          pointA.y -= normalY * lambda * pointA.invMass * weightA;
        }

        if (!pointB.pinned) {
          pointB.x -= normalX * lambda * pointB.invMass * weightB;
          pointB.y -= normalY * lambda * pointB.invMass * weightB;
        }

        this.solveVelocityContact(
          deltaTime,
          [
            {
              point,
              normalWeight: 1,
            },
            {
              point: pointA,
              normalWeight: -weightA,
            },
            {
              point: pointB,
              normalWeight: -weightB,
            },
          ],
          normalX,
          normalY,
        );
      }
    }
  }

  private resetConstraintLambdas(): void {
    for (const constraint of this.constraints) {
      if (constraint) {
        constraint.xpbdLambda = 0;
      }
    }
  }

  private mapLegacyStiffnessToPerIterationStiffness(stiffness: number, deltaTime: number): number {
    const baselineFrameStiffness = this.getBaselineFrameStiffness(stiffness);

    if (baselineFrameStiffness <= EPSILON) {
      return 0;
    }

    if (baselineFrameStiffness >= 1 - EPSILON) {
      return 1;
    }

    const iterationCount = Math.max(1, this.config.iterations);
    const normalizedExponent = REFERENCE_DELTA_TIME / (deltaTime * iterationCount);
    return 1 - Math.pow(1 - baselineFrameStiffness, normalizedExponent);
  }

  private mapLegacyStiffnessToXPBDCompliance(stiffness: number): number {
    const baselineFrameStiffness = this.getBaselineFrameStiffness(stiffness);

    if (baselineFrameStiffness >= 1 - EPSILON) {
      return 0;
    }

    if (baselineFrameStiffness <= EPSILON) {
      return 1e12;
    }

    return ((1 - baselineFrameStiffness) / baselineFrameStiffness) * REFERENCE_DELTA_TIME * REFERENCE_DELTA_TIME;
  }

  private getBaselineFrameStiffness(stiffness: number): number {
    const clampedStiffness = clamp01(stiffness);

    if (clampedStiffness <= EPSILON) {
      return 0;
    }

    if (clampedStiffness >= 1 - EPSILON) {
      return 1;
    }

    return 1 - Math.pow(1 - clampedStiffness, DEFAULT_WORLD_CONFIG.iterations);
  }

  private applyConstraintDamping(constraint: ConstraintState, pointA: PointState, pointB: PointState, deltaTime: number): void {
    if (constraint.damping <= EPSILON) {
      return;
    }

    const deltaX = pointB.x - pointA.x;
    const deltaY = pointB.y - pointA.y;
    const currentLength = Math.hypot(deltaX, deltaY);

    if (currentLength <= EPSILON) {
      return;
    }

    const invMassSum = pointA.invMass + pointB.invMass;

    if (invMassSum <= EPSILON) {
      return;
    }

    const weightA = pointA.invMass / invMassSum;
    const weightB = pointB.invMass / invMassSum;
    const directionX = deltaX / currentLength;
    const directionY = deltaY / currentLength;
    const velocityAX = this.getVelocityX(pointA, deltaTime);
    const velocityAY = this.getVelocityY(pointA, deltaTime);
    const velocityBX = this.getVelocityX(pointB, deltaTime);
    const velocityBY = this.getVelocityY(pointB, deltaTime);
    const relativeSpeed = (velocityBX - velocityAX) * directionX + (velocityBY - velocityAY) * directionY;
    const dampedRelativeSpeed = relativeSpeed * Math.exp(-constraint.damping * deltaTime);
    const deltaRelativeSpeed = dampedRelativeSpeed - relativeSpeed;

    if (!pointA.pinned) {
      this.setVelocity(pointA, velocityAX - directionX * deltaRelativeSpeed * weightA, velocityAY - directionY * deltaRelativeSpeed * weightA, deltaTime);
    }

    if (!pointB.pinned) {
      this.setVelocity(pointB, velocityBX + directionX * deltaRelativeSpeed * weightB, velocityBY + directionY * deltaRelativeSpeed * weightB, deltaTime);
    }
  }

  private solveVelocityContact(deltaTime: number, participants: Array<{ point: PointState; normalWeight: number }>, normalX: number, normalY: number): void {
    let relativeVelocityX = 0;
    let relativeVelocityY = 0;
    let denominator = 0;

    for (const participant of participants) {
      if (participant.point.invMass <= EPSILON) {
        continue;
      }

      relativeVelocityX += this.getVelocityX(participant.point, deltaTime) * participant.normalWeight;
      relativeVelocityY += this.getVelocityY(participant.point, deltaTime) * participant.normalWeight;
      denominator += participant.point.invMass * participant.normalWeight * participant.normalWeight;
    }

    if (denominator <= EPSILON) {
      return;
    }

    const relativeNormalSpeed = relativeVelocityX * normalX + relativeVelocityY * normalY;
    const tangentX = relativeVelocityX - normalX * relativeNormalSpeed;
    const tangentY = relativeVelocityY - normalY * relativeNormalSpeed;
    const nextNormalSpeed = relativeNormalSpeed < 0 ? -relativeNormalSpeed * this.config.restitution : relativeNormalSpeed;
    const tangentScale = Math.exp(-this.config.friction * deltaTime);
    const desiredVelocityX = normalX * nextNormalSpeed + tangentX * tangentScale;
    const desiredVelocityY = normalY * nextNormalSpeed + tangentY * tangentScale;
    const deltaVelocityX = desiredVelocityX - relativeVelocityX;
    const deltaVelocityY = desiredVelocityY - relativeVelocityY;

    for (const participant of participants) {
      if (participant.point.invMass <= EPSILON) {
        continue;
      }

      const velocityX = this.getVelocityX(participant.point, deltaTime);
      const velocityY = this.getVelocityY(participant.point, deltaTime);
      const weight = (participant.point.invMass * participant.normalWeight) / denominator;

      this.setVelocity(participant.point, velocityX + deltaVelocityX * weight, velocityY + deltaVelocityY * weight, deltaTime);
    }
  }

  private applyGlobalVelocityDamping(deltaTime: number): void {
    if (this.config.globalDamping <= EPSILON) {
      return;
    }

    const dampingScale = Math.exp(-this.config.globalDamping * deltaTime);

    for (const point of this.points) {
      if (!point || point.pinned) {
        continue;
      }

      const velocityX = this.getVelocityX(point, deltaTime) * dampingScale;
      const velocityY = this.getVelocityY(point, deltaTime) * dampingScale;

      this.setVelocity(point, velocityX, velocityY, deltaTime);
    }
  }

  private breakTornConstraints(): void {
    for (const constraint of this.constraints) {
      if (!constraint?.enabled || constraint.tearThreshold === null) {
        continue;
      }

      const pointA = this.points[constraint.pointAId];
      const pointB = this.points[constraint.pointBId];

      if (!pointA || !pointB) {
        continue;
      }

      const currentLength = distance(pointA, pointB);

      if (currentLength > constraint.restLength * constraint.tearThreshold || currentLength < constraint.restLength / constraint.tearThreshold) {
        this.constraints[constraint.id] = undefined;
      }
    }

  }

  private getVelocityX(point: PointState, deltaTime: number): number {
    return (point.x - point.prevX) / deltaTime;
  }

  private getVelocityY(point: PointState, deltaTime: number): number {
    return (point.y - point.prevY) / deltaTime;
  }

  private setVelocity(point: PointState, velocityX: number, velocityY: number, deltaTime: number) {
    point.prevX = point.x - velocityX * deltaTime;
    point.prevY = point.y - velocityY * deltaTime;
  }
}

export function createWorld(options: CreateWorldOptions): PhysicsWorld {
  return new SoftBodyWorld(options);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
