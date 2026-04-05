import type { LayerId, PhysicsWorld, PointId } from "../engine/index.ts";
import type { PlaygroundSettings } from "./types.ts";

interface SpawnOptions {
  world: PhysicsWorld;
  settings: PlaygroundSettings;
  centerX: number;
  centerY: number;
}

export function syncWorldConfig(world: PhysicsWorld, settings: PlaygroundSettings): void {
  world.setConfig({
    gravity: { x: 0, y: settings.gravity },
    size: { x: settings.worldWidth, y: settings.worldHeight },
    iterations: Math.round(settings.iterations),
    globalDamping: settings.globalDamping,
    friction: settings.friction,
    restitution: settings.restitution,
    defaultPointRadius: settings.pointRadius,
    defaultColliderRadius: settings.colliderRadius,
    gridCellSize: Math.max(settings.colliderRadius * 4, 48),
  });
}

export function loadEmptyScene(world: PhysicsWorld, settings: PlaygroundSettings): void {
  world.clear();
  syncWorldConfig(world, settings);
}

interface ShapeSpawnOverrides {
  layers?: LayerId[];
}

export function spawnSquare(options: SpawnOptions, spawnOverrides?: ShapeSpawnOverrides): void {
  const { world, settings, centerX, centerY } = options;
  const halfSize = 70;
  const points = [
    createPoint(world, settings, centerX - halfSize, centerY - halfSize, spawnOverrides),
    createPoint(world, settings, centerX + halfSize, centerY - halfSize, spawnOverrides),
    createPoint(world, settings, centerX + halfSize, centerY + halfSize, spawnOverrides),
    createPoint(world, settings, centerX - halfSize, centerY + halfSize, spawnOverrides),
  ];

  connectLoop(world, points, settings);
  connect(world, points[0], points[2], settings);
  connect(world, points[1], points[3], settings);
}

export function spawnTriangle(options: SpawnOptions, spawnOverrides?: ShapeSpawnOverrides): void {
  const { world, settings, centerX, centerY } = options;
  const radius = 85;
  const points = [0, 1, 2].map((index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / 3;
    return createPoint(world, settings, centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius, spawnOverrides);
  });

  connectLoop(world, points, settings);
}

export function spawnCircle(options: SpawnOptions, spawnOverrides?: ShapeSpawnOverrides): void {
  const { world, settings, centerX, centerY } = options;
  const segments = 12;
  const radius = 95;
  const centerPoint = createPoint(world, settings, centerX, centerY, spawnOverrides);
  const ringPoints = Array.from({ length: segments }, (_, index) => {
    const angle = (Math.PI * 2 * index) / segments;
    return createPoint(world, settings, centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius, spawnOverrides);
  });

  connectLoop(world, ringPoints, settings);

  for (const pointId of ringPoints) {
    connect(world, centerPoint, pointId, settings);
  }
}

interface ShapeOptions {
  columns?: number;
  rows?: number;
  spacing?: number;
}

/** Axis-aligned square outline filled with a regular grid triangulated by alternating diagonals (two triangles per quad). */
export function spawnSquareTriMesh(options: SpawnOptions, shapeOptions?: ShapeOptions, spawnOverrides?: ShapeSpawnOverrides): void {
  const { world, settings, centerX, centerY } = options;
  const columns = shapeOptions?.columns ?? 5;
  const rows = shapeOptions?.rows ?? 5;
  const spacing = shapeOptions?.spacing ?? 68;
  const width = (columns - 1) * spacing;
  const height = (rows - 1) * spacing;
  const pointIds: PointId[][] = [];

  for (let row = 0; row < rows; row += 1) {
    const rowPoints: PointId[] = [];
    for (let column = 0; column < columns; column += 1) {
      rowPoints.push(createPoint(world, settings, centerX - width / 2 + column * spacing, centerY - height / 2 + row * spacing, spawnOverrides));
    }
    pointIds.push(rowPoints);
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const pointId = pointIds[row][column];

      if (column + 1 < columns) {
        connect(world, pointId, pointIds[row][column + 1], settings);
      }

      if (row + 1 < rows) {
        connect(world, pointId, pointIds[row + 1][column], settings);
      }

      if (row + 1 < rows && column + 1 < columns) {
        if ((row + column) % 2 === 0) {
          connect(world, pointId, pointIds[row + 1][column + 1], settings);
        } else {
          connect(world, pointIds[row][column + 1], pointIds[row + 1][column], settings);
        }
      }
    }
  }
}

