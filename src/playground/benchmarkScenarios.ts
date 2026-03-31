import type { PhysicsWorld } from '../engine/index.ts';
import type { BenchmarkScenario } from './benchmarkTypes.ts';
import { loadEmptyScene, spawnCircle, spawnSquare, spawnSquareTriMesh, spawnTriangle } from './scenes.ts';
import { DEFAULT_SETTINGS, type PlaygroundSettings } from './types.ts';

const BASE_BENCHMARK_SETTINGS: PlaygroundSettings = {
  ...DEFAULT_SETTINGS,
  worldWidth: 2200,
  worldHeight: 1400,
  gravity: 900,
  iterations: 8,
  globalDamping: 0.3,
  friction: 10,
  restitution: 0.5,
  pointRadius: 10,
  colliderRadius: 10,
  constraintStiffness: 0.10,
  constraintDamping: 2,
  tearThreshold: 1.8,
  timeScale: 1,
  mouseRadius: 0,
  mouseStrength: 0,
  dragStiffness: 0,
  createPointMass: 0,
  createPointPinned: false,
};

export const BENCHMARK_SCENARIOS: BenchmarkScenario[] = [
  createScenario({
    id: 'many-small-mixed',
    name: 'Many Small Mixed Bodies',
    description: 'A field of many small triangles and squares to stress body count and broadphase.',
    settings: {
      ...BASE_BENCHMARK_SETTINGS,
    },
    setup(world, settings) {
      loadEmptyScene(world, settings);

      const columns = 8;
      const rows = 6;
      const spacingX = 260;
      const spacingY = 190;
      const startX = 280;
      const startY = 120;

      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const centerX = startX + column * spacingX;
          const centerY = startY + row * spacingY;

          if ((row + column) % 2 === 0) {
            spawnTriangle({ world, settings, centerX, centerY });
          } else {
            spawnSquare({ world, settings, centerX, centerY });
          }
        }
      }
    },
  }),
  createScenario({
    id: 'many-small-triangles',
    name: 'Many Small Triangles',
    description: 'Dense grid of triangle bodies for many-body collision throughput.',
    settings: {
      ...BASE_BENCHMARK_SETTINGS,
    },
    setup(world, settings) {
      loadEmptyScene(world, settings);

      const columns = 9;
      const rows = 6;
      const spacingX = 225;
      const spacingY = 170;
      const startX = 220;
      const startY = 90;

      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          spawnTriangle({
            world,
            settings,
            centerX: startX + column * spacingX,
            centerY: startY + row * spacingY,
          });
        }
      }
    },
  }),
  createScenario({
    id: 'packed-small-mixed',
    name: 'Packed Small Mixed Bodies',
    description: 'Small triangles and squares packed closer together to increase contact pressure.',
    settings: {
      ...BASE_BENCHMARK_SETTINGS,
    },
    setup(world, settings) {
      loadEmptyScene(world, settings);

      populateBodyGrid({
        world,
        settings,
        columns: 7,
        rows: 5,
        startX: 300,
        startY: 120,
        spacingX: 270,
        spacingY: 250,
        spawnBody({ column, row, centerX, centerY }) {
          if ((row + column) % 3 === 0) {
            spawnTriangle({ world, settings, centerX, centerY });
            return;
          }

          spawnSquare({ world, settings, centerX, centerY });
        },
      });
    },
  }),
  createScenario({
    id: 'many-small-circles',
    name: 'Many Small Circles',
    description: 'Many multi-point circular bodies to stress body count with more capsules per body.',
    settings: {
      ...BASE_BENCHMARK_SETTINGS,
    },
    setup(world, settings) {
      loadEmptyScene(world, settings);

      populateBodyGrid({
        world,
        settings,
        columns: 6,
        rows: 4,
        startX: 290,
        startY: 120,
        spacingX: 360,
        spacingY: 235,
        spawnBody({ centerX, centerY }) {
          spawnCircle({ world, settings, centerX, centerY });
        },
      });
    },
  }),
  createScenario({
    id: 'many-small-meshes',
    name: 'Many Small Mesh Bodies',
    description: 'A set of compact triangulated grid bodies to stress body count and constraint density together.',
    settings: {
      ...BASE_BENCHMARK_SETTINGS,
    },
    setup(world, settings) {
      loadEmptyScene(world, settings);

      populateBodyGrid({
        world,
        settings,
        columns: 5,
        rows: 3,
        startX: 300,
        startY: 200,
        spacingX: 420,
        spacingY: 320,
        spawnBody({ centerX, centerY }) {
          spawnSquareTriMesh(
            {
              world,
              settings,
              centerX,
              centerY,
            },
          );
        },
      });
    },
  }),
  createScenario({
    id: 'single-big-body',
    name: 'Single Big Body',
    description: 'One big triangulated dense body.',
    settings: {
      ...BASE_BENCHMARK_SETTINGS,
    },
    setup(world, settings) {
      loadEmptyScene(world, settings);
      spawnSquareTriMesh(
        {
          world,
          settings,
          centerX: settings.worldWidth * 0.5,
          centerY: settings.worldHeight * 0.42,
        },
        {
          columns: 25,
          rows: 17,
          spacing: 70,
        },
      );
    },
  }),
  createScenario({
    id: 'two-big-bodies',
    name: 'Two Big Bodies',
    description: 'Two big triangulated bodies positioned to collide.',
    settings: {
      ...BASE_BENCHMARK_SETTINGS,
    },
    setup(world, settings) {
      loadEmptyScene(world, settings);

      spawnSquareTriMesh(
        {
          world,
          settings,
          centerX: settings.worldWidth * 0.3,
          centerY: settings.worldHeight * 0.35,
        },
        {
          columns: 15,
          rows: 15,
          spacing: 60,
        },
      );

      spawnSquareTriMesh(
        {
          world,
          settings,
          centerX: settings.worldWidth * 0.7,
          centerY: settings.worldHeight * 0.35,
        },
        {
          columns: 15,
          rows: 15,
          spacing: 60,
        },
      );
    },
  }),
  createScenario({
    id: 'two-big-bodies-vertically',
    name: 'Two Big Bodies Vertically',
    description: 'Two big triangulated bodies positioned vertically to collide.',
    settings: {
      ...BASE_BENCHMARK_SETTINGS,
    },
    setup(world, settings) {
      loadEmptyScene(world, settings);
    spawnSquareTriMesh(
      {
        world,
        settings,
        centerX: settings.worldWidth * 0.5,
        centerY: settings.worldHeight * 0.25,
      },
      {
        columns: 15,
        rows: 7,
        spacing: 60,
      },
    );
    spawnSquareTriMesh(
      {
        world,
        settings,
        centerX: settings.worldWidth * 0.5,
        centerY: settings.worldHeight * 0.65,
      },
      {
        columns: 15,
        rows: 7,
        spacing: 60,
      },
    );
    },
  }),
  createScenario({
    id: 'long-plank-one-fixed-point',
    name: 'Long Plank One Fixed Point',
    description: 'A long plank with one fixed point.',
    settings: {
      ...BASE_BENCHMARK_SETTINGS,
    },
    setup(world, settings) {
      loadEmptyScene(world, settings);
      spawnSquareTriMesh(
        {
          world,
          settings,
          centerX: settings.worldWidth * 0.5,
          centerY: settings.worldHeight * 0.1,
        },
        {
          columns: 30,
          rows: 4,
          spacing: 50,
        },
      );
      world.createPoint({
        position: {
          x: settings.worldWidth * 0.5,
          y: settings.worldHeight * 0.4,
        },
        pinned: true,
      });
    },
  }),
];

export function getBenchmarkScenarioById(id: string): BenchmarkScenario | undefined {
  return BENCHMARK_SCENARIOS.find((scenario) => scenario.id === id);
}

function createScenario(options: {
  id: string;
  name: string;
  description: string;
  settings: PlaygroundSettings;
  setup: (world: PhysicsWorld, settings: PlaygroundSettings) => void;
}): BenchmarkScenario {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    settings: options.settings,
    setup(world) {
      options.setup(world, options.settings);
    },
  };
}

function populateBodyGrid(options: {
  world: PhysicsWorld;
  settings: PlaygroundSettings;
  columns: number;
  rows: number;
  startX: number;
  startY: number;
  spacingX: number;
  spacingY: number;
  spawnBody: (options: { column: number; row: number; centerX: number; centerY: number }) => void;
}): void {
  for (let row = 0; row < options.rows; row += 1) {
    for (let column = 0; column < options.columns; column += 1) {
      options.spawnBody({
        column,
        row,
        centerX: options.startX + column * options.spacingX,
        centerY: options.startY + row * options.spacingY,
      });
    }
  }
}
