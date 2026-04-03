import { useCallback, useEffect, useRef, useState } from 'react';
import { createWorld, type ConstraintId, type PhysicsWorld, type PointId, type WorldSnapshot } from '../engine/index.ts';
import { NumberControl } from './NumberControl.tsx';
import { Tooltip } from './Tooltip.tsx';
import { SimulationCanvas, type SimulationFrameReport } from './SimulationCanvas.tsx';
import { BENCHMARK_SCENARIOS, getBenchmarkScenarioById } from './benchmarkScenarios.ts';
import { findConstraintAt, findPointAt, getPreviewLine } from './hitTesting.ts';
import {
  canCreateConstraintBetween,
  findPointSnapshotById,
  getCreateConstraintLayer,
  getCreatePointLayers,
  getPreviewConstraintColor,
} from './layers.ts';
import {
  createRollingMetricsWindow,
  finalizeRollingMetrics,
  recordFrameMetrics,
  type PerformanceStats,
  type RollingMetricsWindow,
} from './simulationMetrics.ts';
import {
  loadBridgeValidationScene,
  loadCapsuleEndpointValidationScene,
  loadDefaultScene,
  loadEmptyScene,
  loadLayerShowcaseScene,
  loadWallsValidationScene,
  spawnCircle,
  spawnDenseGrid,
  spawnPyramid,
  spawnSquare,
  spawnSquareTriMesh,
  spawnTriangle,
  syncWorldConfig,
} from './scenes.ts';
import { fitCameraToWorld } from './render.ts';
import { DEFAULT_SETTINGS, type CameraState, type PlaygroundSettings } from './types.ts';

const SETTINGS_STORAGE_KEY = 'squish-playground-settings';
const POINT_HIT_RADIUS_PIXELS = 14;
const CONSTRAINT_HIT_RADIUS_PIXELS = 10;

type MouseMode = 'pull' | 'push' | 'drag' | 'deletePoint' | 'deleteConstraint' | 'createPoint' | 'createConstraint';

interface WorldStats {
  points: number;
  constraints: number;
}

interface PointerState {
  world: { x: number; y: number } | null;
  primaryDown: boolean;
}

interface InteractionState {
  dragSourcePointId: PointId | null;
  dragCursorPointId: PointId | null;
  dragConstraintId: ConstraintId | null;
  pendingConstraintStartPointId: PointId | null;
}

interface PlaygroundViewProps {
  onOpenBenchmarkRunner: () => void;
}