export function spawnDenseGrid(
  options: SpawnOptions,
  shapeOptions?: ShapeOptions,
  spawnOverrides?: ShapeSpawnOverrides,
): void {
  const { world, settings, centerX, centerY } = options;
  const columns = shapeOptions?.columns ?? 6;
  const rows = shapeOptions?.rows ?? 6;
  const spacing = shapeOptions?.spacing ?? 68;
  const width = (columns - 1) * spacing;
  const height = (rows - 1) * spacing;
  const pointIds: PointId[][] = [];

  for (let row = 0; row < rows; row += 1) {
    const rowPoints: PointId[] = [];

    for (let column = 0; column < columns; column += 1) {
      rowPoints.push(createPoint(world, settings, centerX - width / 2 + column * spacing, centerY - height / 2 + row * spacing, spawnOverrides));
    }

    pointIds.push(rowPoints);
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const pointId = pointIds[row][column];

      if (column + 1 < columns) {
        connect(world, pointId, pointIds[row][column + 1], settings);
      }

      if (row + 1 < rows) {
        connect(world, pointId, pointIds[row + 1][column], settings);
      }

      if (row + 1 < rows && column + 1 < columns) {
        connect(world, pointId, pointIds[row + 1][column + 1], settings, {
          stiffness: settings.constraintStiffness * 0.8,
        });
      }

      if (row + 1 < rows && column - 1 >= 0) {
        connect(world, pointId, pointIds[row + 1][column - 1], settings, {
          stiffness: settings.constraintStiffness * 0.8,
        });
      }
    }
  }
}

export function spawnPyramid(options: SpawnOptions, spawnOverrides?: ShapeSpawnOverrides): void {
  const { world, settings, centerX, centerY } = options;
  const rows = 6;
  const s = 68;
  const rowHeight = (s * Math.sqrt(3)) / 2;
  const pointIds: PointId[][] = [];

  for (let row = 0; row < rows; row += 1) {
    const rowPoints: PointId[] = [];
    for (let col = 0; col <= row; col += 1) {
      const x = centerX + (col - row / 2) * s;
      const y = centerY - ((rows - 1) * rowHeight) / 2 + row * rowHeight;
      rowPoints.push(createPoint(world, settings, x, y, spawnOverrides));
    }
    pointIds.push(rowPoints);
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col <= row; col += 1) {
      const id = pointIds[row][col];

      if (col + 1 <= row) {
        connect(world, id, pointIds[row][col + 1], settings);
      }

      if (row + 1 < rows) {
        connect(world, id, pointIds[row + 1][col], settings);
        connect(world, id, pointIds[row + 1][col + 1], settings);
      }
    }
  }
}

export function loadDefaultScene(world: PhysicsWorld, settings: PlaygroundSettings): void {
  world.clear();
  syncWorldConfig(world, settings);
  spawnSquare({
    world,
    settings,
    centerX: settings.worldWidth * 0.35,
    centerY: settings.worldHeight * 0.25,
  });
  spawnCircle({
    world,
    settings,
    centerX: settings.worldWidth * 0.68,
    centerY: settings.worldHeight * 0.2,
  });
  spawnDenseGrid({
    world,
    settings,
    centerX: settings.worldWidth * 0.5,
    centerY: settings.worldHeight * 0.55,
  });
}

