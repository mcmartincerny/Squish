import type { ConstraintId, PhysicsWorld, PointId, PointSnapshot, RaycastHit, Vec2Like, WorldController } from "../../index.ts";

const EPSILON = 1e-6;

export interface CharacterControlInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jump: boolean;
  aimTarget: Vec2Like | null;
}

export interface CharacterRig {
  headId: PointId;
  upperChestId: PointId;
  lowerBodyId: PointId;
  leftHandId: PointId;
  rightHandId: PointId;
  leftFootId: PointId;
  rightFootId: PointId;
  neckConstraintId: ConstraintId;
  spineConstraintId: ConstraintId;
  leftArmConstraintId: ConstraintId;
  rightArmConstraintId: ConstraintId;
  leftLegConstraintId: ConstraintId;
  rightLegConstraintId: ConstraintId;
}

export interface CharacterBodyParts {
  head: PointSnapshot | null;
  upperChest: PointSnapshot | null;
  lowerBody: PointSnapshot | null;
  leftHand: PointSnapshot | null;
  rightHand: PointSnapshot | null;
  leftFoot: PointSnapshot | null;
  rightFoot: PointSnapshot | null;
}

export interface RaycastBellowResult {
  leftFoot: RaycastHit | null;
  rightFoot: RaycastHit | null;
  lowerBody: RaycastHit | null;
  upperChest: RaycastHit | null;
}

interface WeightedPoint {
  pointId: PointId;
  weight: number;
}

export class CharacterController implements WorldController {
  private world: PhysicsWorld;
  private readonly rig: CharacterRig;
  private initialLeftLegLength: number;
  private initialRightLegLength: number;
  private input: CharacterControlInput = {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    aimTarget: null,
  };

  constructor(world: PhysicsWorld, rig: CharacterRig) {
    this.world = world;
    this.rig = rig;
    this.world.registerController(this);
    this.initialLeftLegLength = this.world.getConstraint(this.rig.leftLegConstraintId)!.restLength;
    this.initialRightLegLength = this.world.getConstraint(this.rig.rightLegConstraintId)!.restLength;
  }

  /**
   * Stores the latest external input state without acting on it yet.
   */
  setInput(input: CharacterControlInput): void {
    this.input = {
      ...input,
      aimTarget: input.aimTarget ? { ...input.aimTarget } : null,
    };
  }

  private lastTimeFeetWereOnGround = 0;
  private recentFeetOnGroundTimeout = 1000;

  /**
   * World-driven update hook. For now it only resolves the rig body parts and exits
   * early if the spawned character is incomplete.
   */
  update(deltaTime: number): void {
    void deltaTime;
    void this.input;

    const { head, upperChest, lowerBody, leftHand, rightHand, leftFoot, rightFoot } = this.getBodyParts();

    if (!head || !upperChest || !lowerBody || !leftHand || !rightHand || !leftFoot || !rightFoot) {
      return;
    }

    const rays = this.raycastBellow();

    const feetOnGround = (rays.leftFoot?.distance ?? 99) < 1 || (rays.rightFoot?.distance ?? 99) < 1;
    if (feetOnGround) {
      this.lastTimeFeetWereOnGround = performance.now();
    }
    const feetRecentlyOnGround = performance.now() - this.lastTimeFeetWereOnGround < this.recentFeetOnGroundTimeout;

    if (!this.input.down && feetRecentlyOnGround) {
      // Stabilize lowerBody with upperChest
      this.applyUprightCorrectionForce(upperChest, lowerBody, { maxForce: 10000, desiredAngleDeg: -90 });
      // Stabilize head with upperChest
      this.applyUprightCorrectionForce(head, upperChest, { maxForce: 3000, desiredAngleDeg: -90 });
      // Keep left leg under lowerBody
      this.applyUprightCorrectionForce(leftFoot, lowerBody, { maxForce: 10000, desiredAngleDeg: 100 });
      // Keep right leg under lowerBody
      this.applyUprightCorrectionForce(rightFoot, lowerBody, { maxForce: 10000, desiredAngleDeg: 80 });

      this.handleJump(deltaTime);
    }
  }

  // How shorter are legs when fully prepared for jump
  private LEG_SHORTEN_DISTANCE_MULTIPLIER = 0.5;
  private MS_TO_FULLY_SHORTEN = 500;
  handleJump(deltaTime: number): void {
    if (this.input.jump) {
      this.slowlyChangeConstraintLength(
        this.rig.leftLegConstraintId,
        this.LEG_SHORTEN_DISTANCE_MULTIPLIER,
        this.MS_TO_FULLY_SHORTEN,
        this.initialLeftLegLength,
        deltaTime,
      );
      this.slowlyChangeConstraintLength(
        this.rig.rightLegConstraintId,
        this.LEG_SHORTEN_DISTANCE_MULTIPLIER,
        this.MS_TO_FULLY_SHORTEN,
        this.initialRightLegLength,
        deltaTime,
      );
    } else {
      this.world.setConstraintRestLength({
        constraintId: this.rig.leftLegConstraintId,
        length: this.initialLeftLegLength,
      });
      this.world.setConstraintRestLength({
        constraintId: this.rig.rightLegConstraintId,
        length: this.initialRightLegLength,
      });
    }
  }
  
