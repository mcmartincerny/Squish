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
  readonly rig: CharacterRig;
  private initialLeftLegLength: number;
  private initialRightLegLength: number;
  private stanceFoot: "left" | "right" = "left";
  private lastWalkDirection = 1;
  private currentStepElapsedMs = 0;
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
  private WALK_STEP_MIN_TIME_MS = 0;
  private WALK_STEP_MAX_TIME_MS = 300;
  private WALK_SWING_LEG_LENGTH_MULTIPLIER = 0.7;
  private WALK_STANCE_MAX_FORCE = 11000;
  private WALK_SWING_MAX_FORCE = 7500;
  private WALK_STANCE_BODY_ANGLE_OFFSET_DEG = 14;
  private WALK_SWING_BODY_ANGLE_OFFSET_DEG = 14;
  private WALK_SWING_REEXTEND_ANGLE_THRESHOLD_DEG = 14;
  private WALK_FOOT_GROUNDED_DISTANCE = 2;
  private WALK_SWITCH_X_OFFSET = 3;

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

    const feetOnGround = (rays.leftFoot?.distance ?? 99) < this.WALK_FOOT_GROUNDED_DISTANCE || (rays.rightFoot?.distance ?? 99) < this.WALK_FOOT_GROUNDED_DISTANCE;
    if (feetOnGround) {
      this.lastTimeFeetWereOnGround = performance.now();
    }
    const feetRecentlyOnGround = performance.now() - this.lastTimeFeetWereOnGround < this.recentFeetOnGroundTimeout;

    if (!this.input.down && feetRecentlyOnGround) {
      // Stabilize lowerBody with upperChest
      this.applyUprightCorrectionForce(upperChest, lowerBody, { maxForce: 10000, desiredAngleDeg: -90 });
      // Stabilize head with upperChest
      this.applyUprightCorrectionForce(head, upperChest, { maxForce: 3000, desiredAngleDeg: -90 });
      if (!this.input.left && !this.input.right) {
        // Keep left leg under lowerBody
        this.applyUprightCorrectionForce(lowerBody, leftFoot, { maxForce: 10000, desiredAngleDeg: -80 });
        // Keep right leg under lowerBody
        this.applyUprightCorrectionForce(lowerBody, rightFoot, { maxForce: 10000, desiredAngleDeg: -100 });
      }

      // this.handleJump(deltaTime);
      this.handleWalking(deltaTime, rays, lowerBody, leftFoot, rightFoot);
    }
  }

  handleWalking(deltaTime: number, rays: RaycastBellowResult, lowerBody: PointSnapshot, leftFoot: PointSnapshot, rightFoot: PointSnapshot): void {
    const moveDirection = Number(this.input.right) - Number(this.input.left);

    if (Math.abs(moveDirection) < EPSILON) {
      this.currentStepElapsedMs = 0;
      this.restoreWalkLegLengths(deltaTime);
      return;
    }

    const direction = Math.sign(moveDirection) || this.lastWalkDirection;
    const leftGrounded = (rays.leftFoot?.distance ?? Number.POSITIVE_INFINITY) <= this.WALK_FOOT_GROUNDED_DISTANCE;
    const rightGrounded = (rays.rightFoot?.distance ?? Number.POSITIVE_INFINITY) <= this.WALK_FOOT_GROUNDED_DISTANCE;

    if (direction !== this.lastWalkDirection) {
      this.lastWalkDirection = direction;
      this.currentStepElapsedMs = 0;
      this.stanceFoot = direction > 0 ? "left" : "right";
    }

    if (!leftGrounded && rightGrounded) {
      this.stanceFoot = "right";
      this.currentStepElapsedMs = 0;
    } else if (!rightGrounded && leftGrounded) {
      this.stanceFoot = "left";
      this.currentStepElapsedMs = 0;
    }

    this.currentStepElapsedMs += deltaTime * 1000;

    const stanceFootPoint = this.stanceFoot === "left" ? leftFoot : rightFoot;
    const swingFootPoint = this.stanceFoot === "left" ? rightFoot : leftFoot;
    const stanceRay = this.stanceFoot === "left" ? rays.leftFoot : rays.rightFoot;
    const swingRay = this.stanceFoot === "left" ? rays.rightFoot : rays.leftFoot;
    const stanceConstraintId = this.stanceFoot === "left" ? this.rig.leftLegConstraintId : this.rig.rightLegConstraintId;
    const swingConstraintId = this.stanceFoot === "left" ? this.rig.rightLegConstraintId : this.rig.leftLegConstraintId;
    const stanceInitialLength = this.stanceFoot === "left" ? this.initialLeftLegLength : this.initialRightLegLength;
    const swingInitialLength = this.stanceFoot === "left" ? this.initialRightLegLength : this.initialLeftLegLength;

    const stanceAngle = direction > 0 ? -90 + this.WALK_STANCE_BODY_ANGLE_OFFSET_DEG : -90 - this.WALK_STANCE_BODY_ANGLE_OFFSET_DEG;
    const swingAngle = direction > 0 ? -90 - this.WALK_SWING_BODY_ANGLE_OFFSET_DEG : -90 + this.WALK_SWING_BODY_ANGLE_OFFSET_DEG;
    const currentSwingAngleDeg =
      Math.atan2(lowerBody.position.y - swingFootPoint.position.y, lowerBody.position.x - swingFootPoint.position.x) / DEG2RAD;

    this.applyUprightCorrectionForce(lowerBody, stanceFootPoint, {
      maxForce: this.WALK_STANCE_MAX_FORCE,
      desiredAngleDeg: stanceAngle,
      proportionalGain: 1.05,
      dampingGain: 3,
    });
    this.applyUprightCorrectionForce(lowerBody, swingFootPoint, {
      maxForce: this.WALK_SWING_MAX_FORCE,
      desiredAngleDeg: swingAngle,
      proportionalGain: 0.9,
      dampingGain: 1.15,
    });

    const swingAheadOfBody =
      direction > 0
        ? swingFootPoint.position.x >= lowerBody.position.x + this.WALK_SWITCH_X_OFFSET
        : swingFootPoint.position.x <= lowerBody.position.x - this.WALK_SWITCH_X_OFFSET;

    const swingCloseToForwardAngle =
      Math.abs(normalizeAngle((swingAngle - currentSwingAngleDeg) * DEG2RAD)) <= this.WALK_SWING_REEXTEND_ANGLE_THRESHOLD_DEG * DEG2RAD;

    const swingTargetLength = swingAheadOfBody && swingCloseToForwardAngle
      ? swingInitialLength
      : swingInitialLength * this.WALK_SWING_LEG_LENGTH_MULTIPLIER;

    this.slowlyChangeConstraintLength(
      swingConstraintId,
      swingTargetLength,
      200,
      deltaTime,
    );
    this.slowlyChangeConstraintLength(stanceConstraintId, stanceInitialLength, 200, deltaTime);

    const swingGrounded = (swingRay?.distance ?? Number.POSITIVE_INFINITY) <= this.WALK_FOOT_GROUNDED_DISTANCE;
    const timedOut = this.currentStepElapsedMs >= this.WALK_STEP_MAX_TIME_MS;
    const readyToSwitch = this.currentStepElapsedMs >= this.WALK_STEP_MIN_TIME_MS && swingGrounded && swingAheadOfBody;
    const stanceLostGround = (stanceRay?.distance ?? Number.POSITIVE_INFINITY) > this.WALK_FOOT_GROUNDED_DISTANCE && swingGrounded;

    if (readyToSwitch || timedOut || stanceLostGround) {
      this.stanceFoot = this.stanceFoot === "left" ? "right" : "left";
      console.log("stanceFoot", this.stanceFoot);
      this.currentStepElapsedMs = 0;
    }
  }

  // How shorter are legs when fully prepared for jump
  private LEG_SHORTEN_DISTANCE_MULTIPLIER = 0.5;
  handleJump(deltaTime: number): void {
    if (this.input.jump) {
      this.slowlyChangeConstraintLength(
        this.rig.leftLegConstraintId,
        this.initialLeftLegLength * this.LEG_SHORTEN_DISTANCE_MULTIPLIER,
        110,
        deltaTime,
      );
      this.slowlyChangeConstraintLength(
        this.rig.rightLegConstraintId,
        this.initialRightLegLength * this.LEG_SHORTEN_DISTANCE_MULTIPLIER,
        110,
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
   * Moves a constraint rest length toward an absolute target length at a fixed speed.
   */
  private slowlyChangeConstraintLength(
    constraintId: ConstraintId,
    finalLength: number,
    lengthPerSecond = 50,
    deltaTime: number,
  ): void {
    const constraint = this.world.getConstraint(constraintId)!;
    const currentLength = constraint.restLength;
    const targetLength = finalLength;

    if (Math.abs(targetLength - currentLength) <= EPSILON) {
      return;
    }

    const maxStep = lengthPerSecond * deltaTime;
    const nextLength = moveTowards(currentLength, targetLength, maxStep);

    this.world.setConstraintRestLength({
      constraintId,
      length: nextLength,
    });
  }

  private restoreWalkLegLengths(deltaTime: number): void {
    this.slowlyChangeConstraintLength(this.rig.leftLegConstraintId, this.initialLeftLegLength, 200, deltaTime);
    this.slowlyChangeConstraintLength(this.rig.rightLegConstraintId, this.initialRightLegLength, 200, deltaTime);
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

function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) {
    return target;
  }

  return current + Math.sign(target - current) * maxDelta;
}

/**
 * Multiply degrees with this to get radians.
 */
const DEG2RAD = Math.PI / 180;