export function loadWallsValidationScene(world: PhysicsWorld, settings: PlaygroundSettings): void {
  world.clear();
  syncWorldConfig(world, settings);

  spawnSquare({
    world,
    settings,
    centerX: settings.worldWidth * 0.25,
    centerY: 150,
  });
  spawnTriangle({
    world,
    settings,
    centerX: settings.worldWidth * 0.5,
    centerY: 120,
  });
  spawnCircle({
    world,
    settings,
    centerX: settings.worldWidth * 0.75,
    centerY: 160,
  });
}

export function loadCapsuleEndpointValidationScene(world: PhysicsWorld, settings: PlaygroundSettings): void {
  world.clear();
  syncWorldConfig(world, settings);

  const anchorA = createPoint(world, settings, settings.worldWidth * 0.5, settings.worldHeight * 0.36, true);
  const anchorB = createPoint(world, settings, settings.worldWidth * 0.64, settings.worldHeight * 0.58, true);

  connect(world, anchorA, anchorB, settings, {
    stiffness: 1,
    damping: settings.constraintDamping,
  });

  createPoint(world, settings, settings.worldWidth * 0.42, settings.worldHeight * 0.18);
  createPoint(world, settings, settings.worldWidth * 0.57, settings.worldHeight * 0.08);
  createPoint(world, settings, settings.worldWidth * 0.7, settings.worldHeight * 0.22);
}

export function loadBridgeValidationScene(world: PhysicsWorld, settings: PlaygroundSettings): void {
  world.clear();
  syncWorldConfig(world, settings);

  const leftA = createPoint(world, settings, settings.worldWidth * 0.28, settings.worldHeight * 0.35);
  const leftB = createPoint(world, settings, settings.worldWidth * 0.37, settings.worldHeight * 0.35);
  const rightA = createPoint(world, settings, settings.worldWidth * 0.62, settings.worldHeight * 0.35);
  const rightB = createPoint(world, settings, settings.worldWidth * 0.71, settings.worldHeight * 0.35);

  connect(world, leftA, leftB, settings);
  connect(world, rightA, rightB, settings);
  connect(world, leftB, rightA, settings, {
    tearThreshold: Math.min(settings.tearThreshold, 1.25),
  });

  spawnDenseGrid(
    {
      world,
      settings,
      centerX: settings.worldWidth * 0.5,
      centerY: settings.worldHeight * 0.6,
    },
    { columns: 4, rows: 4, spacing: 30 },
  );
}

export function loadCharacterDemoScene(world: PhysicsWorld, settings: PlaygroundSettings): void {
  world.clear();
  syncWorldConfig(world, settings);

  createPinnedColliderSegment(world, settings, settings.worldWidth * 0.18, settings.worldHeight * 0.72, settings.worldWidth * 0.46, settings.worldHeight * 0.72);
  createPinnedColliderSegment(world, settings, settings.worldWidth * 0.58, settings.worldHeight * 0.62, settings.worldWidth * 0.8, settings.worldHeight * 0.62);
  createPinnedColliderSegment(world, settings, settings.worldWidth * 0.62, settings.worldHeight * 0.48, settings.worldWidth * 0.76, settings.worldHeight * 0.4);

  spawnSquare({
    world,
    settings,
    centerX: settings.worldWidth * 0.68,
    centerY: settings.worldHeight * 0.18,
  });
}