  /**
   * Moves a constraint's rest length toward `initialLength * finalLengthMultiplier`
   * at a constant rate so the transition completes in `timeToChange` ms from rest length.
   */
  private slowlyChangeConstraintLength(
    constraintId: ConstraintId,
    finalLengthMultiplier: number,
    timeToChange: number,
    initialLength: number,
    deltaTime: number,
  ): void {
    const constraint = this.world.getConstraint(constraintId)!;
    const currentLength = constraint.restLength;
    const targetLength = initialLength * finalLengthMultiplier;
    const shortenPerMs = (initialLength - targetLength) / timeToChange;
    const shortenAmount = shortenPerMs * deltaTime * 1000;
    let nextLength = currentLength - shortenAmount;
    if (nextLength < targetLength) {
      nextLength = targetLength;
    }
    this.world.setConstraintRestLength({
      constraintId,
      length: nextLength,
    });
  }

  /**
   * Removes the full character rig from the provided world and detaches the controller.
   */
  remove(): void {
    this.world.deregisterController(this);

    const pointIds = [
      this.rig.headId,
      this.rig.upperChestId,
      this.rig.lowerBodyId,
      this.rig.leftHandId,
      this.rig.rightHandId,
      this.rig.leftFootId,
      this.rig.rightFootId,
    ];

    for (const pointId of pointIds) {
      try {
        this.world.removePoint(pointId);
      } catch {
        // Ignore stale ids when the world was recreated or manually edited.
      }
    }
  }

  /**
   * Resolves all main rig body parts directly from the live world state.
   */
  getBodyParts(): CharacterBodyParts {
    const world = this.world;

    if (!world) {
      throw new Error("World is not set");
    }

    // TODO: This could be later changed to the exact point, not point snapshots - faster
    return {
      head: world.getPoint(this.rig.headId),
      upperChest: world.getPoint(this.rig.upperChestId),
      lowerBody: world.getPoint(this.rig.lowerBodyId),
      leftHand: world.getPoint(this.rig.leftHandId),
      rightHand: world.getPoint(this.rig.rightHandId),
      leftFoot: world.getPoint(this.rig.leftFootId),
      rightFoot: world.getPoint(this.rig.rightFootId),
    };
  }

  getBodyConstraintIds(): ConstraintId[] {
    return [
      this.rig.neckConstraintId,
      this.rig.spineConstraintId,
      this.rig.leftArmConstraintId,
      this.rig.rightArmConstraintId,
      this.rig.leftLegConstraintId,
      this.rig.rightLegConstraintId,
    ];
  }

  /**
   * Casts vertical rays below the key body parts that are commonly useful for stance
   * and support experiments.
   */
  raycastBellow(maxDistance = 10): RaycastBellowResult {
    const { leftFoot, rightFoot, lowerBody, upperChest } = this.getBodyParts();

    const ignoreConstraintIds = this.getBodyConstraintIds();

    return {
      leftFoot: raycastBelowPoint(this.world, leftFoot, maxDistance, ignoreConstraintIds),
      rightFoot: raycastBelowPoint(this.world, rightFoot, maxDistance, ignoreConstraintIds),
      // TODO: lower body and upper chest might not be needed later
      lowerBody: raycastBelowPoint(this.world, lowerBody, maxDistance, ignoreConstraintIds),
      upperChest: raycastBelowPoint(this.world, upperChest, maxDistance, ignoreConstraintIds),
    };
  }

  /**
   * Applies equal-and-opposite forces between one driven point and one or more anchors.
   */
  applyBalancedForce(pointId: PointId, force: Vec2Like, anchors: WeightedPoint[]): void {
    const world = this.world;

    if (!world) {
      return;
    }

    world.applyPointForce({
      pointId,
      force,
    });

    const normalizedAnchors = normalizeWeightedPoints(anchors);

    for (const anchor of normalizedAnchors) {
      world.applyPointForce({
        pointId: anchor.pointId,
        force: {
          x: -force.x * anchor.weight,
          y: -force.y * anchor.weight,
        },
      });
    }
  }

  /**
   * Computes a spring-damper tracking force for a point and applies it through the
   * balanced-force helper so the net external force stays zero.
   */
  applyBalancedTracking(
    point: PointSnapshot,
    target: Vec2Like,
    deltaTime: number,
    springStrength: number,
    dampingStrength: number,
    maxForce: number,
    anchors: WeightedPoint[],
  ): void {
    const force = computeTrackingForce(point, target, deltaTime, springStrength, dampingStrength, maxForce);
    this.applyBalancedForce(point.id, force, anchors);
  }

