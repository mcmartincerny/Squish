import type { LayerId, PhysicsWorld, Vec2Like } from "../../index.ts";
import { CharacterController, type CharacterConstantsOverride, type CharacterRig } from "./CharacterController.ts";

export interface SpawnCharacterOptions {
  position: Vec2Like;
  layers?: LayerId[];
  stiffness?: number;
  damping?: number;
  tearThreshold?: number | null;
  characterConstants?: CharacterConstantsOverride;
}

export function spawnCharacter(world: PhysicsWorld, options: SpawnCharacterOptions): CharacterController {
  const layers = options.layers;
  const stiffness = (options.stiffness ?? 0.28) / 1; // TODO lower stiffness for better walking
  const damping = options.damping ?? 12;
  const tearThreshold = options.tearThreshold ?? null;
  const torsoLength = 68;
  const neckLength = 30;
  const armLength = 64;
  const legYLength = 116;
  const footSpacing = 24;
  const armSpacing = 20;

  const lowerBody = world.createPoint({
    position: options.position,
    radius: 12,
    mass: 3.6,
    layers,
  });
  const upperChest = world.createPoint({
    position: { x: options.position.x, y: options.position.y - torsoLength },
    radius: 10,
    mass: 3.1,
    layers,
  });
  const head = world.createPoint({
    position: { x: options.position.x, y: options.position.y - torsoLength - neckLength },
    radius: 14,
    mass: 1.6,
    layers,
  });
  const leftHand = world.createPoint({
    position: { x: options.position.x - armLength, y: options.position.y - torsoLength + armSpacing * 0.35 },
    radius: 6,
    mass: 0.6,
    layers,
  });
  const rightHand = world.createPoint({
    position: { x: options.position.x + armLength, y: options.position.y - torsoLength + armSpacing * 0.35 },
    radius: 6,
    mass: 0.6,
    layers,
  });
  const leftFoot = world.createPoint({
    position: { x: options.position.x - footSpacing, y: options.position.y + legYLength },
    radius: 6,
    mass: 1.2,
    layers,
  });
  const rightFoot = world.createPoint({
    position: { x: options.position.x + footSpacing, y: options.position.y + legYLength },
    radius: 6,
    mass: 1.2,
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
      collisionRadius: 10,
    }),
    spineConstraintId: world.createConstraint({
      pointAId: upperChest,
      pointBId: lowerBody,
      stiffness,
      damping,
      tearThreshold,
      collisionRadius: 10,
    }),
    leftArmConstraintId: world.createConstraint({
      pointAId: upperChest,
      pointBId: leftHand,
      stiffness,
      damping,
      tearThreshold,
      collisionRadius: 4,
    }),
    rightArmConstraintId: world.createConstraint({
      pointAId: upperChest,
      pointBId: rightHand,
      stiffness,
      damping,
      tearThreshold,
      collisionRadius: 4,
    }),
    leftLegConstraintId: world.createConstraint({
      pointAId: lowerBody,
      pointBId: leftFoot,
      stiffness: stiffness * 0.5,
      damping,
      tearThreshold,
      collisionRadius: 6,
    }),
    rightLegConstraintId: world.createConstraint({
      pointAId: lowerBody,
      pointBId: rightFoot,
      stiffness: stiffness * 0.5,
      damping,
      tearThreshold,
      collisionRadius: 6.01,
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


  return new CharacterController(world, rig, options.characterConstants);
}