export function PlaygroundView({ onOpenBenchmarkRunner }: PlaygroundViewProps) {
  const [settings, setSettings] = useState<PlaygroundSettings>(loadSettings);
  const [paused, setPaused] = useState(false);
  const [mouseMode, setMouseMode] = useState<MouseMode>('pull');
  const [selectedBenchmarkScenarioId, setSelectedBenchmarkScenarioId] = useState<string>(BENCHMARK_SCENARIOS[0]?.id ?? '');
  const [camera, setCamera] = useState<CameraState>({
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  });
  const [stats, setStats] = useState<WorldStats>({
    points: 0,
    constraints: 0,
  });
  const [performanceStats, setPerformanceStats] = useState<PerformanceStats>({
    fps: 0,
    stepMs: 0,
    snapshotMs: 0,
    drawMs: 0,
    idleMs: 0,
  });

  const worldRef = useRef<PhysicsWorld | null>(null);
  const snapshotRef = useRef<WorldSnapshot | null>(null);
  const settingsRef = useRef(settings);
  const mouseModeRef = useRef(mouseMode);
  const pointerRef = useRef<PointerState>({
    world: null,
    primaryDown: false,
  });
  const interactionRef = useRef<InteractionState>(createIdleInteractionState());
  const metricsWindowRef = useRef<RollingMetricsWindow>(createRollingMetricsWindow());
  const statsFrameBudgetRef = useRef(0);
  const hasInitializedRef = useRef(false);
  const canvasSizeRef = useRef({ width: 0, height: 0 });
  const pendingFitRef = useRef(false);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    mouseModeRef.current = mouseMode;
  }, [mouseMode]);

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const fitCameraIfPossible = useCallback((worldSettings: PlaygroundSettings) => {
    if (canvasSizeRef.current.width <= 0 || canvasSizeRef.current.height <= 0) {
      pendingFitRef.current = true;
      return;
    }

    pendingFitRef.current = false;
    setCamera(
      fitCameraToWorld(
        canvasSizeRef.current.width,
        canvasSizeRef.current.height,
        worldSettings.worldWidth,
        worldSettings.worldHeight,
      ),
    );
  }, []);

  const cleanupTemporaryInteraction = useCallback(() => {
    const world = worldRef.current;
    const interaction = interactionRef.current;

    if (world && interaction.dragConstraintId !== null) {
      try {
        world.removeConstraint(interaction.dragConstraintId);
      } catch {
        // Ignore stale temporary constraints during resets.
      }
    }

    if (world && interaction.dragCursorPointId !== null) {
      try {
        world.removePoint(interaction.dragCursorPointId);
      } catch {
        // Ignore stale temporary points during resets.
      }
    }

    interactionRef.current = createIdleInteractionState();
  }, []);

  const recreateWorld = useCallback(
    (
      sceneLoader: (world: PhysicsWorld, nextSettings: PlaygroundSettings) => void = loadDefaultScene,
      worldSettings = settingsRef.current,
    ) => {
      cleanupTemporaryInteraction();

      const world = createWorld({
        gravity: { x: 0, y: worldSettings.gravity },
        size: { x: worldSettings.worldWidth, y: worldSettings.worldHeight },
        iterations: worldSettings.iterations,
        globalDamping: worldSettings.globalDamping,
        friction: worldSettings.friction,
        restitution: worldSettings.restitution,
        defaultPointRadius: worldSettings.pointRadius,
        defaultColliderRadius: worldSettings.colliderRadius,
        gridCellSize: Math.max(worldSettings.colliderRadius * 4, 48),
      });

      syncWorldConfig(world, worldSettings);
      sceneLoader(world, worldSettings);
      worldRef.current = world;
      metricsWindowRef.current = createRollingMetricsWindow();
      statsFrameBudgetRef.current = 0;
      fitCameraIfPossible(worldSettings);

      const snapshotStart = performance.now();
      const snapshot = world.getSnapshot();
      const snapshotMs = performance.now() - snapshotStart;
      snapshotRef.current = snapshot;

      setStats({
        points: snapshot.points.length,
        constraints: snapshot.constraints.length,
      });
      setPerformanceStats({
        fps: 0,
        stepMs: 0,
        snapshotMs,
        drawMs: 0,
        idleMs: 0,
      });
    },
    [cleanupTemporaryInteraction, fitCameraIfPossible],
  );

  useEffect(() => {
    if (hasInitializedRef.current) {
      return;
    }

    hasInitializedRef.current = true;
    recreateWorld(loadDefaultScene);
  }, [recreateWorld]);

  useEffect(() => {
    if (!worldRef.current) {
      return;
    }

    syncWorldConfig(worldRef.current, settings);
  }, [settings]);

  useEffect(() => {
    cleanupTemporaryInteraction();
    pointerRef.current.primaryDown = false;
  }, [mouseMode, cleanupTemporaryInteraction]);

  const updateSetting = useCallback(<Key extends keyof PlaygroundSettings>(key: Key, value: PlaygroundSettings[Key]) => {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const spawnAtPointerOrCenter = useCallback(
    (
      spawn: (options: { world: PhysicsWorld; settings: PlaygroundSettings; centerX: number; centerY: number }) => void,
    ) => {
      const world = worldRef.current;

      if (!world) {
        return;
      }

      const target = pointerRef.current.world ?? {
        x: settings.worldWidth * 0.5,
        y: settings.worldHeight * 0.25,
      };

      spawn({
        world,
        settings,
        centerX: clamp(target.x, 80, settings.worldWidth - 80),
        centerY: clamp(target.y, 80, settings.worldHeight - 80),
      });
    },
    [settings],
  );

  const openBenchmarkScenarioInPlayground = useCallback(
    (scenarioId: string) => {
      const scenario = getBenchmarkScenarioById(scenarioId);

      if (!scenario) {
        return;
      }

      recreateWorld((world) => scenario.setup(world), scenario.settings);
    },
    [recreateWorld],
  );

  const handleResetControls = useCallback(() => {
    if (!window.confirm('Reset all controls to their default values? This removes saved settings and reloads the default scene.')) {
      return;
    }

    window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
    settingsRef.current = DEFAULT_SETTINGS;
    setSettings(DEFAULT_SETTINGS);
    recreateWorld(loadDefaultScene, DEFAULT_SETTINGS);
  }, [recreateWorld]);

  const handleBeforeStep = useCallback((world: PhysicsWorld) => {
    const pointerWorld = getInteractionPointerWorld(pointerRef.current.world, mouseModeRef.current, settingsRef.current);

    if (!pointerWorld || !pointerRef.current.primaryDown) {
      return;
    }

    if (mouseModeRef.current === 'pull' || mouseModeRef.current === 'push') {
      world.applyRadialForce({
        center: pointerWorld,
        radius: settingsRef.current.mouseRadius,
        strength: mouseModeRef.current === 'pull' ? settingsRef.current.mouseStrength : -settingsRef.current.mouseStrength,
      });
    }

    if (mouseModeRef.current === 'drag' && interactionRef.current.dragCursorPointId !== null) {
      world.setPointPosition({
        pointId: interactionRef.current.dragCursorPointId,
        position: pointerWorld,
        previousPosition: pointerWorld,
      });
    }
  }, []);

  const handleFrameRendered = useCallback((report: SimulationFrameReport) => {
    snapshotRef.current = report.snapshot;

    recordFrameMetrics(metricsWindowRef.current, {
      elapsedSeconds: report.elapsedSeconds,
      stepDurationsMs: report.stepDurationsMs,
      snapshotMs: report.snapshotMs,
      drawMs: report.drawMs,
    });

    statsFrameBudgetRef.current += report.elapsedSeconds;

    if (statsFrameBudgetRef.current >= 0.2) {
      setStats({
        points: report.snapshot.points.length,
        constraints: report.snapshot.constraints.length,
      });
      statsFrameBudgetRef.current = 0;
    }

    if (metricsWindowRef.current.elapsedSeconds >= 0.4) {
      setPerformanceStats(finalizeRollingMetrics(metricsWindowRef.current));
      metricsWindowRef.current = createRollingMetricsWindow();
    }
  }, []);

  const handlePrimaryPointerDown = useCallback(() => {
    const world = worldRef.current;
    const snapshot = snapshotRef.current;
    const pointerWorld = getInteractionPointerWorld(pointerRef.current.world, mouseModeRef.current, settingsRef.current);

    if (!world || !snapshot || !pointerWorld) {
      return;
    }

    const pointHitRadius = POINT_HIT_RADIUS_PIXELS / camera.zoom;
    const constraintHitRadius = CONSTRAINT_HIT_RADIUS_PIXELS / camera.zoom;

    switch (mouseModeRef.current) {
      case 'pull':
      case 'push': {
        pointerRef.current.primaryDown = true;
        break;
      }

      case 'drag': {
        const targetPoint = findPointAt(snapshot, pointerWorld, pointHitRadius);

        if (!targetPoint) {
          return;
        }

        const cursorPointId = world.createPoint({
          position: pointerWorld,
          previousPosition: pointerWorld,
          pinned: true,
          radius: 0,
          layers: targetPoint.layers,
          collisionsEnabled: false,
        });
        const constraintId = world.createConstraint({
          pointAId: targetPoint.id,
          pointBId: cursorPointId,
          length: 0,
          stiffness: settingsRef.current.dragStiffness,
          damping: settingsRef.current.constraintDamping,
          collisionRadius: 0,
          layer: targetPoint.layers[0],
        });

        interactionRef.current = {
          dragSourcePointId: targetPoint.id,
          dragCursorPointId: cursorPointId,
          dragConstraintId: constraintId,
          pendingConstraintStartPointId: null,
        };
        pointerRef.current.primaryDown = true;
        break;
      }

      case 'deletePoint': {
        const targetPoint = findPointAt(snapshot, pointerWorld, pointHitRadius);

        if (targetPoint) {
          world.removePoint(targetPoint.id);
        }
        break;
      }

      case 'deleteConstraint': {
        const targetConstraint = findConstraintAt(snapshot, pointerWorld, constraintHitRadius);

        if (targetConstraint) {
          world.removeConstraint(targetConstraint.id);
        }
        break;
      }

      case 'createPoint': {
        world.createPoint({
          position: pointerWorld,
          previousPosition: pointerWorld,
          mass: settingsRef.current.createPointPinned ? Number.POSITIVE_INFINITY : settingsRef.current.createPointMass,
          radius: settingsRef.current.pointRadius,
          pinned: settingsRef.current.createPointPinned,
          layers: getCreatePointLayers(settingsRef.current),
        });
        break;
      }

      case 'createConstraint': {
        const targetPoint = findPointAt(snapshot, pointerWorld, pointHitRadius);

        if (!targetPoint) {
          return;
        }

        interactionRef.current.pendingConstraintStartPointId = targetPoint.id;
        pointerRef.current.primaryDown = true;
        break;
      }
    }
  }, [camera.zoom]);

  const handlePrimaryPointerUp = useCallback(() => {
    const world = worldRef.current;
    const snapshot = snapshotRef.current;
    const mode = mouseModeRef.current;
    const pointerWorld = getInteractionPointerWorld(pointerRef.current.world, mode, settingsRef.current);

    pointerRef.current.primaryDown = false;

    if (!world) {
      return;
    }

    if (mode === 'drag') {
      cleanupTemporaryInteraction();
      return;
    }

    if (mode !== 'createConstraint' || !snapshot || !pointerWorld) {
      interactionRef.current.pendingConstraintStartPointId = null;
      return;
    }

    const startPointId = interactionRef.current.pendingConstraintStartPointId;

    if (startPointId === null) {
      return;
    }

    const startPoint = findPointSnapshotById(snapshot, startPointId);
    const targetPoint = findPointAt(snapshot, pointerWorld, POINT_HIT_RADIUS_PIXELS / camera.zoom);
    const requestedLayer = getCreateConstraintLayer(settingsRef.current);

    if (
      startPoint
      && targetPoint
      && targetPoint.id !== startPointId
      && canCreateConstraintBetween(startPoint, targetPoint, requestedLayer)
    ) {
      world.createConstraint({
        pointAId: startPointId,
        pointBId: targetPoint.id,
        stiffness: settingsRef.current.constraintStiffness,
        damping: settingsRef.current.constraintDamping,
        tearThreshold: settingsRef.current.tearThreshold,
        collisionRadius: settingsRef.current.colliderRadius,
        layer: requestedLayer,
      });
    }

    interactionRef.current.pendingConstraintStartPointId = null;
  }, [camera.zoom, cleanupTemporaryInteraction]);

  const handleCanvasSizeChange = useCallback(
    (size: { width: number; height: number }) => {
      canvasSizeRef.current = size;

      if (pendingFitRef.current) {
        fitCameraIfPossible(settingsRef.current);
      }
    },
    [fitCameraIfPossible],
  );

  const handlePointerLeave = useCallback(() => {
    pointerRef.current.primaryDown = false;
    pointerRef.current.world = null;
    cleanupTemporaryInteraction();
  }, [cleanupTemporaryInteraction]);

  const getOverlayState = useCallback(() => {
    const snapshot = snapshotRef.current;
    const pointerWorld = getInteractionPointerWorld(pointerRef.current.world, mouseModeRef.current, settingsRef.current);
    const snappingActive = shouldUseCreationSnap(mouseModeRef.current, settingsRef.current);
    const previewPointId = interactionRef.current.pendingConstraintStartPointId ?? interactionRef.current.dragSourcePointId;
    const hoveredPointId =
      snapshot && pointerWorld && mouseModeRef.current === 'createConstraint'
        ? findPointAt(snapshot, pointerWorld, POINT_HIT_RADIUS_PIXELS / camera.zoom)?.id ?? null
        : null;
    const previewColor =
      snapshot && mouseModeRef.current === 'createConstraint'
        ? getPreviewConstraintColor(
            snapshot,
            interactionRef.current.pendingConstraintStartPointId,
            hoveredPointId,
            getCreateConstraintLayer(settingsRef.current),
          )
        : interactionRef.current.pendingConstraintStartPointId !== null
          ? '#ffd76a'
          : '#ff9f4d';

    return {
      pointerWorld: mouseModeRef.current === 'pull' || mouseModeRef.current === 'push' ? pointerWorld : null,
      overlayRadius:
        mouseModeRef.current === 'pull' || mouseModeRef.current === 'push' ? settingsRef.current.mouseRadius : null,
      previewLine:
        snapshot && pointerWorld
          ? getPreviewLine(
              snapshot,
              previewPointId,
              pointerWorld,
              previewColor,
            )
          : null,
      previewPoint:
        mouseModeRef.current === 'createPoint' && pointerWorld
          ? {
              x: pointerWorld.x,
              y: pointerWorld.y,
              radius: settingsRef.current.pointRadius,
              pinned: settingsRef.current.createPointPinned,
            }
          : null,
      gridSpacing: snappingActive ? settingsRef.current.snapGridSpacing : null,
    };
  }, [camera.zoom]);

  return (
    <div className="app-shell">
      <header className="toolbar">
        <div className="toolbar__group">
          <button className="toolbar__button" onClick={() => setPaused((current) => !current)}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button className="toolbar__button" onClick={() => recreateWorld(loadDefaultScene)}>
            Reset
          </button>
          <button className="toolbar__button" onClick={() => recreateWorld(loadEmptyScene)}>
            Clear scene
          </button>
          <button className="toolbar__button" onClick={handleResetControls}>
            Reset Controls
          </button>
          <button className="toolbar__button" onClick={() => recreateWorld(loadWallsValidationScene)}>
            Walls Test
          </button>
          <button className="toolbar__button" onClick={() => recreateWorld(loadCapsuleEndpointValidationScene)}>
            Endpoint Test
          </button>
          <button className="toolbar__button" onClick={() => recreateWorld(loadBridgeValidationScene)}>
            Bridge Test
          </button>
          <button className="toolbar__button" onClick={() => recreateWorld(loadLayerShowcaseScene)}>
            Layer Test
          </button>
          <button className="toolbar__button toolbar__button--accent" onClick={onOpenBenchmarkRunner}>
            Benchmark Runner
          </button>
        </div>

        <div className="toolbar__group">
          <button className="toolbar__button" onClick={() => spawnAtPointerOrCenter(spawnSquare)}>
            Square
          </button>
          <button className="toolbar__button" onClick={() => spawnAtPointerOrCenter(spawnTriangle)}>
            Triangle
          </button>
          <button className="toolbar__button" onClick={() => spawnAtPointerOrCenter(spawnCircle)}>
            Circle
          </button>
          <button className="toolbar__button" onClick={() => spawnAtPointerOrCenter(spawnSquareTriMesh)}>
            Square mesh
          </button>
          <button className="toolbar__button" onClick={() => spawnAtPointerOrCenter(spawnDenseGrid)}>
            Dense Grid
          </button>
          <button className="toolbar__button" onClick={() => spawnAtPointerOrCenter(spawnPyramid)}>
            Pyramid
          </button>
        </div>

        <div className="toolbar__group">
          <select
            className="toolbar__select"
            value={selectedBenchmarkScenarioId}
            onChange={(event) => setSelectedBenchmarkScenarioId(event.target.value)}
          >
            {BENCHMARK_SCENARIOS.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.name}
              </option>
            ))}
          </select>
          <button className="toolbar__button" onClick={() => openBenchmarkScenarioInPlayground(selectedBenchmarkScenarioId)}>
            Open Bench Scene
          </button>
        </div>

        <div className="toolbar__stats">
          <StatChip label="Points" value={stats.points.toString()} />
          <StatChip label="Constraints" value={stats.constraints.toString()} />
          <StatChip label="FPS" value={performanceStats.fps.toFixed(1).padStart(5, '\u00a0')} />
          <StatChip label="Step" value={`${performanceStats.stepMs.toFixed(2)} ms`} />
          <StatChip label="Snapshot" value={`${performanceStats.snapshotMs.toFixed(2)} ms`} />
          <StatChip label="Draw" value={`${performanceStats.drawMs.toFixed(2)} ms`} />
          <StatChip label="Idle" value={`${performanceStats.idleMs.toFixed(2)} ms`} />
        </div>
      </header>

      <section className="controls">
        <NumberControl label="Time scale" min={0.1} max={2} step={0.05} value={settings.timeScale} onChange={(value) => updateSetting('timeScale', value)} />
        <NumberControl label="Gravity" min={0} max={2000} step={25} value={settings.gravity} onChange={(value) => updateSetting('gravity', value)} />
        <NumberControl label="Iterations" min={1} max={16} step={1} value={settings.iterations} onChange={(value) => updateSetting('iterations', Math.round(value))} />
        <NumberControl label="Stiffness" min={0.001} max={1} step={0.001} value={settings.constraintStiffness} onChange={(value) => updateSetting('constraintStiffness', value)} />
        <NumberControl label="Constraint damping" min={0} max={50} step={0.5} value={settings.constraintDamping} onChange={(value) => updateSetting('constraintDamping', value)} />
        <NumberControl label="Velocity damping" min={0} max={10} step={0.1} value={settings.globalDamping} onChange={(value) => updateSetting('globalDamping', value)} />
        <NumberControl label="Friction" min={0} max={40} step={0.5} value={settings.friction} onChange={(value) => updateSetting('friction', value)} />
        <NumberControl label="Restitution" min={0} max={1} step={0.02} value={settings.restitution} onChange={(value) => updateSetting('restitution', value)} />
        <NumberControl label="Tear threshold" min={1.05} max={4} step={0.05} value={settings.tearThreshold} onChange={(value) => updateSetting('tearThreshold', value)} />
        <NumberControl label="World width" min={200} max={8000} step={20} value={settings.worldWidth} onChange={(value) => updateSetting('worldWidth', value)} />
        <NumberControl label="World height" min={200} max={8000} step={20} value={settings.worldHeight} onChange={(value) => updateSetting('worldHeight', value)} />
        <NumberControl label="Point radius" min={2} max={20} step={1} value={settings.pointRadius} onChange={(value) => updateSetting('pointRadius', value)} />
        <NumberControl label="Capsule radius" min={2} max={24} step={1} value={settings.colliderRadius} onChange={(value) => updateSetting('colliderRadius', value)} />
        <label className="control control--boolean">
          <span className="control__label">Use XPBD solver</span>
          <input className="control__checkbox" type="checkbox" checked={settings.useXPBDSolver} onChange={(event) => updateSetting('useXPBDSolver', event.target.checked)} />
        </label>
      </section>

      <section className="workspace">
        <aside className="tools-panel">
          <div className="tools-panel__header">
            <h2 className="tools-panel__title">Mouse Tools</h2>
            <Tooltip
              label="Tool help"
              content="Pull and Push affect nearby points while held. Drag creates a temporary spring-like link from a point to the cursor. Create Constraint starts on one point and finishes on another on mouse release, but only when the selected layer rules are valid. Delete tools remove what you click."
            />
          </div>

          <div className="mode-grid">
            {MOUSE_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`mode-button${mouseMode === option.value ? ' mode-button--active' : ''}`}
                onClick={() => setMouseMode(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="tools-panel__settings">
            {(mouseMode === 'pull' || mouseMode === 'push') && (
              <>
                <NumberControl label="Mouse radius" min={20} max={320} step={5} value={settings.mouseRadius} onChange={(value) => updateSetting('mouseRadius', value)} />
                <NumberControl label="Mouse strength" min={100} max={25000} step={100} value={settings.mouseStrength} onChange={(value) => updateSetting('mouseStrength', value)} />
              </>
            )}

            {mouseMode === 'drag' && (
              <>
                <NumberControl label="Drag stiffness" min={0.001} max={1} step={0.001} value={settings.dragStiffness} onChange={(value) => updateSetting('dragStiffness', value)} />
                <div className="panel-note">Hold on a point to create a temporary spring between that point and the cursor.</div>
              </>
            )}

            {mouseMode === 'deletePoint' && <div className="panel-note">Click any point to remove it and its connected constraints.</div>}
            {mouseMode === 'deleteConstraint' && <div className="panel-note">Click a visible constraint or capsule edge to remove it.</div>}

            {mouseMode === 'createPoint' && (
              <>
                <label className="control control--boolean">
                  <span className="control__label">Snap to grid</span>
                  <input
                    className="control__checkbox"
                    type="checkbox"
                    checked={settings.snapToGrid}
                    onChange={(event) => updateSetting('snapToGrid', event.target.checked)}
                  />
                </label>
                {settings.snapToGrid && (
                  <NumberControl
                    label="Grid spacing"
                    min={20}
                    max={400}
                    step={10}
                    value={settings.snapGridSpacing}
                    onChange={(value) => updateSetting('snapGridSpacing', value)}
                  />
                )}
                <NumberControl label="Point radius" min={2} max={20} step={1} value={settings.pointRadius} onChange={(value) => updateSetting('pointRadius', value)} />
                <NumberControl label="Point mass" min={0.1} max={10} step={0.1} value={settings.createPointMass} onChange={(value) => updateSetting('createPointMass', value)} />
                <label className="control control--boolean">
                  <span className="control__label">Pinned point</span>
                  <input className="control__checkbox" type="checkbox" checked={settings.createPointPinned} onChange={(event) => updateSetting('createPointPinned', event.target.checked)} />
                </label>
                <div className="layer-setting">
                  <div className="layer-setting__label">Point layers</div>
                  <label className="layer-option">
                    <input
                      className="control__checkbox"
                      type="checkbox"
                      checked={settings.createPointLayerNegativeOne}
                      onChange={(event) => updateSetting('createPointLayerNegativeOne', event.target.checked)}
                    />
                    <span>Layer -1</span>
                  </label>
                  <label className="layer-option">
                    <input
                      className="control__checkbox"
                      type="checkbox"
                      checked={settings.createPointLayerZero}
                      onChange={(event) => updateSetting('createPointLayerZero', event.target.checked)}
                    />
                    <span>Layer 0</span>
                  </label>
                  <label className="layer-option">
                    <input
                      className="control__checkbox"
                      type="checkbox"
                      checked={settings.createPointLayerOne}
                      onChange={(event) => updateSetting('createPointLayerOne', event.target.checked)}
                    />
                    <span>Layer 1</span>
                  </label>
                </div>
                <div className="panel-note">No point layer selected falls back to the engine default layer `0`.</div>
              </>
            )}

            {mouseMode === 'createConstraint' && (
              <>
                <label className="control control--boolean">
                  <span className="control__label">Snap to grid</span>
                  <input
                    className="control__checkbox"
                    type="checkbox"
                    checked={settings.snapToGrid}
                    onChange={(event) => updateSetting('snapToGrid', event.target.checked)}
                  />
                </label>
                {settings.snapToGrid && (
                  <NumberControl
                    label="Grid spacing"
                    min={20}
                    max={400}
                    step={1}
                    value={settings.snapGridSpacing}
                    onChange={(value) => updateSetting('snapGridSpacing', value)}
                  />
                )}
                <NumberControl label="Constraint stiffness" min={0.001} max={1} step={0.001} value={settings.constraintStiffness} onChange={(value) => updateSetting('constraintStiffness', value)} />
                <NumberControl label="Constraint damping" min={0} max={50} step={0.5} value={settings.constraintDamping} onChange={(value) => updateSetting('constraintDamping', value)} />
                <NumberControl label="Capsule radius" min={0} max={24} step={1} value={settings.colliderRadius} onChange={(value) => updateSetting('colliderRadius', value)} />
                <NumberControl label="Tear threshold" min={1.05} max={4} step={0.05} value={settings.tearThreshold} onChange={(value) => updateSetting('tearThreshold', value)} />
                <div className="layer-setting">
                  <div className="layer-setting__label">Constraint layer</div>
                  {CONSTRAINT_LAYER_OPTIONS.map((option) => (
                    <label key={option.value} className="layer-option">
                      <input
                        className="control__checkbox"
                        type="radio"
                        name="constraint-layer"
                        checked={settings.createConstraintLayer === option.value}
                        onChange={() => updateSetting('createConstraintLayer', option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
                <div className="panel-note">Auto only works when the two points share exactly one layer. Invalid or ambiguous matches are blocked before the engine call.</div>
              </>
            )}
          </div>
        </aside>

        <main className="canvas-shell">
          <SimulationCanvas
            worldRef={worldRef}
            camera={camera}
            paused={paused}
            useXPBDSolver={settings.useXPBDSolver}
            onCameraChange={setCamera}
            onPointerWorldChange={(position) => {
              pointerRef.current.world = position;
            }}
            onBeforeStep={handleBeforeStep}
            onFrameRendered={handleFrameRendered}
            onPrimaryPointerDown={handlePrimaryPointerDown}
            onPrimaryPointerUp={handlePrimaryPointerUp}
            onPointerLeave={handlePointerLeave}
            onCanvasSizeChange={handleCanvasSizeChange}
            getOverlayState={getOverlayState}
          />
        </main>
      </section>
    </div>
  );
}

function loadSettings(): PlaygroundSettings {
  try {
    const rawValue = window.localStorage.getItem(SETTINGS_STORAGE_KEY);

    if (!rawValue) {
      return DEFAULT_SETTINGS;
    }

    return {
      ...DEFAULT_SETTINGS,
      ...(JSON.parse(rawValue) as Partial<PlaygroundSettings>),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getInteractionPointerWorld(
  pointerWorld: { x: number; y: number } | null,
  mouseMode: MouseMode,
  settings: PlaygroundSettings,
): { x: number; y: number } | null {
  if (!pointerWorld) {
    return null;
  }

  if (!shouldUseCreationSnap(mouseMode, settings)) {
    return pointerWorld;
  }

  const spacing = Math.max(1, settings.snapGridSpacing);
  return {
    x: clamp(snapToGrid(pointerWorld.x, spacing), 0, settings.worldWidth),
    y: clamp(snapToGrid(pointerWorld.y, spacing), 0, settings.worldHeight),
  };
}

function shouldUseCreationSnap(mouseMode: MouseMode, settings: PlaygroundSettings): boolean {
  return settings.snapToGrid && (mouseMode === 'createPoint' || mouseMode === 'createConstraint');
}

function snapToGrid(value: number, spacing: number): number {
  return Math.round(value / spacing) * spacing;
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-chip">
      <span className="stat-chip__label">{label}</span>
      <span className="stat-chip__value">{value}</span>
    </div>
  );
}

function createIdleInteractionState(): InteractionState {
  return {
    dragSourcePointId: null,
    dragCursorPointId: null,
    dragConstraintId: null,
    pendingConstraintStartPointId: null,
  };
}

const MOUSE_MODE_OPTIONS: Array<{ value: MouseMode; label: string }> = [
  { value: 'pull', label: 'Pull' },
  { value: 'push', label: 'Push' },
  { value: 'drag', label: 'Drag' },
  { value: 'deletePoint', label: 'Delete Point' },
  { value: 'deleteConstraint', label: 'Delete Constraint' },
  { value: 'createPoint', label: 'Create Point' },
  { value: 'createConstraint', label: 'Create Constraint' },
];

const CONSTRAINT_LAYER_OPTIONS: Array<{ value: 'auto' | -1 | 0 | 1; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: -1, label: 'Layer -1' },
  { value: 0, label: 'Layer 0' },
  { value: 1, label: 'Layer 1' },
];
