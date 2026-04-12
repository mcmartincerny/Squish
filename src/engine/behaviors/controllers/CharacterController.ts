import type { ConstraintId, PhysicsWorld, PointId, RaycastHit, Vec2Like, WorldController } from "../../index.ts";
import type { PointState } from "../../core/world";

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
  head: PointState | null;
  upperChest: PointState | null;
  lowerBody: PointState | null;
  leftHand: PointState | null;
  rightHand: PointState | null;
  leftFoot: PointState | null;
  rightFoot: PointState | null;
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

type FootSide = "left" | "right";

interface GroundProbe {
  hit: RaycastHit;
  footX: number;
  footY: number;
  surfaceY: number;
}

interface StepLandingTarget {
  footPosition: Vec2Like;
  surfacePoint: Vec2Like;
  surfaceNormal: Vec2Like;
  score: number;
  obstacleClearance: number;
}

interface StepPlan {
  direction: number;
  stanceFoot: FootSide;
  swingFoot: FootSide;
  stanceAnchor: Vec2Like;
  swingStart: Vec2Like;
  lowerBodyStart: Vec2Like;
  landingTarget: StepLandingTarget | null;
  desiredLowerBodyX: number;
  arcHeight: number;
}

export interface CharacterConstantsOverride {
  WALK_SWING_LEG_LENGTH_MULTIPLIER?: number;
  WALK_STANCE_MAX_FORCE?: number;
  WALK_SWING_MAX_FORCE?: number;
  WALK_STANCE_BODY_ANGLE_OFFSET_DEG?: number;
  WALK_SWING_BODY_ANGLE_OFFSET_DEG?: number;
  WALK_SWING_REEXTEND_ANGLE_THRESHOLD_DEG?: number;
  WALK_LEG_CHANGE_LENGTH_PER_SECOND?: number;
  WALK_SWITCH_X_OFFSET?: number;
  LOWER_BODY_FORWARD_ASSIST_FORCE?: number;
  LOWER_BODY_VERTICAL_ASSIST_FORCE?: number;
  IDEAL_STEP_LENGTH_X?: number;
  IDEAL_STEP_TIME_MS?: number;
  IDEAL_LOWER_BODY_DISTANCE_FROM_GROUND?: number;
  MIN_STANCE_LEG_LENGTH_MULTIPLIER?: number;
  MAX_STANCE_LEG_LENGTH_MULTIPLIER?: number;
  MIN_SWING_LEG_LENGTH_MULTIPLIER?: number;
  MAX_SWING_LEG_LENGTH_MULTIPLIER?: number;
  BODY_TARGET_FORWARD_RATIO?: number;
  STEP_SEARCH_X_RANGE?: number;
  STEP_SEARCH_SAMPLE_COUNT?: number;
  STEP_SEARCH_UP_HEIGHT?: number;
  STEP_SEARCH_DOWN_DISTANCE?: number;
  SWING_FOOT_BASE_CLEARANCE?: number;
  SWING_FOOT_OBSTACLE_CLEARANCE_MARGIN?: number;
  SWING_FOOT_TARGET_FORCE?: number;
  LOWER_BODY_TARGET_FORCE_STIFFNESS?: number;
  LOWER_BODY_TARGET_FORCE_DAMPING?: number;
  SWING_FOOT_TARGET_FORCE_STIFFNESS?: number;
  SWING_FOOT_TARGET_FORCE_DAMPING?: number;
  STANCE_FOOT_GRIP_STIFFNESS?: number;
  STANCE_FOOT_GRIP_DAMPING?: number;
  STANCE_FOOT_MAX_GRIP_FORCE?: number;
  STANCE_LEG_LENGTH_CHANGE_PER_SECOND?: number;
  SWING_LEG_LENGTH_CHANGE_PER_SECOND?: number;
  SWING_LEG_LIFT_LENGTH_MULTIPLIER?: number;
  MIN_STEP_DURATION_RATIO?: number;
  MAX_STEP_DURATION_RATIO?: number;
  MIN_GROUND_NORMAL_Y?: number;
  MAX_STEP_DOWN_DISTANCE?: number;
  SWING_REACHED_X_DISTANCE?: number;
  SWING_REACHED_Y_DISTANCE?: number;
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

