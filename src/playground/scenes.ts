import type { PhysicsWorld, PointId } from "../engine/index.ts";
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

export function spawnSquare(options: SpawnOptions): void {
  const { world, settings, centerX, centerY } = options;
  const halfSize = 70;
  const points = [
    createPoint(world, settings, centerX - halfSize, centerY - halfSize),
    createPoint(world, settings, centerX + halfSize, centerY - halfSize),
    createPoint(world, settings, centerX + halfSize, centerY + halfSize),
    createPoint(world, settings, centerX - halfSize, centerY + halfSize),
  ];

  connectLoop(world, points, settings);
  connect(world, points[0], points[2], settings);
  connect(world, points[1], points[3], settings);
}

export function spawnTriangle(options: SpawnOptions): void {
  const { world, settings, centerX, centerY } = options;
  const radius = 85;
  const points = [0, 1, 2].map((index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / 3;
    return createPoint(world, settings, centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
  });

  connectLoop(world, points, settings);
}

export function spawnCircle(options: SpawnOptions): void {
  const { world, settings, centerX, centerY } = options;
  const segments = 12;
  const radius = 95;
  const centerPoint = createPoint(world, settings, centerX, centerY);
  const ringPoints = Array.from({ length: segments }, (_, index) => {
    const angle = (Math.PI * 2 * index) / segments;
    return createPoint(world, settings, centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
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
export function spawnSquareTriMesh(options: SpawnOptions, shapeOptions?: ShapeOptions): void {
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
      rowPoints.push(createPoint(world, settings, centerX - width / 2 + column * spacing, centerY - height / 2 + row * spacing));
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
      rowPoints.push(createPoint(world, settings, centerX - width / 2 + column * spacing, centerY - height / 2 + row * spacing));
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

export function spawnPyramid(options: SpawnOptions): void {
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
      rowPoints.push(createPoint(world, settings, x, y));
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

function createPoint(world: PhysicsWorld, settings: PlaygroundSettings, x: number, y: number, pinned = false): PointId {
  return world.createPoint({
    position: { x, y },
    mass: pinned ? Number.POSITIVE_INFINITY : 1,
    radius: settings.pointRadius,
    pinned,
  });
}

function connect(
  world: PhysicsWorld,
  pointAId: PointId,
  pointBId: PointId,
  settings: PlaygroundSettings,
  overrides: {
    stiffness?: number;
    damping?: number;
    tearThreshold?: number;
  } = {},
): void {
  world.createConstraint({
    pointAId,
    pointBId,
    stiffness: overrides.stiffness ?? settings.constraintStiffness,
    damping: overrides.damping ?? settings.constraintDamping,
    tearThreshold: overrides.tearThreshold ?? settings.tearThreshold,
    collisionRadius: settings.colliderRadius,
  });
}

function connectLoop(world: PhysicsWorld, pointIds: PointId[], settings: PlaygroundSettings): void {
  for (let index = 0; index < pointIds.length; index += 1) {
    connect(world, pointIds[index], pointIds[(index + 1) % pointIds.length], settings);
  }
}
