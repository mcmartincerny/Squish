import type { LayerId, PhysicsWorld, Vec2Like } from "../../index.ts";
import { CharacterController, type CharacterRig } from "./CharacterController.ts";

export interface SpawnCharacterOptions {
  position: Vec2Like;
  layers?: LayerId[];
  scale?: number;
  stiffness?: number;
  damping?: number;
  tearThreshold?: number | null;
}

export function spawnCharacter(world: PhysicsWorld, options: SpawnCharacterOptions): CharacterController {
  const layers = options.layers;
  const scale = Math.max(0.5, options.scale ?? 1);
  const stiffness = options.stiffness ?? 0.28;
  const damping = options.damping ?? 12;
  const tearThreshold = options.tearThreshold ?? null;
  const torsoLength = 34 * scale;
  const neckLength = 15 * scale;
  const armLength = 32 * scale;
  const legLength = 58 * scale;
  const footSpacing = 12 * scale;
  const armSpacing = 10 * scale;

  const lowerBody = world.createPoint({
    position: options.position,
    radius: 6 * scale,
    mass: 1.8 * scale,
    layers,
  });
  const upperChest = world.createPoint({
    position: { x: options.position.x, y: options.position.y - torsoLength },
    radius: 5 * scale,
    mass: 1.55 * scale,
    layers,
  });
  const head = world.createPoint({
    position: { x: options.position.x, y: options.position.y - torsoLength - neckLength },
    radius: 7 * scale,
    mass: 0.8 * scale,
    layers,
  });
  const leftHand = world.createPoint({
    position: { x: options.position.x - armLength, y: options.position.y - torsoLength + armSpacing * 0.35 },
    radius: 3 * scale,
    mass: 0.3 * scale,
    layers,
  });
  const rightHand = world.createPoint({
    position: { x: options.position.x + armLength, y: options.position.y - torsoLength + armSpacing * 0.35 },
    radius: 3 * scale,
    mass: 0.3 * scale,
    layers,
  });
  const leftFoot = world.createPoint({
    position: { x: options.position.x - footSpacing, y: options.position.y + legLength },
    radius: 3 * scale,
    mass: 0.6 * scale,
    layers,
  });
  const rightFoot = world.createPoint({
    position: { x: options.position.x + footSpacing, y: options.position.y + legLength },
    radius: 3 * scale,
    mass: 0.6 * scale,
    layers,
  });

  const rig: CharacterRig = {
    headId: head,
    upperChestId: upperChest,
    lowerBodyId: lowerBody,
    leftHandId: leftHand,
    rightHandId: rightHand,
    leftFootId: leftFoot,
    rightFootId: rightFoot,
    neckConstraintId: world.createConstraint({
      pointAId: head,
      pointBId: upperChest,
      stiffness,
      damping,
      tearThreshold,
      collisionRadius: 5 * scale,
    }),
    spineConstraintId: world.createConstraint({
      pointAId: upperChest,
      pointBId: lowerBody,
      stiffness,
      damping,
      tearThreshold,
      collisionRadius: 5 * scale,
    }),
    leftArmConstraintId: world.createConstraint({
      pointAId: upperChest,
      pointBId: leftHand,
      stiffness,
      damping,
      tearThreshold,
      collisionRadius: 2 * scale,
    }),
    rightArmConstraintId: world.createConstraint({
      pointAId: upperChest,
      pointBId: rightHand,
      stiffness,
      damping,
      tearThreshold,
      collisionRadius: 2 * scale,
    }),
    leftLegConstraintId: world.createConstraint({
      pointAId: lowerBody,
      pointBId: leftFoot,
      stiffness,
      damping,
      tearThreshold,
      collisionRadius: 3 * scale,
    }),
    rightLegConstraintId: world.createConstraint({
      pointAId: lowerBody,
      pointBId: rightFoot,
      stiffness,
      damping,
      tearThreshold,
      collisionRadius: 3 * scale,
    }),
  };

  // Ignore all constraints on all points to prevent them from affecting each other - can be tweaked later if needed
  const allConstraints = [rig.neckConstraintId, rig.spineConstraintId, rig.leftArmConstraintId, rig.rightArmConstraintId, rig.leftLegConstraintId, rig.rightLegConstraintId];
  const allPoints = [leftHand, rightHand, leftFoot, rightFoot, upperChest, lowerBody, head];
  for (const point of allPoints) {
    world.setPointIgnoredConstraints({
      pointId: point,
      ignoredConstraintIds: allConstraints,
    });
  }


  return new CharacterController(world, rig);
}