  /**
   * Applies a capped PD-style rotational correction that tries to keep `upperPoint`
   * above `lowerPoint` by pushing them along the segment's perpendicular axis.
   */
  applyUprightCorrectionForce(
    upperPoint: PointSnapshot,
    lowerPoint: PointSnapshot,
    options: { maxForce: number; desiredAngleDeg?: number; proportionalGain?: number; dampingGain?: number; exponentialGain?: number },
  ): void {
    const { maxForce, desiredAngleDeg = -90, proportionalGain = 1, dampingGain = 1.5, exponentialGain = 0.65 } = options;

    const deltaX = upperPoint.position.x - lowerPoint.position.x;
    const deltaY = upperPoint.position.y - lowerPoint.position.y;
    const length = Math.hypot(deltaX, deltaY);

    if (length <= EPSILON || maxForce <= EPSILON) {
      return;
    }

    const directionX = deltaX / length;
    const directionY = deltaY / length;
    const currentAngle = Math.atan2(directionY, directionX);
    const previousAngle = Math.atan2(
      upperPoint.previousPosition.y - lowerPoint.previousPosition.y,
      upperPoint.previousPosition.x - lowerPoint.previousPosition.x,
    );
    const desiredAngle = desiredAngleDeg * DEG2RAD;
    const angleError = normalizeAngle(desiredAngle - currentAngle);
    const angularVelocity = normalizeAngle(currentAngle - previousAngle);
    const normalX = -directionY;
    const normalY = directionX;
    const normalizedError = Math.min(Math.abs(angleError) / (Math.PI / 2), 1);
    const proportionalForce = Math.sign(angleError) * Math.pow(normalizedError, exponentialGain) * maxForce * proportionalGain;
    const dampingForce = angularVelocity * maxForce * dampingGain;
    const correctionMagnitude = clamp(proportionalForce - dampingForce, -maxForce, maxForce);
    const correctionForce = {
      x: normalX * correctionMagnitude,
      y: normalY * correctionMagnitude,
    };

    this.applyBalancedForce(upperPoint.id, correctionForce, [{ pointId: lowerPoint.id, weight: 1 }]);
  }
}

/**
 * Computes the spring-damper force needed to move a point toward a target.
 */
function computeTrackingForce(
  point: PointSnapshot,
  target: Vec2Like,
  deltaTime: number,
  springStrength: number,
  dampingStrength: number,
  maxForce: number,
): Vec2Like {
  const velocityX = (point.position.x - point.previousPosition.x) / Math.max(deltaTime, EPSILON);
  const velocityY = (point.position.y - point.previousPosition.y) / Math.max(deltaTime, EPSILON);
  const forceX = (target.x - point.position.x) * springStrength - velocityX * dampingStrength;
  const forceY = (target.y - point.position.y) * springStrength - velocityY * dampingStrength;
  return clampVector(forceX, forceY, maxForce);
}

/**
 * Clamps a vector to the provided maximum magnitude.
 */
function clampVector(x: number, y: number, maxMagnitude: number): Vec2Like {
  const magnitude = Math.hypot(x, y);

  if (!Number.isFinite(maxMagnitude) || magnitude <= maxMagnitude || magnitude <= EPSILON) {
    return { x, y };
  }

  const scale = maxMagnitude / magnitude;
  return {
    x: x * scale,
    y: y * scale,
  };
}

/**
 * Normalizes anchor weights so they can be used for equal-and-opposite force splits.
 */
function normalizeWeightedPoints<T extends WeightedPoint>(points: Array<T>): Array<T> {
  const validPoints = points.filter((point) => point.weight > EPSILON);
  const totalWeight = validPoints.reduce((sum, point) => sum + point.weight, 0);

  if (totalWeight <= EPSILON) {
    return [];
  }

  return validPoints.map((point) => ({
    ...point,
    weight: point.weight / totalWeight,
  }));
}

/**
 * Casts a vertical ray below one point and returns the nearest hit.
 */
function raycastBelowPoint(
  world: PhysicsWorld | null,
  point: PointSnapshot | null,
  maxDistance: number,
  ignoreConstraintIds?: ConstraintId[],
): RaycastHit | null {
  if (!world || !point || maxDistance <= 0) {
    return null;
  }

  return world.raycast({
    origin: {
      x: point.position.x,
      y: point.position.y + point.radius,
    },
    direction: { x: 0, y: 1 },
    maxDistance,
    layers: point.layers,
    ignoreConstraintIds,
  });
}

/**
 * Wraps an angle into the `[-pi, pi]` range so correction forces choose the shorter rotation.
 */
function normalizeAngle(angle: number): number {
  let normalized = angle;

  while (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  }

  while (normalized < -Math.PI) {
    normalized += Math.PI * 2;
  }

  return normalized;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Multiply degrees with this to get radians.
 */
const DEG2RAD = Math.PI / 180;