  constructor(world: PhysicsWorld, rig: CharacterRig, characterConstants?: CharacterConstantsOverride) {
    this.world = world;
    this.rig = rig;
    this.world.registerController(this);
    this.initialLeftLegLength = this.world.getConstraintSnapshot(this.rig.leftLegConstraintId)!.restLength;
    this.initialRightLegLength = this.world.getConstraintSnapshot(this.rig.rightLegConstraintId)!.restLength;

    // Override default constants with any provided overrides
    this.WALK_SWING_LEG_LENGTH_MULTIPLIER = characterConstants?.WALK_SWING_LEG_LENGTH_MULTIPLIER ?? this.WALK_SWING_LEG_LENGTH_MULTIPLIER;
    this.WALK_STANCE_MAX_FORCE = characterConstants?.WALK_STANCE_MAX_FORCE ?? this.WALK_STANCE_MAX_FORCE;
    this.WALK_SWING_MAX_FORCE = characterConstants?.WALK_SWING_MAX_FORCE ?? this.WALK_SWING_MAX_FORCE;
    this.WALK_STANCE_BODY_ANGLE_OFFSET_DEG = characterConstants?.WALK_STANCE_BODY_ANGLE_OFFSET_DEG ?? this.WALK_STANCE_BODY_ANGLE_OFFSET_DEG;
    this.WALK_SWING_BODY_ANGLE_OFFSET_DEG = characterConstants?.WALK_SWING_BODY_ANGLE_OFFSET_DEG ?? this.WALK_SWING_BODY_ANGLE_OFFSET_DEG;
    this.WALK_SWING_REEXTEND_ANGLE_THRESHOLD_DEG = characterConstants?.WALK_SWING_REEXTEND_ANGLE_THRESHOLD_DEG ?? this.WALK_SWING_REEXTEND_ANGLE_THRESHOLD_DEG;
    this.WALK_LEG_CHANGE_LENGTH_PER_SECOND = characterConstants?.WALK_LEG_CHANGE_LENGTH_PER_SECOND ?? this.WALK_LEG_CHANGE_LENGTH_PER_SECOND;
    this.WALK_SWITCH_X_OFFSET = characterConstants?.WALK_SWITCH_X_OFFSET ?? this.WALK_SWITCH_X_OFFSET;
    this.LOWER_BODY_FORWARD_ASSIST_FORCE = characterConstants?.LOWER_BODY_FORWARD_ASSIST_FORCE ?? this.LOWER_BODY_FORWARD_ASSIST_FORCE;
    this.LOWER_BODY_VERTICAL_ASSIST_FORCE = characterConstants?.LOWER_BODY_VERTICAL_ASSIST_FORCE ?? this.LOWER_BODY_VERTICAL_ASSIST_FORCE;
    this.IDEAL_STEP_LENGTH_X = characterConstants?.IDEAL_STEP_LENGTH_X ?? this.IDEAL_STEP_LENGTH_X;
    this.IDEAL_STEP_TIME_MS = characterConstants?.IDEAL_STEP_TIME_MS ?? this.IDEAL_STEP_TIME_MS;
    this.IDEAL_LOWER_BODY_DISTANCE_FROM_GROUND =
      characterConstants?.IDEAL_LOWER_BODY_DISTANCE_FROM_GROUND ?? this.IDEAL_LOWER_BODY_DISTANCE_FROM_GROUND;
    this.MIN_STANCE_LEG_LENGTH_MULTIPLIER =
      characterConstants?.MIN_STANCE_LEG_LENGTH_MULTIPLIER ?? this.MIN_STANCE_LEG_LENGTH_MULTIPLIER;
    this.MAX_STANCE_LEG_LENGTH_MULTIPLIER =
      characterConstants?.MAX_STANCE_LEG_LENGTH_MULTIPLIER ?? this.MAX_STANCE_LEG_LENGTH_MULTIPLIER;
    this.MIN_SWING_LEG_LENGTH_MULTIPLIER =
      characterConstants?.MIN_SWING_LEG_LENGTH_MULTIPLIER ?? this.MIN_SWING_LEG_LENGTH_MULTIPLIER;
    this.MAX_SWING_LEG_LENGTH_MULTIPLIER =
      characterConstants?.MAX_SWING_LEG_LENGTH_MULTIPLIER ?? this.MAX_SWING_LEG_LENGTH_MULTIPLIER;
    this.BODY_TARGET_FORWARD_RATIO = characterConstants?.BODY_TARGET_FORWARD_RATIO ?? this.BODY_TARGET_FORWARD_RATIO;
    this.STEP_SEARCH_X_RANGE = characterConstants?.STEP_SEARCH_X_RANGE ?? this.STEP_SEARCH_X_RANGE;
    this.STEP_SEARCH_SAMPLE_COUNT = characterConstants?.STEP_SEARCH_SAMPLE_COUNT ?? this.STEP_SEARCH_SAMPLE_COUNT;
    this.STEP_SEARCH_UP_HEIGHT = characterConstants?.STEP_SEARCH_UP_HEIGHT ?? this.STEP_SEARCH_UP_HEIGHT;
    this.STEP_SEARCH_DOWN_DISTANCE = characterConstants?.STEP_SEARCH_DOWN_DISTANCE ?? this.STEP_SEARCH_DOWN_DISTANCE;
    this.SWING_FOOT_BASE_CLEARANCE = characterConstants?.SWING_FOOT_BASE_CLEARANCE ?? this.SWING_FOOT_BASE_CLEARANCE;
    this.SWING_FOOT_OBSTACLE_CLEARANCE_MARGIN =
      characterConstants?.SWING_FOOT_OBSTACLE_CLEARANCE_MARGIN ?? this.SWING_FOOT_OBSTACLE_CLEARANCE_MARGIN;
    this.SWING_FOOT_TARGET_FORCE = characterConstants?.SWING_FOOT_TARGET_FORCE ?? this.SWING_FOOT_TARGET_FORCE;
    this.LOWER_BODY_TARGET_FORCE_STIFFNESS =
      characterConstants?.LOWER_BODY_TARGET_FORCE_STIFFNESS ?? this.LOWER_BODY_TARGET_FORCE_STIFFNESS;
    this.LOWER_BODY_TARGET_FORCE_DAMPING =
      characterConstants?.LOWER_BODY_TARGET_FORCE_DAMPING ?? this.LOWER_BODY_TARGET_FORCE_DAMPING;
    this.SWING_FOOT_TARGET_FORCE_STIFFNESS =
      characterConstants?.SWING_FOOT_TARGET_FORCE_STIFFNESS ?? this.SWING_FOOT_TARGET_FORCE_STIFFNESS;
    this.SWING_FOOT_TARGET_FORCE_DAMPING =
      characterConstants?.SWING_FOOT_TARGET_FORCE_DAMPING ?? this.SWING_FOOT_TARGET_FORCE_DAMPING;
    this.STANCE_FOOT_GRIP_STIFFNESS = characterConstants?.STANCE_FOOT_GRIP_STIFFNESS ?? this.STANCE_FOOT_GRIP_STIFFNESS;
    this.STANCE_FOOT_GRIP_DAMPING = characterConstants?.STANCE_FOOT_GRIP_DAMPING ?? this.STANCE_FOOT_GRIP_DAMPING;
    this.STANCE_FOOT_MAX_GRIP_FORCE = characterConstants?.STANCE_FOOT_MAX_GRIP_FORCE ?? this.STANCE_FOOT_MAX_GRIP_FORCE;
    this.STANCE_LEG_LENGTH_CHANGE_PER_SECOND =
      characterConstants?.STANCE_LEG_LENGTH_CHANGE_PER_SECOND ?? this.STANCE_LEG_LENGTH_CHANGE_PER_SECOND;
    this.SWING_LEG_LENGTH_CHANGE_PER_SECOND =
      characterConstants?.SWING_LEG_LENGTH_CHANGE_PER_SECOND ?? this.SWING_LEG_LENGTH_CHANGE_PER_SECOND;
    this.SWING_LEG_LIFT_LENGTH_MULTIPLIER =
      characterConstants?.SWING_LEG_LIFT_LENGTH_MULTIPLIER ?? this.SWING_LEG_LIFT_LENGTH_MULTIPLIER;
    this.MIN_STEP_DURATION_RATIO = characterConstants?.MIN_STEP_DURATION_RATIO ?? this.MIN_STEP_DURATION_RATIO;
    this.MAX_STEP_DURATION_RATIO = characterConstants?.MAX_STEP_DURATION_RATIO ?? this.MAX_STEP_DURATION_RATIO;
    this.MIN_GROUND_NORMAL_Y = characterConstants?.MIN_GROUND_NORMAL_Y ?? this.MIN_GROUND_NORMAL_Y;
    this.MAX_STEP_DOWN_DISTANCE = characterConstants?.MAX_STEP_DOWN_DISTANCE ?? this.MAX_STEP_DOWN_DISTANCE;
    this.SWING_REACHED_X_DISTANCE = characterConstants?.SWING_REACHED_X_DISTANCE ?? this.SWING_REACHED_X_DISTANCE;
    this.SWING_REACHED_Y_DISTANCE = characterConstants?.SWING_REACHED_Y_DISTANCE ?? this.SWING_REACHED_Y_DISTANCE;
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
  private WALK_STEP_MAX_TIME_MS = 99999999;
  private WALK_SWING_LEG_LENGTH_MULTIPLIER = 0.7;
  private WALK_STANCE_MAX_FORCE = 11000;
  private WALK_SWING_MAX_FORCE = 7500;
  private WALK_STANCE_BODY_ANGLE_OFFSET_DEG = 14;  // 6 is weirdly stable
  private WALK_SWING_BODY_ANGLE_OFFSET_DEG = 14;  // 6 is weirdly stable
  private WALK_SWING_REEXTEND_ANGLE_THRESHOLD_DEG = 10;
  private WALK_LEG_CHANGE_LENGTH_PER_SECOND = 200;
  private JUMP_LEG_LENGTH_MULTIPLIER = 1.5;
  private JUMP_LEG_CHANGE_LENGTH_PER_SECOND = 5000;
  private WALK_FOOT_GROUNDED_DISTANCE = 2;
  private WALK_SWITCH_X_OFFSET = 3;
  private LOWER_BODY_FORWARD_ASSIST_FORCE = 4200;
  private LOWER_BODY_VERTICAL_ASSIST_FORCE = 20000;
  private IDEAL_STEP_LENGTH_X = 72;
  private IDEAL_STEP_TIME_MS = 400;
  private IDEAL_LOWER_BODY_DISTANCE_FROM_GROUND = 120;
  private MIN_STANCE_LEG_LENGTH_MULTIPLIER = 0.3;
  private MAX_STANCE_LEG_LENGTH_MULTIPLIER = 1.4;
  private MIN_SWING_LEG_LENGTH_MULTIPLIER = 0.1;
  private MAX_SWING_LEG_LENGTH_MULTIPLIER = 1.5;
  private BODY_TARGET_FORWARD_RATIO = 0.8;
  private STEP_SEARCH_X_RANGE = 50;
  private STEP_SEARCH_SAMPLE_COUNT = 9;
  private STEP_SEARCH_UP_HEIGHT = 170;
  private STEP_SEARCH_DOWN_DISTANCE = 300;
  private SWING_FOOT_BASE_CLEARANCE = 20;
  private SWING_FOOT_OBSTACLE_CLEARANCE_MARGIN = 10;
  private SWING_FOOT_TARGET_FORCE = 9000;
  private LOWER_BODY_TARGET_FORCE_STIFFNESS = 230;
  private LOWER_BODY_TARGET_FORCE_DAMPING = 32;
  private SWING_FOOT_TARGET_FORCE_STIFFNESS = 260;
  private SWING_FOOT_TARGET_FORCE_DAMPING = 20;
  private STANCE_FOOT_GRIP_STIFFNESS = 220;
  private STANCE_FOOT_GRIP_DAMPING = 72;
  private STANCE_FOOT_MAX_GRIP_FORCE = 9000;
  private STANCE_LEG_LENGTH_CHANGE_PER_SECOND = 400;
  private SWING_LEG_LENGTH_CHANGE_PER_SECOND = 800;
  private SWING_LEG_LIFT_LENGTH_MULTIPLIER = 0.8;
  private MIN_STEP_DURATION_RATIO = 0.2;
  private MAX_STEP_DURATION_RATIO = 2.0;
  private MIN_GROUND_NORMAL_Y = 0.45;
  private MAX_STEP_DOWN_DISTANCE = 200;
  private SWING_REACHED_X_DISTANCE = 15;
  private SWING_REACHED_Y_DISTANCE = 20;
  private activeStepPlan: StepPlan | null = null;

  updateNumber = 0;
  lowerBodyXOscillations = 0;
  lowerBodyYOscillations = 0;

  /**
   * World-driven update hook. For now it only resolves the rig body parts and exits
   * early if the spawned character is incomplete.
   */
  update(deltaTime: number): void {
    
    const { head, upperChest, lowerBody, leftHand, rightHand, leftFoot, rightFoot } = this.getBodyParts();
    
    if (!head || !upperChest || !lowerBody || !leftHand || !rightHand || !leftFoot || !rightFoot) {
      return;
    }

    this.updateNumber++;

    this.lowerBodyXOscillations += Math.abs(lowerBody.x - lowerBody.prevX);
    this.lowerBodyYOscillations += Math.abs(lowerBody.y - lowerBody.prevY);

    const rays = this.raycastBellow();

    const feetOnGround =
      (rays.leftFoot?.distance ?? 99) < this.WALK_FOOT_GROUNDED_DISTANCE || (rays.rightFoot?.distance ?? 99) < this.WALK_FOOT_GROUNDED_DISTANCE;
    if (feetOnGround) {
      this.lastTimeFeetWereOnGround = performance.now();
    }
    const feetRecentlyOnGround = performance.now() - this.lastTimeFeetWereOnGround < this.recentFeetOnGroundTimeout;

    if (!this.input.down && feetRecentlyOnGround) {
      // Stabilize lowerBody with upperChest
      this.applyStabilizeAngleForce(upperChest, lowerBody, { maxForce: 15000, desiredAngleDeg: -90 });
      // Stabilize head with upperChest
      this.applyStabilizeAngleForce(head, upperChest, { maxForce: 5000, desiredAngleDeg: -90, dampingGain: 3 });
      // Stabilize left hand with upperChest
      this.applyStabilizeAngleForce(upperChest, leftHand, { maxForce: 1000, desiredAngleDeg: this.lastWalkDirection > 0 ? 170 : -10, dampingGain: 3 });
      // Stabilize right hand with upperChest
      this.applyStabilizeAngleForce(upperChest, rightHand, { maxForce: 1000, desiredAngleDeg: this.lastWalkDirection > 0 ? 190 : 10, dampingGain: 3 });
      if (!this.input.left && !this.input.right) {
        // Keep left leg under lowerBody
        this.applyStabilizeAngleForce(lowerBody, leftFoot, { maxForce: 10000, desiredAngleDeg: -80 });
        // Keep right leg under lowerBody
        this.applyStabilizeAngleForce(lowerBody, rightFoot, { maxForce: 10000, desiredAngleDeg: -100 });
      }

      this.handleBetterWalking(deltaTime, rays, lowerBody, leftFoot, rightFoot);
    }
  }
  
  stepBegunAt: number | null = null;

  handleBetterWalking(deltaTime: number, rays: RaycastBellowResult, lowerBody: PointState, leftFoot: PointState, rightFoot: PointState): void {
    const moveDirection = Number(this.input.right) - Number(this.input.left);

    if (Math.abs(moveDirection) < EPSILON && !this.input.jump) {
      this.currentStepElapsedMs = 0;
      this.restoreWalkLegLengths(deltaTime);
      this.activeStepPlan = null;
      this.stepBegunAt = null;
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

    let preferredStanceFoot: FootSide | null = null;
    if (!leftGrounded && rightGrounded) {
      preferredStanceFoot = "right";
    } else if (!rightGrounded && leftGrounded) {
      preferredStanceFoot = "left";
    }

    if (!this.activeStepPlan && preferredStanceFoot && preferredStanceFoot !== this.stanceFoot) {
      this.stanceFoot = preferredStanceFoot;
      this.activeStepPlan = null;
      this.currentStepElapsedMs = 0;
      this.stepBegunAt = null;
    }

    this.currentStepElapsedMs += deltaTime * 1000;

    const stanceFootPoint = this.stanceFoot === "left" ? leftFoot : rightFoot;
    const swingFootPoint = this.stanceFoot === "left" ? rightFoot : leftFoot;
    const stanceFootGrounded  = this.stanceFoot === "left" ? leftGrounded : rightGrounded;
    const stanceRay = this.stanceFoot === "left" ? rays.leftFoot : rays.rightFoot;
    const swingRay = this.stanceFoot === "left" ? rays.rightFoot : rays.leftFoot;
    const stanceConstraintId = this.stanceFoot === "left" ? this.rig.leftLegConstraintId : this.rig.rightLegConstraintId;
    const swingConstraintId = this.stanceFoot === "left" ? this.rig.rightLegConstraintId : this.rig.leftLegConstraintId;
    const stanceInitialLength = this.stanceFoot === "left" ? this.initialLeftLegLength : this.initialRightLegLength;
    const swingInitialLength = this.stanceFoot === "left" ? this.initialRightLegLength : this.initialLeftLegLength;

    if (this.input.jump && (leftGrounded || rightGrounded)) {
      this.world.applyPointForce({
        pointId: lowerBody.id,
        force: {
          x: direction * this.LOWER_BODY_FORWARD_ASSIST_FORCE * 0.35,
          y: -this.LOWER_BODY_VERTICAL_ASSIST_FORCE,
        },
      });
      this.slowlyChangeConstraintLength(
        swingConstraintId,
        swingInitialLength * this.JUMP_LEG_LENGTH_MULTIPLIER,
        this.JUMP_LEG_CHANGE_LENGTH_PER_SECOND,
        deltaTime,
      );
      this.slowlyChangeConstraintLength(
        stanceConstraintId,
        stanceInitialLength * this.JUMP_LEG_LENGTH_MULTIPLIER,
        this.JUMP_LEG_CHANGE_LENGTH_PER_SECOND,
        deltaTime,
      );
      this.activeStepPlan = null;
      this.stepBegunAt = null;
      this.currentStepElapsedMs = 0;
      return;
    }

    if (!this.activeStepPlan || this.activeStepPlan.stanceFoot !== this.stanceFoot || this.activeStepPlan.direction !== direction) {
      this.beginStepPlan(direction, this.stanceFoot, lowerBody, stanceFootPoint, swingFootPoint);
    }

    const plan = this.activeStepPlan;
    if (!plan) {
      return;
    }

    const stepProgress = clamp(this.currentStepElapsedMs / Math.max(this.IDEAL_STEP_TIME_MS, 1), 0, 1.5);
    const normalizedStepProgress = clamp(stepProgress, 0, 1);
    const stanceGroundY = this.getGroundYFromRay(stanceFootPoint, stanceRay);
    const desiredLowerBodyTarget = this.computeDesiredLowerBodyTarget(
      lowerBody,
      plan,
      stanceGroundY,
      normalizedStepProgress,
      direction,
      stanceFootGrounded,
    );

    this.applyLowerBodyAssist(lowerBody, desiredLowerBodyTarget, deltaTime, stanceFootGrounded);
    this.applyStanceFootGrip(stanceFootPoint, plan, deltaTime, stanceFootGrounded, stanceGroundY);

    const swingTarget = this.computeSwingTargetAtPhase(plan, normalizedStepProgress);
    this.applyPointTargetForce(
      swingFootPoint,
      swingTarget,
      deltaTime,
      this.SWING_FOOT_TARGET_FORCE_STIFFNESS,
      this.SWING_FOOT_TARGET_FORCE_DAMPING,
      this.SWING_FOOT_TARGET_FORCE,
    );

    const stanceTargetLength = this.computeDesiredStanceLegLength(stanceFootPoint, desiredLowerBodyTarget, stanceInitialLength);
    const swingTargetLength = this.computeDesiredSwingLegLength(
      swingTarget,
      desiredLowerBodyTarget,
      swingInitialLength,
      normalizedStepProgress,
      plan.landingTarget !== null,
    );

    this.slowlyChangeConstraintLength(
      stanceConstraintId,
      stanceTargetLength,
      this.STANCE_LEG_LENGTH_CHANGE_PER_SECOND,
      deltaTime,
    );
    this.slowlyChangeConstraintLength(
      swingConstraintId,
      swingTargetLength,
      this.SWING_LEG_LENGTH_CHANGE_PER_SECOND,
      deltaTime,
    );

    this.drawWalkingDebug(lowerBody, swingFootPoint, stanceFootPoint, desiredLowerBodyTarget, swingTarget, plan);

    const swingGrounded = (swingRay?.distance ?? Number.POSITIVE_INFINITY) <= this.WALK_FOOT_GROUNDED_DISTANCE;
    const swingReachedLanding = this.hasSwingReachedLanding(swingFootPoint, plan.landingTarget);
    const stepTooLong = this.currentStepElapsedMs >= this.IDEAL_STEP_TIME_MS * this.MAX_STEP_DURATION_RATIO;
    const readyToSwap = this.currentStepElapsedMs >= this.IDEAL_STEP_TIME_MS * this.MIN_STEP_DURATION_RATIO && swingGrounded && swingReachedLanding;
    const stanceLostGround = !stanceFootGrounded && swingGrounded;

    if (readyToSwap || stanceLostGround || (stepTooLong && swingGrounded)) {
      this.stanceFoot = plan.swingFoot;
      this.activeStepPlan = null;
      this.currentStepElapsedMs = 0;
      this.stepBegunAt = null;
      return;
    }

    if (!plan.landingTarget && this.currentStepElapsedMs >= this.IDEAL_STEP_TIME_MS * 0.35) {
      this.beginStepPlan(direction, this.stanceFoot, lowerBody, stanceFootPoint, swingFootPoint);
    }
  }

  private beginStepPlan(
    direction: number,
    stanceFoot: FootSide,
    lowerBody: PointState,
    stanceFootPoint: PointState,
    swingFootPoint: PointState,
  ): void {
    const swingFoot = stanceFoot === "left" ? "right" : "left";
    const landingTarget = this.findSwingLandingTarget(direction, stanceFoot, lowerBody, stanceFootPoint, swingFootPoint);
    const desiredLowerBodyXFromFeet = landingTarget
      ? lerp(stanceFootPoint.x, landingTarget.footPosition.x, this.BODY_TARGET_FORWARD_RATIO)
      : lowerBody.x + direction * this.IDEAL_STEP_LENGTH_X * 0.35;
    const desiredLowerBodyX = this.clampForwardValue(lowerBody.x, desiredLowerBodyXFromFeet, direction);
    const arcHeight = this.SWING_FOOT_BASE_CLEARANCE + (landingTarget?.obstacleClearance ?? 0);

    this.activeStepPlan = {
      direction,
      stanceFoot,
      swingFoot,
      stanceAnchor: { x: stanceFootPoint.x, y: stanceFootPoint.y },
      swingStart: { x: swingFootPoint.x, y: swingFootPoint.y },
      lowerBodyStart: { x: lowerBody.x, y: lowerBody.y },
      landingTarget,
      desiredLowerBodyX,
      arcHeight,
    };
    this.currentStepElapsedMs = 0;
    this.stepBegunAt = performance.now();
  }

  private findSwingLandingTarget(
    direction: number,
    stanceFoot: FootSide,
    lowerBody: PointState,
    stanceFootPoint: PointState,
    swingFootPoint: PointState,
  ): StepLandingTarget | null {
    const ignoreConstraintIds = this.getBodyConstraintIds();
    const rayOriginY = Math.min(lowerBody.y, stanceFootPoint.y, swingFootPoint.y) - this.STEP_SEARCH_UP_HEIGHT;
    const rayDistance = this.STEP_SEARCH_UP_HEIGHT + this.STEP_SEARCH_DOWN_DISTANCE;
    const forwardSearchBaseX =
      direction > 0
        ? Math.max(stanceFootPoint.x, lowerBody.x)
        : Math.min(stanceFootPoint.x, lowerBody.x);
    const idealX = forwardSearchBaseX + direction * this.IDEAL_STEP_LENGTH_X;
    const candidateXs = this.buildStepProbeXs(idealX, this.STEP_SEARCH_X_RANGE, this.STEP_SEARCH_SAMPLE_COUNT);
    let bestCandidate: StepLandingTarget | null = null;

    for (const candidateX of candidateXs) {
      if ((direction > 0 && candidateX <= stanceFootPoint.x + swingFootPoint.radius) || (direction < 0 && candidateX >= stanceFootPoint.x - swingFootPoint.radius)) {
        continue;
      }
      if ((direction > 0 && candidateX <= lowerBody.x + lowerBody.radius) || (direction < 0 && candidateX >= lowerBody.x - lowerBody.radius)) {
        continue;
      }

      const probe = this.probeGroundAtX(candidateX, rayOriginY, rayDistance, swingFootPoint.radius, swingFootPoint.layers, ignoreConstraintIds);
      if (!probe) {
        continue;
      }

      const stepDownDistance = Math.max(0, probe.footY - swingFootPoint.y);
      if (stepDownDistance > this.MAX_STEP_DOWN_DISTANCE) {
        continue;
      }

      const predictedBodyGroundY = Math.min(probe.surfaceY, stanceFootPoint.y + stanceFootPoint.radius);
      const predictedBodyY = predictedBodyGroundY - this.IDEAL_LOWER_BODY_DISTANCE_FROM_GROUND;
      const predictedBodyX = this.clampForwardValue(
        lowerBody.x,
        lerp(stanceFootPoint.x, candidateX, this.BODY_TARGET_FORWARD_RATIO),
        direction,
      );
      const predictedSwingReach = distanceBetweenPoints(predictedBodyX, predictedBodyY, candidateX, probe.footY);
      const predictedStanceReach = distanceBetweenPoints(predictedBodyX, predictedBodyY, stanceFootPoint.x, stanceFootPoint.y);

      if (predictedSwingReach > this.getInitialLegLengthForFoot(this.getOppositeFoot(stanceFoot)) * this.MAX_SWING_LEG_LENGTH_MULTIPLIER) {
        continue;
      }
      if (predictedStanceReach > this.getInitialLegLengthForFoot(stanceFoot) * this.MAX_STANCE_LEG_LENGTH_MULTIPLIER * 2) {
        continue;
      }

      const obstacleClearance = this.measureObstacleClearance(
        swingFootPoint,
        candidateX,
        rayOriginY,
        rayDistance,
        ignoreConstraintIds,
      );
      const score =
        Math.abs(candidateX - idealX) +
        Math.abs(probe.footY - swingFootPoint.y) * 0.25 +
        predictedSwingReach * 0.08 +
        obstacleClearance * 0.15;

      if (!bestCandidate || score < bestCandidate.score) {
        bestCandidate = {
          footPosition: { x: candidateX, y: probe.footY },
          surfacePoint: { x: probe.hit.point.x, y: probe.hit.point.y },
          surfaceNormal: { x: probe.hit.normal.x, y: probe.hit.normal.y },
          score,
          obstacleClearance,
        };
      }
    }

    return bestCandidate;
  }

  private probeGroundAtX(
    x: number,
    originY: number,
    maxDistance: number,
    footRadius: number,
    layers: readonly number[],
    ignoreConstraintIds: ConstraintId[],
  ): GroundProbe | null {
    const hit = this.world.raycast({
      origin: { x, y: originY },
      direction: { x: 0, y: 1 },
      maxDistance,
      layers: Array.from(layers),
      ignoreConstraintIds,
    });
    this.world.debugLine(x, originY, x, originY + maxDistance, { color: "green", lifespan: 1 });

    if (!hit || -hit.normal.y < this.MIN_GROUND_NORMAL_Y) {
      return null;
    }

    return {
      hit,
      footX: x,
      footY: hit.point.y - footRadius,
      surfaceY: hit.point.y,
    };
  }

  private measureObstacleClearance(
    swingFootPoint: PointState,
    landingX: number,
    rayOriginY: number,
    rayDistance: number,
    ignoreConstraintIds: ConstraintId[],
  ): number {
    const sampleCount = Math.max(2, Math.ceil(Math.abs(landingX - swingFootPoint.x) / 18));
    let highestFootY = swingFootPoint.y;

    for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex += 1) {
      const progress = sampleIndex / sampleCount;
      const sampleX = lerp(swingFootPoint.x, landingX, progress);
      const probe = this.probeGroundAtX(
        sampleX,
        rayOriginY,
        rayDistance,
        swingFootPoint.radius,
        swingFootPoint.layers,
        ignoreConstraintIds,
      );

      if (!probe) {
        continue;
      }

      highestFootY = Math.min(highestFootY, probe.footY);
    }

    const obstacleRise = Math.max(0, swingFootPoint.y - highestFootY);
    return obstacleRise > EPSILON ? obstacleRise + this.SWING_FOOT_OBSTACLE_CLEARANCE_MARGIN : 0;
  }

  private computeDesiredLowerBodyTarget(
    lowerBody: PointState,
    plan: StepPlan,
    stanceGroundY: number | null,
    stepProgress: number,
    direction: number,
    stanceFootGrounded: boolean,
  ): Vec2Like {
    const forwardBlend = smoothstep01(stepProgress);
    const landingGroundY = plan.landingTarget?.surfacePoint.y ?? stanceGroundY;
    const supportGroundY = stanceGroundY == null
      ? lowerBody.y + this.IDEAL_LOWER_BODY_DISTANCE_FROM_GROUND
      : landingGroundY == null
        ? stanceGroundY
        : lerp(stanceGroundY, Math.min(stanceGroundY, landingGroundY), forwardBlend * 0.45);
    const targetY = supportGroundY - this.IDEAL_LOWER_BODY_DISTANCE_FROM_GROUND;
    const rawTargetX = lerp(plan.lowerBodyStart.x, plan.desiredLowerBodyX, forwardBlend);
    const targetX = this.clampForwardValue(plan.lowerBodyStart.x, rawTargetX, direction);

    if (!stanceFootGrounded) {
      return {
        x: lerp(lowerBody.x, targetX, 0.25),
        y: lerp(lowerBody.y, targetY, 0.2),
      };
    }

    return { x: targetX, y: targetY };
  }

  private drawWalkingDebug(
    lowerBody: PointState,
    swingFootPoint: PointState,
    stanceFootPoint: PointState,
    desiredLowerBodyTarget: Vec2Like,
    swingTarget: Vec2Like,
    plan: StepPlan,
  ): void {
    this.world.debugPoint(desiredLowerBodyTarget.x, desiredLowerBodyTarget.y, {
      color: "#0000ff",
      radius: 8,
      lifespan: 2,
    });
    this.world.debugLine(lowerBody.x, lowerBody.y, desiredLowerBodyTarget.x, desiredLowerBodyTarget.y, {
      color: "#0000ff",
      radius: 2.5,
      lifespan: 2,
    });

    this.world.debugPoint(swingTarget.x, swingTarget.y, {
      color: "#ff0000",
      radius: 7,
      lifespan: 2,
    });
    this.world.debugLine(swingFootPoint.x, swingFootPoint.y, swingTarget.x, swingTarget.y, {
      color: "#ff0000",
      radius: 2,
      lifespan: 2,
    });

    this.world.debugPoint(stanceFootPoint.x, stanceFootPoint.y, {
      color: "#ff00ff",
      radius: 7,
      lifespan: 2,
    });
    this.world.debugPoint(plan.stanceAnchor.x, plan.stanceAnchor.y, {
      color: "#ff88ff",
      radius: 4,
      lifespan: 2,
    });
    this.world.debugLine(stanceFootPoint.x, stanceFootPoint.y, plan.stanceAnchor.x, plan.stanceAnchor.y, {
      color: "#ff88ff",
      radius: 1.5,
      lifespan: 2,
    });

    if (!plan.landingTarget) {
      return;
    }

    this.world.debugPoint(plan.landingTarget.footPosition.x, plan.landingTarget.footPosition.y, {
      color: "#00ff00",
      radius: 8,
      lifespan: 2,
    });
    this.world.debugLine(plan.swingStart.x, plan.swingStart.y, plan.landingTarget.footPosition.x, plan.landingTarget.footPosition.y, {
      color: "#00ff00",
      radius: 2,
      lifespan: 2,
    });
    this.world.debugLine(
      plan.landingTarget.surfacePoint.x,
      plan.landingTarget.surfacePoint.y,
      plan.landingTarget.surfacePoint.x + plan.landingTarget.surfaceNormal.x * 18,
      plan.landingTarget.surfacePoint.y + plan.landingTarget.surfaceNormal.y * 18,
      {
        color: "#11aa66",
        radius: 2.5,
        lifespan: 2,
      },
    );
  }

  private clampForwardValue(start: number, candidate: number, direction: number): number {
    if (direction > 0) {
      return Math.max(start, candidate);
    }
    if (direction < 0) {
      return Math.min(start, candidate);
    }
    return candidate;
  }

  private buildStepProbeXs(idealX: number, xRange: number, sampleCount: number): number[] {
    const normalizedSampleCount = Math.max(1, Math.floor(sampleCount));
    const values = [idealX];

    if (normalizedSampleCount === 1 || xRange <= EPSILON) {
      return values;
    }

    const pairCount = Math.floor((normalizedSampleCount - 1) / 2);
    const stepSize = xRange / Math.max(pairCount, 1);

    for (let index = 1; index <= pairCount; index += 1) {
      const offset = stepSize * index;
      values.push(idealX + offset, idealX - offset);
    }

    if (values.length < normalizedSampleCount) {
      values.push(idealX + xRange);
    }

    return values.slice(0, normalizedSampleCount);
  }

  private applyStanceFootGrip(
    stanceFootPoint: PointState,
    plan: StepPlan,
    deltaTime: number,
    stanceFootGrounded: boolean,
    stanceGroundY: number | null,
  ): void {
    if (!stanceFootGrounded) {
      return;
    }

    const targetY = stanceGroundY == null ? plan.stanceAnchor.y : Math.min(plan.stanceAnchor.y, stanceGroundY - stanceFootPoint.radius);
    this.applyPointTargetForce(
      stanceFootPoint,
      {
        x: plan.stanceAnchor.x,
        y: targetY,
      },
      deltaTime,
      this.STANCE_FOOT_GRIP_STIFFNESS,
      this.STANCE_FOOT_GRIP_DAMPING,
      this.STANCE_FOOT_MAX_GRIP_FORCE,
    );
  }

  private applyLowerBodyAssist(lowerBody: PointState, target: Vec2Like, deltaTime: number, stanceFootGrounded: boolean): void {
    const deltaSeconds = Math.max(deltaTime, EPSILON);
    const velocityX = (lowerBody.x - lowerBody.prevX) / deltaSeconds;
    const velocityY = (lowerBody.y - lowerBody.prevY) / deltaSeconds;
    const forceX = clamp(
      (target.x - lowerBody.x) * this.LOWER_BODY_TARGET_FORCE_STIFFNESS - velocityX * this.LOWER_BODY_TARGET_FORCE_DAMPING,
      -this.LOWER_BODY_FORWARD_ASSIST_FORCE,
      this.LOWER_BODY_FORWARD_ASSIST_FORCE,
    );
    const forceY = clamp(
      (target.y - lowerBody.y) * this.LOWER_BODY_TARGET_FORCE_STIFFNESS - velocityY * this.LOWER_BODY_TARGET_FORCE_DAMPING,
      -this.LOWER_BODY_VERTICAL_ASSIST_FORCE,
      this.LOWER_BODY_VERTICAL_ASSIST_FORCE,
    );

    this.world.applyPointForce({
      pointId: lowerBody.id,
      force: {
        x: stanceFootGrounded ? forceX : forceX * 0.35,
        y: stanceFootGrounded ? forceY : forceY * 0.4,
      },
    });
  }

  private applyPointTargetForce(
    point: PointState,
    target: Vec2Like,
    deltaTime: number,
    stiffness: number,
    damping: number,
    maxForce: number,
  ): void {
    const deltaSeconds = Math.max(deltaTime, EPSILON);
    const velocityX = (point.x - point.prevX) / deltaSeconds;
    const velocityY = (point.y - point.prevY) / deltaSeconds;
    const force = clampVector(
      (target.x - point.x) * stiffness - velocityX * damping,
      (target.y - point.y) * stiffness - velocityY * damping,
      maxForce,
    );

    this.world.applyPointForce({
      pointId: point.id,
      force,
    });
  }

  private computeSwingTargetAtPhase(plan: StepPlan, stepProgress: number): Vec2Like {
    if (!plan.landingTarget) {
      return {
        x: plan.swingStart.x + plan.direction * this.IDEAL_STEP_LENGTH_X * 0.35 * stepProgress,
        y: plan.swingStart.y - Math.sin(stepProgress * Math.PI) * this.SWING_FOOT_BASE_CLEARANCE,
      };
    }

    const horizontalBlend = smoothstep01(stepProgress);
    const x = lerp(plan.swingStart.x, plan.landingTarget.footPosition.x, horizontalBlend);
    const lineY = lerp(plan.swingStart.y, plan.landingTarget.footPosition.y, stepProgress);
    const y = lineY - Math.sin(stepProgress * Math.PI) * plan.arcHeight;

    return { x, y };
  }

  private computeDesiredStanceLegLength(stanceFootPoint: PointState, desiredLowerBodyTarget: Vec2Like, stanceInitialLength: number): number {
    const desiredLength = distanceBetweenPoints(
      stanceFootPoint.x,
      stanceFootPoint.y,
      desiredLowerBodyTarget.x,
      desiredLowerBodyTarget.y,
    );

    return clamp(
      desiredLength,
      stanceInitialLength * this.MIN_STANCE_LEG_LENGTH_MULTIPLIER,
      stanceInitialLength * this.MAX_STANCE_LEG_LENGTH_MULTIPLIER,
    );
  }

  private computeDesiredSwingLegLength(
    swingTarget: Vec2Like,
    desiredLowerBodyTarget: Vec2Like,
    swingInitialLength: number,
    stepProgress: number,
    hasLandingTarget: boolean,
  ): number {
    const geometricLength = distanceBetweenPoints(
      swingTarget.x,
      swingTarget.y,
      desiredLowerBodyTarget.x,
      desiredLowerBodyTarget.y,
    );
    const shortenedLength = swingInitialLength * this.SWING_LEG_LIFT_LENGTH_MULTIPLIER;
    const extensionBlend = smoothstep01(clamp((stepProgress - 0.18) / 0.72, 0, 1));
    const blendedLength = lerp(shortenedLength, geometricLength, extensionBlend);
    const maxLength = swingInitialLength * (hasLandingTarget ? this.MAX_SWING_LEG_LENGTH_MULTIPLIER : 1.05);

    return clamp(blendedLength, swingInitialLength * this.MIN_SWING_LEG_LENGTH_MULTIPLIER, maxLength);
  }

  private hasSwingReachedLanding(swingFootPoint: PointState, landingTarget: StepLandingTarget | null): boolean {
    if (!landingTarget) {
      return false;
    }

    return (
      Math.abs(swingFootPoint.x - landingTarget.footPosition.x) <= this.SWING_REACHED_X_DISTANCE &&
      Math.abs(swingFootPoint.y - landingTarget.footPosition.y) <= this.SWING_REACHED_Y_DISTANCE
    );
  }

  private getGroundYFromRay(point: PointState, hit: RaycastHit | null): number | null {
    if (!hit) {
      return null;
    }

    return point.y + point.radius + hit.distance;
  }

  private getOppositeFoot(foot: FootSide): FootSide {
    return foot === "left" ? "right" : "left";
  }

  private getInitialLegLengthForFoot(foot: FootSide): number {
    return foot === "left" ? this.initialLeftLegLength : this.initialRightLegLength;
  }

  handleWalking(deltaTime: number, rays: RaycastBellowResult, lowerBody: PointState, leftFoot: PointState, rightFoot: PointState): void {
    const moveDirection = Number(this.input.right) - Number(this.input.left);

    if (Math.abs(moveDirection) < EPSILON && !this.input.jump) {
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
    const currentSwingAngleDeg = Math.atan2(lowerBody.y - swingFootPoint.y, lowerBody.x - swingFootPoint.x) / DEG2RAD;

    this.applyStabilizeAngleForce(lowerBody, stanceFootPoint, {
      maxForce: this.WALK_STANCE_MAX_FORCE,
      desiredAngleDeg: stanceAngle,
      proportionalGain: 1.05,
      dampingGain: 3,
    });
    this.applyStabilizeAngleForce(lowerBody, swingFootPoint, {
      maxForce: this.WALK_SWING_MAX_FORCE,
      desiredAngleDeg: swingAngle,
      proportionalGain: 0.9,
      dampingGain: 1.15,
    });

    const swingAheadOfBody =
      direction > 0
        ? swingFootPoint.x >= lowerBody.x + this.WALK_SWITCH_X_OFFSET
        : swingFootPoint.x <= lowerBody.x - this.WALK_SWITCH_X_OFFSET;

    const swingCloseToForwardAngle =
      Math.abs(normalizeAngle((swingAngle - currentSwingAngleDeg) * DEG2RAD)) <= this.WALK_SWING_REEXTEND_ANGLE_THRESHOLD_DEG * DEG2RAD;

    const swingTargetLength = swingAheadOfBody && swingCloseToForwardAngle ? swingInitialLength : swingInitialLength * this.WALK_SWING_LEG_LENGTH_MULTIPLIER;

    if (this.input.jump) {
      this.slowlyChangeConstraintLength(swingConstraintId, this.initialRightLegLength * this.JUMP_LEG_LENGTH_MULTIPLIER, this.JUMP_LEG_CHANGE_LENGTH_PER_SECOND, deltaTime);
      this.slowlyChangeConstraintLength(stanceConstraintId, this.initialLeftLegLength * this.JUMP_LEG_LENGTH_MULTIPLIER, this.JUMP_LEG_CHANGE_LENGTH_PER_SECOND, deltaTime);
    } else {
      this.slowlyChangeConstraintLength(swingConstraintId, swingTargetLength, this.WALK_LEG_CHANGE_LENGTH_PER_SECOND, deltaTime);
      this.slowlyChangeConstraintLength(stanceConstraintId, stanceInitialLength, this.WALK_LEG_CHANGE_LENGTH_PER_SECOND, deltaTime);
    }

    const swingGrounded = (swingRay?.distance ?? Number.POSITIVE_INFINITY) <= this.WALK_FOOT_GROUNDED_DISTANCE;
    const timedOut = this.currentStepElapsedMs >= this.WALK_STEP_MAX_TIME_MS;
    const readyToSwitch = this.currentStepElapsedMs >= this.WALK_STEP_MIN_TIME_MS && swingGrounded && swingAheadOfBody;
    const stanceLostGround = (stanceRay?.distance ?? Number.POSITIVE_INFINITY) > this.WALK_FOOT_GROUNDED_DISTANCE && swingGrounded;

    if (readyToSwitch || timedOut || stanceLostGround) {
      this.stanceFoot = this.stanceFoot === "left" ? "right" : "left";
      this.currentStepElapsedMs = 0;
    }
  }

  /**
   * Moves a constraint rest length toward an absolute target length at a fixed speed.
   */
  private slowlyChangeConstraintLength(constraintId: ConstraintId, finalLength: number, lengthPerSecond = 50, deltaTime: number): void {
    const constraint = this.world.getConstraintSnapshot(constraintId)!;
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
    point: PointState,
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
  applyStabilizeAngleForce(
    upperPoint: PointState,
    lowerPoint: PointState,
    options: { maxForce: number; desiredAngleDeg?: number; proportionalGain?: number; dampingGain?: number; exponentialGain?: number },
  ): void {
    const { maxForce, desiredAngleDeg = -90, proportionalGain = 1, dampingGain = 1.5, exponentialGain = 0.65 } = options;

    const deltaX = upperPoint.x - lowerPoint.x;
    const deltaY = upperPoint.y - lowerPoint.y;
    const length = Math.hypot(deltaX, deltaY);

    if (length <= EPSILON || maxForce <= EPSILON) {
      return;
    }

    const directionX = deltaX / length;
    const directionY = deltaY / length;
    const currentAngle = Math.atan2(directionY, directionX);
    const previousAngle = Math.atan2(
      upperPoint.prevY - lowerPoint.prevY,
      upperPoint.prevX - lowerPoint.prevX,
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
  point: PointState,
  target: Vec2Like,
  deltaTime: number,
  springStrength: number,
  dampingStrength: number,
  maxForce: number,
): Vec2Like {
  const velocityX = (point.x - point.prevX) / Math.max(deltaTime, EPSILON);
  const velocityY = (point.y - point.prevY) / Math.max(deltaTime, EPSILON);
  const forceX = (target.x - point.x) * springStrength - velocityX * dampingStrength;
  const forceY = (target.y - point.y) * springStrength - velocityY * dampingStrength;
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
  point: PointState | null,
  maxDistance: number,
  ignoreConstraintIds?: ConstraintId[],
): RaycastHit | null {
  if (!world || !point || maxDistance <= 0) {
    return null;
  }

  return world.raycast({
    origin: {
      x: point.x,
      y: point.y + point.radius,
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

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function smoothstep01(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function distanceBetweenPoints(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/**
 * Multiply degrees with this to get radians.
 */
const DEG2RAD = Math.PI / 180;
