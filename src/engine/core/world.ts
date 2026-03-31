import { SpatialHashGrid } from "../collision/spatialHashGrid.ts";
import type {
  ApplyRadialForceOptions,
  BodyId,
  BodySnapshot,
  ConstraintId,
  ConstraintSnapshot,
  CreateConstraintOptions,
  CreatePointOptions,
  CreateWorldOptions,
  GridCellSnapshot,
  PhysicsWorld,
  PointId,
  PointSnapshot,
  SetPointPositionOptions,
  WorldConfig,
  WorldSnapshot,
} from "../entities/types.ts";
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
  bodyId: BodyId;
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
}

interface BodyState {
  id: BodyId;
  pointIds: PointId[];
  constraintIds: ConstraintId[];
  colliderConstraintIds: ConstraintId[];
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
  private readonly bodies: BodyState[] = [];
  private readonly broadphase: SpatialHashGrid;

  private nextBodyId = 1;
  private topologyDirty = true;
  private maxColliderRadius = 0;
  private config: WorldConfig;

  constructor(options: CreateWorldOptions) {
    this.config = toWorldConfig(options);
    this.broadphase = new SpatialHashGrid(this.config.gridCellSize);
  }

  createPoint(options: CreatePointOptions): PointId {
    const id = this.points.length;
    const mass = options.pinned ? Number.POSITIVE_INFINITY : Math.max(options.mass ?? 1, EPSILON);
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
      bodyId: -1,
    };

    this.points[id] = point;
    this.topologyDirty = true;

    return id;
  }

  createConstraint(options: CreateConstraintOptions): ConstraintId {
    const pointA = this.requirePoint(options.pointAId);
    const pointB = this.requirePoint(options.pointBId);
    const id = this.constraints.length;
    const restLength = options.length ?? distance({ x: pointA.x, y: pointA.y }, { x: pointB.x, y: pointB.y });

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
    };

    this.constraints[id] = constraint;
    this.topologyDirty = true;

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

    this.topologyDirty = true;
  }

  removeConstraint(constraintId: ConstraintId): void {
    this.requireConstraint(constraintId);
    this.constraints[constraintId] = undefined;
    this.topologyDirty = true;
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
    this.ensureBodiesUpToDate();
    this.rebuildBroadphase();

    const points: PointSnapshot[] = [];
    const constraints: ConstraintSnapshot[] = [];
    const gridCells: GridCellSnapshot[] = this.broadphase.getSnapshot();
    const bodies: BodySnapshot[] = this.bodies.map((body) => ({
      id: body.id,
      pointIds: [...body.pointIds],
      constraintIds: [...body.constraintIds],
      colliderConstraintIds: [...body.colliderConstraintIds],
    }));

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
        bodyId: point.bodyId,
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
      });
    }

    return {
      config: this.getConfig(),
      points,
      constraints,
      bodies,
      gridCells,
    };
  }

  step(deltaTime: number): void {
    if (deltaTime <= 0) {
      return;
    }

    this.ensureBodiesUpToDate();
    this.integrate(deltaTime);
    this.rebuildBroadphase();

    for (let iteration = 0; iteration < this.config.iterations; iteration += 1) {
      this.solveWorldBounds(deltaTime);
      this.solveConstraints(deltaTime);
      this.solvePointVsCapsuleContacts(deltaTime);
    }

    this.applyGlobalVelocityDamping(deltaTime);
    this.breakTornConstraints();
    this.ensureBodiesUpToDate();
  }

  clear(): void {
    this.points.length = 0;
    this.constraints.length = 0;
    this.bodies.length = 0;
    this.topologyDirty = true;
    this.maxColliderRadius = 0;
    this.nextBodyId = 1;
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

  private ensureBodiesUpToDate(): void {
    if (!this.topologyDirty) {
      return;
    }
    this.recomputeBodies();
    this.topologyDirty = false;
  }

  private recomputeBodies(): void {
    this.bodies.length = 0;

    const activePointIds = this.points.flatMap((point) => (point ? [point.id] : []));
    const neighbors = new Map<PointId, PointId[]>();
    const pointConstraintIds = new Map<PointId, ConstraintId[]>();

    for (const pointId of activePointIds) {
      neighbors.set(pointId, []);
      pointConstraintIds.set(pointId, []);
    }

    for (const constraint of this.constraints) {
      if (!constraint?.enabled) {
        continue;
      }

      const pointA = this.points[constraint.pointAId];
      const pointB = this.points[constraint.pointBId];

      if (!pointA || !pointB) {
        continue;
      }

      neighbors.get(pointA.id)?.push(pointB.id);
      neighbors.get(pointB.id)?.push(pointA.id);
      pointConstraintIds.get(pointA.id)?.push(constraint.id);
      pointConstraintIds.get(pointB.id)?.push(constraint.id);
    }

    const visited = new Set<PointId>();

    for (const pointId of activePointIds) {
      if (visited.has(pointId)) {
        continue;
      }

      const stack = [pointId];
      const componentPointIds: PointId[] = [];
      const componentConstraintIds = new Set<ConstraintId>();

      visited.add(pointId);

      while (stack.length > 0) {
        const currentPointId = stack.pop();

        if (currentPointId === undefined) {
          continue;
        }

        componentPointIds.push(currentPointId);

        for (const constraintId of pointConstraintIds.get(currentPointId) ?? []) {
          componentConstraintIds.add(constraintId);
        }

        for (const neighbor of neighbors.get(currentPointId) ?? []) {
          if (visited.has(neighbor)) {
            continue;
          }

          visited.add(neighbor);
          stack.push(neighbor);
        }
      }

      const bodyId = this.nextBodyId;
      this.nextBodyId += 1;
      const constraintIds = [...componentConstraintIds];
      const colliderConstraintIds = constraintIds.filter((constraintId) => {
        const constraint = this.constraints[constraintId];
        return Boolean(constraint && constraint.collisionRadius > 0);
      });

      for (const componentPointId of componentPointIds) {
        const point = this.points[componentPointId];

        if (point) {
          point.bodyId = bodyId;
        }
      }

      this.bodies.push({
        id: bodyId,
        pointIds: componentPointIds,
        constraintIds,
        colliderConstraintIds,
      });
    }
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
      this.broadphase.insert(constraint.id, {
        minX: Math.min(pointA.x, pointB.x) - constraint.collisionRadius,
        minY: Math.min(pointA.y, pointB.y) - constraint.collisionRadius,
        maxX: Math.max(pointA.x, pointB.x) + constraint.collisionRadius,
        maxY: Math.max(pointA.y, pointB.y) + constraint.collisionRadius,
      });
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
      const correctionScale = (difference / currentLength) * constraint.stiffness;
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

      if (constraint.damping <= EPSILON) {
        continue;
      }

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
  }

  private solvePointVsCapsuleContacts(deltaTime: number): void {
    for (const point of this.points) {
      if (!point) {
        continue;
      }

      const candidateConstraintIds = this.broadphase.queryCircle(point.x, point.y, point.radius + this.maxColliderRadius);

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
    let brokeConstraint = false;

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
        brokeConstraint = true;
      }
    }

    if (brokeConstraint) {
      this.topologyDirty = true;
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