export function loadLayerShowcaseScene(world: PhysicsWorld, settings: PlaygroundSettings): void {
  world.clear();
  syncWorldConfig(world, settings);

  spawnSquare({
    world,
    settings,
    centerX: settings.worldWidth * 0.2,
    centerY: settings.worldHeight * 0.24,
  }, {
    layers: [-1],
  });

  spawnCircle({
    world,
    settings,
    centerX: settings.worldWidth * 0.78,
    centerY: settings.worldHeight * 0.22,
  }, {
    layers: [1],
  });

  const leftAnchor = createPoint(world, settings, settings.worldWidth * 0.25, settings.worldHeight * 0.56, {
    pinned: true,
    layers: [0],
  });
  const leftMid = createPoint(world, settings, settings.worldWidth * 0.36, settings.worldHeight * 0.58, {
    layers: [0],
  });
  const bridgeLeft = createPoint(world, settings, settings.worldWidth * 0.47, settings.worldHeight * 0.56, {
    layers: [0, 1],
  });
  const bridgeRight = createPoint(world, settings, settings.worldWidth * 0.58, settings.worldHeight * 0.58, {
    layers: [0, 1],
  });
  const rightMid = createPoint(world, settings, settings.worldWidth * 0.69, settings.worldHeight * 0.56, {
    layers: [1],
  });
  const rightAnchor = createPoint(world, settings, settings.worldWidth * 0.8, settings.worldHeight * 0.58, {
    pinned: true,
    layers: [1],
  });

  connect(world, leftAnchor, leftMid, settings);
  connect(world, leftMid, bridgeLeft, settings);
  connect(world, bridgeLeft, bridgeRight, settings, {
    layer: 1,
  });
  connect(world, bridgeRight, rightMid, settings);
  connect(world, rightMid, rightAnchor, settings);
  connect(world, leftMid, bridgeRight, settings, {
    layer: 0,
    stiffness: settings.constraintStiffness * 0.85,
  });
  connect(world, bridgeLeft, rightMid, settings, {
    layer: 1,
    stiffness: settings.constraintStiffness * 0.85,
  });

  createPoint(world, settings, settings.worldWidth * 0.47, settings.worldHeight * 0.18, {
    layers: [0],
  });
  createPoint(world, settings, settings.worldWidth * 0.58, settings.worldHeight * 0.18, {
    layers: [1],
  });
}

interface PointCreationOptions {
  pinned?: boolean;
  layers?: LayerId[];
  collisionsEnabled?: boolean;
}

interface ConstraintOverrides {
  stiffness?: number;
  damping?: number;
  tearThreshold?: number;
  collisionRadius?: number;
  layer?: LayerId;
}

function createPoint(world: PhysicsWorld, settings: PlaygroundSettings, x: number, y: number, options: boolean | PointCreationOptions = false): PointId {
  const pinned = typeof options === "boolean" ? options : options.pinned ?? false;
  const layers = typeof options === "boolean" ? undefined : options.layers;
  const collisionsEnabled = typeof options === "boolean" ? undefined : options.collisionsEnabled;

  return world.createPoint({
    position: { x, y },
    mass: pinned ? Number.POSITIVE_INFINITY : 1,
    radius: settings.pointRadius,
    pinned,
    layers,
    collisionsEnabled,
  });
}

function connect(
  world: PhysicsWorld,
  pointAId: PointId,
  pointBId: PointId,
  settings: PlaygroundSettings,
  overrides: ConstraintOverrides = {},
): void {
  world.createConstraint({
    pointAId,
    pointBId,
    stiffness: overrides.stiffness ?? settings.constraintStiffness,
    damping: overrides.damping ?? settings.constraintDamping,
    tearThreshold: overrides.tearThreshold ?? settings.tearThreshold,
    collisionRadius: overrides.collisionRadius ?? settings.colliderRadius,
    layer: overrides.layer,
  });
}

function connectLoop(world: PhysicsWorld, pointIds: PointId[], settings: PlaygroundSettings): void {
  for (let index = 0; index < pointIds.length; index += 1) {
    connect(world, pointIds[index], pointIds[(index + 1) % pointIds.length], settings);
  }
}

function createPinnedColliderSegment(
  world: PhysicsWorld,
  settings: PlaygroundSettings,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): void {
  const startPointId = world.createPoint({
    position: { x: startX, y: startY },
    pinned: true,
    radius: settings.pointRadius,
  });
  const endPointId = world.createPoint({
    position: { x: endX, y: endY },
    pinned: true,
    radius: settings.pointRadius,
  });

  world.createConstraint({
    pointAId: startPointId,
    pointBId: endPointId,
    stiffness: 1,
    damping: Math.max(settings.constraintDamping, 6),
    tearThreshold: null,
    collisionRadius: settings.colliderRadius * 1.35,
  });
}
