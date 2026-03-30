import { useCallback, useEffect, useRef, useState, type PointerEvent as CanvasPointerEvent, type WheelEvent as CanvasWheelEvent } from "react";
import {
  createWorld,
  type ConstraintId,
  type ConstraintSnapshot,
  type PhysicsWorld,
  type PointId,
  type PointSnapshot,
  type WorldSnapshot,
} from "../engine/index.ts";
import { NumberControl } from "./NumberControl.tsx";
import { Tooltip } from "./Tooltip.tsx";
import {
  loadBridgeValidationScene,
  loadCapsuleEndpointValidationScene,
  loadDefaultScene,
  loadEmptyScene,
  loadWallsValidationScene,
  spawnCircle,
  spawnDenseGrid,
  spawnPyramid,
  spawnSquare,
  spawnSquareTriMesh,
  spawnTriangle,
  syncWorldConfig,
} from "./scenes.ts";
import { drawWorld, fitCameraToWorld, screenToWorld, zoomCameraAtPoint } from "./render.ts";
import { DEFAULT_SETTINGS, type CameraState, type PlaygroundSettings } from "./types.ts";

const FIXED_DELTA_TIME = 1 / 60;
const SETTINGS_STORAGE_KEY = "squish-playground-settings";
const POINT_HIT_RADIUS_PIXELS = 14;
const CONSTRAINT_HIT_RADIUS_PIXELS = 10;

type MouseMode = "pull" | "push" | "drag" | "deletePoint" | "deleteConstraint" | "createPoint" | "createConstraint";

interface PointerState {
  isLeftDown: boolean;
  isRightDown: boolean;
  lastScreenX: number;
  lastScreenY: number;
  world: { x: number; y: number } | null;
}

interface WorldStats {
  points: number;
  constraints: number;
  bodies: number;
}

interface PerformanceStats {
  fps: number;
  stepMs: number;
  snapshotMs: number;
  drawMs: number;
  idleMs: number;
}

interface MetricsWindow {
  elapsedSeconds: number;
  frameCount: number;
  totalStepMs: number;
  stepCount: number;
  totalSnapshotMs: number;
  totalDrawMs: number;
}

interface InteractionState {
  dragSourcePointId: PointId | null;
  dragCursorPointId: PointId | null;
  dragConstraintId: ConstraintId | null;
  pendingConstraintStartPointId: PointId | null;
}

function App() {
  const [settings, setSettings] = useState<PlaygroundSettings>(loadSettings);
  const [paused, setPaused] = useState(false);
  const [mouseMode, setMouseMode] = useState<MouseMode>("pull");
  const [camera, setCamera] = useState<CameraState>({
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  });
  const [stats, setStats] = useState<WorldStats>({
    points: 0,
    constraints: 0,
    bodies: 0,
  });
  const [performanceStats, setPerformanceStats] = useState<PerformanceStats>({
    fps: 0,
    stepMs: 0,
    snapshotMs: 0,
    drawMs: 0,
    idleMs: 0,
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worldRef = useRef<PhysicsWorld | null>(null);
  const snapshotRef = useRef<WorldSnapshot | null>(null);
  const cameraRef = useRef(camera);
  const settingsRef = useRef(settings);
  const mouseModeRef = useRef(mouseMode);
  const hasInitializedRef = useRef(false);
  const pointerRef = useRef<PointerState>({
    isLeftDown: false,
    isRightDown: false,
    lastScreenX: 0,
    lastScreenY: 0,
    world: null,
  });
  const interactionRef = useRef<InteractionState>(createIdleInteractionState());
  const accumulatorRef = useRef(0);
  const lastFrameTimeRef = useRef<number | null>(null);
  const statsFrameBudgetRef = useRef(0);
  const metricsWindowRef = useRef<MetricsWindow>(createEmptyMetricsWindow());

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    mouseModeRef.current = mouseMode;
  }, [mouseMode]);

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

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
    (sceneLoader: (world: PhysicsWorld, nextSettings: PlaygroundSettings) => void = loadDefaultScene, worldSettings = settingsRef.current) => {
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
      accumulatorRef.current = 0;
      lastFrameTimeRef.current = null;
      metricsWindowRef.current = createEmptyMetricsWindow();

      const canvas = canvasRef.current;

      if (canvas) {
        setCamera(fitCameraToWorld(canvas.clientWidth, canvas.clientHeight, worldSettings.worldWidth, worldSettings.worldHeight));
      }

      const snapshotStart = performance.now();
      const snapshot = world.getSnapshot();
      const snapshotMs = performance.now() - snapshotStart;
      snapshotRef.current = snapshot;
      setStats({
        points: snapshot.points.length,
        constraints: snapshot.constraints.length,
        bodies: snapshot.bodies.length,
      });
      setPerformanceStats({
        fps: 0,
        stepMs: 0,
        snapshotMs,
        drawMs: 0,
        idleMs: 0,
      });
    },
    [cleanupTemporaryInteraction],
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
    pointerRef.current.isLeftDown = false;
  }, [mouseMode, cleanupTemporaryInteraction]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    let animationFrameId = 0;

    const renderFrame = (time: number) => {
      const currentWorld = worldRef.current;

      if (!currentWorld) {
        animationFrameId = window.requestAnimationFrame(renderFrame);
        return;
      }

      const currentSettings = settingsRef.current;
      const currentMouseMode = mouseModeRef.current;
      const elapsedSeconds = lastFrameTimeRef.current === null ? FIXED_DELTA_TIME : Math.min((time - lastFrameTimeRef.current) / 1000, 1 / 20);

      lastFrameTimeRef.current = time;

      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
      }

      if (!paused) {
        accumulatorRef.current += elapsedSeconds * currentSettings.timeScale;

        while (accumulatorRef.current >= FIXED_DELTA_TIME) {
          const pointerWorld = pointerRef.current.world;

          if (pointerWorld && pointerRef.current.isLeftDown) {
            if (currentMouseMode === "pull" || currentMouseMode === "push") {
              currentWorld.applyRadialForce({
                center: pointerWorld,
                radius: currentSettings.mouseRadius,
                strength: currentMouseMode === "pull" ? currentSettings.mouseStrength : -currentSettings.mouseStrength,
              });
            }

            if (currentMouseMode === "drag" && interactionRef.current.dragCursorPointId !== null) {
              currentWorld.setPointPosition({
                pointId: interactionRef.current.dragCursorPointId,
                position: pointerWorld,
                previousPosition: pointerWorld,
              });
            }
          }

          const stepStart = performance.now();
          currentWorld.step(FIXED_DELTA_TIME);
          metricsWindowRef.current.totalStepMs += performance.now() - stepStart;
          metricsWindowRef.current.stepCount += 1;
          accumulatorRef.current -= FIXED_DELTA_TIME;
        }
      }

      const snapshotStart = performance.now();
      const snapshot = currentWorld.getSnapshot();
      const snapshotMs = performance.now() - snapshotStart;
      snapshotRef.current = snapshot;
      const drawStart = performance.now();
      drawWorld(
        context,
        snapshot,
        cameraRef.current,
        currentMouseMode === "pull" || currentMouseMode === "push" ? pointerRef.current.world : null,
        currentMouseMode === "pull" || currentMouseMode === "push" ? currentSettings.mouseRadius : null,
        getPreviewLine(snapshot, interactionRef.current, pointerRef.current.world),
      );
      const drawMs = performance.now() - drawStart;

      statsFrameBudgetRef.current += elapsedSeconds;
      metricsWindowRef.current.elapsedSeconds += elapsedSeconds;
      metricsWindowRef.current.frameCount += 1;
      metricsWindowRef.current.totalSnapshotMs += snapshotMs;
      metricsWindowRef.current.totalDrawMs += drawMs;

      if (statsFrameBudgetRef.current >= 0.2) {
        setStats({
          points: snapshot.points.length,
          constraints: snapshot.constraints.length,
          bodies: snapshot.bodies.length,
        });
        statsFrameBudgetRef.current = 0;
      }

      if (metricsWindowRef.current.elapsedSeconds >= 0.4) {
        const currentMetrics = metricsWindowRef.current;

        setPerformanceStats({
          fps: currentMetrics.frameCount / currentMetrics.elapsedSeconds,
          stepMs: currentMetrics.stepCount > 0 ? currentMetrics.totalStepMs / currentMetrics.stepCount : 0,
          snapshotMs: currentMetrics.totalSnapshotMs / currentMetrics.frameCount,
          drawMs: currentMetrics.totalDrawMs / currentMetrics.frameCount,
          idleMs: Math.max(
            0,
            (currentMetrics.elapsedSeconds * 1000) / currentMetrics.frameCount -
              currentMetrics.totalStepMs / currentMetrics.frameCount -
              currentMetrics.totalSnapshotMs / currentMetrics.frameCount -
              currentMetrics.totalDrawMs / currentMetrics.frameCount,
          ),
        });
        metricsWindowRef.current = createEmptyMetricsWindow();
      }

      animationFrameId = window.requestAnimationFrame(renderFrame);
    };

    animationFrameId = window.requestAnimationFrame(renderFrame);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      lastFrameTimeRef.current = null;
    };
  }, [paused]);

  const updateSetting = useCallback(<Key extends keyof PlaygroundSettings>(key: Key, value: PlaygroundSettings[Key]) => {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const spawnAtPointerOrCenter = useCallback(
    (spawn: (options: { world: PhysicsWorld; settings: PlaygroundSettings; centerX: number; centerY: number }) => void) => {
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

  const handlePointerMove = useCallback((event: CanvasPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    pointerRef.current.world = screenToWorld(cameraRef.current, screenX, screenY);

    if (pointerRef.current.isRightDown) {
      const deltaX = screenX - pointerRef.current.lastScreenX;
      const deltaY = screenY - pointerRef.current.lastScreenY;

      setCamera((currentCamera) => ({
        ...currentCamera,
        offsetX: currentCamera.offsetX + deltaX,
        offsetY: currentCamera.offsetY + deltaY,
      }));
    }

    pointerRef.current.lastScreenX = screenX;
    pointerRef.current.lastScreenY = screenY;
  }, []);

  const handleWheel = useCallback((event: CanvasWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();

    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    const nextZoom = clamp(cameraRef.current.zoom * Math.exp(-event.deltaY * 0.001), 0.1, 8);

    setCamera((currentCamera) => zoomCameraAtPoint(currentCamera, screenX, screenY, nextZoom));
  }, []);

  const handleResetControls = useCallback(() => {
    if (!window.confirm("Reset all controls to their default values? This removes saved settings and reloads the default scene.")) {
      return;
    }

    window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
    settingsRef.current = DEFAULT_SETTINGS;
    setSettings(DEFAULT_SETTINGS);
    recreateWorld(loadDefaultScene, DEFAULT_SETTINGS);
  }, [recreateWorld]);

  const handleLeftPointerDown = useCallback(() => {
    const world = worldRef.current;
    const snapshot = snapshotRef.current;
    const pointerWorld = pointerRef.current.world;

    if (!world || !snapshot || !pointerWorld) {
      return;
    }

    const worldHitRadiusForPoint = POINT_HIT_RADIUS_PIXELS / cameraRef.current.zoom;
    const worldHitRadiusForConstraint = CONSTRAINT_HIT_RADIUS_PIXELS / cameraRef.current.zoom;

    switch (mouseModeRef.current) {
      case "pull":
      case "push": {
        pointerRef.current.isLeftDown = true;
        break;
      }

      case "drag": {
        const targetPoint = findPointAt(snapshot, pointerWorld, worldHitRadiusForPoint);

        if (!targetPoint) {
          return;
        }

        const cursorPointId = world.createPoint({
          position: pointerWorld,
          previousPosition: pointerWorld,
          pinned: true,
          radius: 0,
        });
        const constraintId = world.createConstraint({
          pointAId: targetPoint.id,
          pointBId: cursorPointId,
          length: 0,
          stiffness: settingsRef.current.dragStiffness,
          damping: settingsRef.current.constraintDamping,
          collisionRadius: 0,
        });

        interactionRef.current = {
          dragSourcePointId: targetPoint.id,
          dragCursorPointId: cursorPointId,
          dragConstraintId: constraintId,
          pendingConstraintStartPointId: null,
        };
        pointerRef.current.isLeftDown = true;
        break;
      }

      case "deletePoint": {
        const targetPoint = findPointAt(snapshot, pointerWorld, worldHitRadiusForPoint);

        if (targetPoint) {
          world.removePoint(targetPoint.id);
        }
        break;
      }

      case "deleteConstraint": {
        const targetConstraint = findConstraintAt(snapshot, pointerWorld, worldHitRadiusForConstraint);

        if (targetConstraint) {
          world.removeConstraint(targetConstraint.id);
        }
        break;
      }

      case "createPoint": {
        world.createPoint({
          position: pointerWorld,
          previousPosition: pointerWorld,
          mass: settingsRef.current.createPointPinned ? Number.POSITIVE_INFINITY : settingsRef.current.createPointMass,
          radius: settingsRef.current.pointRadius,
          pinned: settingsRef.current.createPointPinned,
        });
        break;
      }

      case "createConstraint": {
        const targetPoint = findPointAt(snapshot, pointerWorld, worldHitRadiusForPoint);

        if (!targetPoint) {
          return;
        }

        interactionRef.current.pendingConstraintStartPointId = targetPoint.id;
        pointerRef.current.isLeftDown = true;
        break;
      }
    }
  }, []);

  const handleLeftPointerUp = useCallback(() => {
    const world = worldRef.current;
    const snapshot = snapshotRef.current;
    const pointerWorld = pointerRef.current.world;
    const mode = mouseModeRef.current;

    pointerRef.current.isLeftDown = false;

    if (!world) {
      return;
    }

    if (mode === "drag") {
      cleanupTemporaryInteraction();
      return;
    }

    if (mode !== "createConstraint" || !snapshot || !pointerWorld) {
      interactionRef.current.pendingConstraintStartPointId = null;
      return;
    }

    const startPointId = interactionRef.current.pendingConstraintStartPointId;

    if (startPointId === null) {
      return;
    }

    const targetPoint = findPointAt(snapshot, pointerWorld, POINT_HIT_RADIUS_PIXELS / cameraRef.current.zoom);

    if (targetPoint && targetPoint.id !== startPointId) {
      world.createConstraint({
        pointAId: startPointId,
        pointBId: targetPoint.id,
        stiffness: settingsRef.current.constraintStiffness,
        damping: settingsRef.current.constraintDamping,
        tearThreshold: settingsRef.current.tearThreshold,
        collisionRadius: settingsRef.current.colliderRadius,
      });
    }

    interactionRef.current.pendingConstraintStartPointId = null;
  }, [cleanupTemporaryInteraction]);

  return (
    <div className="app-shell">
      <header className="toolbar">
        <div className="toolbar__group">
          <button className="toolbar__button" onClick={() => setPaused((current) => !current)}>
            {paused ? "Resume" : "Pause"}
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

        <div className="toolbar__stats">
          <StatChip label="Points" value={stats.points.toString()} />
          <StatChip label="Constraints" value={stats.constraints.toString()} />
          <StatChip label="Bodies" value={stats.bodies.toString()} />
          <StatChip label="FPS" value={performanceStats.fps.toFixed(1).padStart(5, "\u00a0")} />
          <StatChip label="Step" value={`${performanceStats.stepMs.toFixed(2)} ms`} />
          <StatChip label="Snapshot" value={`${performanceStats.snapshotMs.toFixed(2)} ms`} />
          <StatChip label="Draw" value={`${performanceStats.drawMs.toFixed(2)} ms`} />
          <StatChip label="Idle" value={`${performanceStats.idleMs.toFixed(2)} ms`} />
        </div>
      </header>

      <section className="controls">
        <NumberControl label="Time scale" min={0.1} max={2} step={0.05} value={settings.timeScale} onChange={(value) => updateSetting("timeScale", value)} />
        <NumberControl label="Gravity" min={0} max={2000} step={25} value={settings.gravity} onChange={(value) => updateSetting("gravity", value)} />
        <NumberControl
          label="Iterations"
          min={1}
          max={16}
          step={1}
          value={settings.iterations}
          onChange={(value) => updateSetting("iterations", Math.round(value))}
        />
        <NumberControl
          label="Stiffness"
          min={0.001}
          max={1}
          step={0.001}
          value={settings.constraintStiffness}
          onChange={(value) => updateSetting("constraintStiffness", value)}
        />
        <NumberControl
          label="Constraint damping"
          min={0}
          max={50}
          step={0.5}
          value={settings.constraintDamping}
          onChange={(value) => updateSetting("constraintDamping", value)}
        />
        <NumberControl
          label="Velocity damping"
          min={0}
          max={10}
          step={0.1}
          value={settings.globalDamping}
          onChange={(value) => updateSetting("globalDamping", value)}
        />
        <NumberControl label="Friction" min={0} max={40} step={0.5} value={settings.friction} onChange={(value) => updateSetting("friction", value)} />
        <NumberControl label="Restitution" min={0} max={1} step={0.02} value={settings.restitution} onChange={(value) => updateSetting("restitution", value)} />
        <NumberControl
          label="Tear threshold"
          min={1.05}
          max={4}
          step={0.05}
          value={settings.tearThreshold}
          onChange={(value) => updateSetting("tearThreshold", value)}
        />
        <NumberControl
          label="World width"
          min={200}
          max={8000}
          step={20}
          value={settings.worldWidth}
          onChange={(value) => updateSetting("worldWidth", value)}
        />
        <NumberControl
          label="World height"
          min={200}
          max={8000}
          step={20}
          value={settings.worldHeight}
          onChange={(value) => updateSetting("worldHeight", value)}
        />
        <NumberControl label="Point radius" min={2} max={20} step={1} value={settings.pointRadius} onChange={(value) => updateSetting("pointRadius", value)} />
        <NumberControl
          label="Capsule radius"
          min={2}
          max={24}
          step={1}
          value={settings.colliderRadius}
          onChange={(value) => updateSetting("colliderRadius", value)}
        />
      </section>

      <section className="workspace">
        <aside className="tools-panel">
          <div className="tools-panel__header">
            <h2 className="tools-panel__title">Mouse Tools</h2>
            <Tooltip
              label="Tool help"
              content="Pull and Push affect nearby points while held. Drag creates a temporary spring-like link from a point to the cursor. Create Constraint starts on one point and finishes on another on mouse release. Delete tools remove what you click."
            />
          </div>

          <div className="mode-grid">
            {MOUSE_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`mode-button${mouseMode === option.value ? " mode-button--active" : ""}`}
                onClick={() => setMouseMode(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="tools-panel__settings">
            {(mouseMode === "pull" || mouseMode === "push") && (
              <>
                <NumberControl
                  label="Mouse radius"
                  min={20}
                  max={320}
                  step={5}
                  value={settings.mouseRadius}
                  onChange={(value) => updateSetting("mouseRadius", value)}
                />
                <NumberControl
                  label="Mouse strength"
                  min={100}
                  max={25000}
                  step={100}
                  value={settings.mouseStrength}
                  onChange={(value) => updateSetting("mouseStrength", value)}
                />
              </>
            )}

            {mouseMode === "drag" && (
              <>
                <NumberControl
                  label="Drag stiffness"
                  min={0.001}
                  max={1}
                  step={0.001}
                  value={settings.dragStiffness}
                  onChange={(value) => updateSetting("dragStiffness", value)}
                />
                <div className="panel-note">Hold on a point to create a temporary spring between that point and the cursor.</div>
              </>
            )}

            {mouseMode === "deletePoint" && <div className="panel-note">Click any point to remove it and its connected constraints.</div>}

            {mouseMode === "deleteConstraint" && <div className="panel-note">Click a visible constraint or capsule edge to remove it.</div>}

            {mouseMode === "createPoint" && (
              <>
                <NumberControl
                  label="Point radius"
                  min={2}
                  max={20}
                  step={1}
                  value={settings.pointRadius}
                  onChange={(value) => updateSetting("pointRadius", value)}
                />
                <NumberControl
                  label="Point mass"
                  min={0.1}
                  max={10}
                  step={0.1}
                  value={settings.createPointMass}
                  onChange={(value) => updateSetting("createPointMass", value)}
                />
                <label className="control control--boolean">
                  <span className="control__label">Pinned point</span>
                  <input
                    className="control__checkbox"
                    type="checkbox"
                    checked={settings.createPointPinned}
                    onChange={(event) => updateSetting("createPointPinned", event.target.checked)}
                  />
                </label>
              </>
            )}

            {mouseMode === "createConstraint" && (
              <>
                <NumberControl
                  label="Constraint stiffness"
                  min={0.001}
                  max={1}
                  step={0.001}
                  value={settings.constraintStiffness}
                  onChange={(value) => updateSetting("constraintStiffness", value)}
                />
                <NumberControl
                  label="Constraint damping"
                  min={0}
                  max={50}
                  step={0.5}
                  value={settings.constraintDamping}
                  onChange={(value) => updateSetting("constraintDamping", value)}
                />
                <NumberControl
                  label="Capsule radius"
                  min={0}
                  max={24}
                  step={1}
                  value={settings.colliderRadius}
                  onChange={(value) => updateSetting("colliderRadius", value)}
                />
                <NumberControl
                  label="Tear threshold"
                  min={1.05}
                  max={4}
                  step={0.05}
                  value={settings.tearThreshold}
                  onChange={(value) => updateSetting("tearThreshold", value)}
                />
                <div className="panel-note">Hold from one point and release over another to create a new constraint.</div>
              </>
            )}
          </div>
        </aside>

        <main className="canvas-shell">
          <canvas
            ref={canvasRef}
            className="playground-canvas"
            onPointerMove={handlePointerMove}
            onPointerDown={(event) => {
              const canvas = canvasRef.current;

              if (!canvas) {
                return;
              }

              canvas.setPointerCapture(event.pointerId);
              handlePointerMove(event);

              if (event.button === 2) {
                pointerRef.current.isRightDown = true;
                return;
              }

              if (event.button === 0) {
                handleLeftPointerDown();
              }
            }}
            onPointerUp={(event) => {
              const canvas = canvasRef.current;

              if (canvas) {
                canvas.releasePointerCapture(event.pointerId);
              }

              if (event.button === 2) {
                pointerRef.current.isRightDown = false;
                return;
              }

              if (event.button === 0) {
                handleLeftPointerUp();
              }
            }}
            onPointerLeave={() => {
              pointerRef.current.isLeftDown = false;
              pointerRef.current.isRightDown = false;
              pointerRef.current.world = null;
              cleanupTemporaryInteraction();
            }}
            onWheel={handleWheel}
            onContextMenu={(event) => event.preventDefault()}
          />
        </main>
      </section>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

function findPointAt(snapshot: WorldSnapshot, worldPosition: { x: number; y: number }, hitRadius: number): PointSnapshot | null {
  let bestPoint: PointSnapshot | null = null;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;

  for (const point of snapshot.points) {
    const dx = point.position.x - worldPosition.x;
    const dy = point.position.y - worldPosition.y;
    const distanceSquared = dx * dx + dy * dy;
    const maxDistance = Math.max(point.radius, hitRadius);

    if (distanceSquared > maxDistance * maxDistance || distanceSquared >= bestDistanceSquared) {
      continue;
    }

    bestPoint = point;
    bestDistanceSquared = distanceSquared;
  }

  return bestPoint;
}

function findConstraintAt(snapshot: WorldSnapshot, worldPosition: { x: number; y: number }, hitRadius: number): ConstraintSnapshot | null {
  const pointsById = new Map(snapshot.points.map((point) => [point.id, point]));
  let bestConstraint: ConstraintSnapshot | null = null;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;

  for (const constraint of snapshot.constraints) {
    const pointA = pointsById.get(constraint.pointAId);
    const pointB = pointsById.get(constraint.pointBId);

    if (!pointA || !pointB) {
      continue;
    }

    const closestPoint = closestPointOnSegment(worldPosition, pointA.position, pointB.position);
    const dx = closestPoint.x - worldPosition.x;
    const dy = closestPoint.y - worldPosition.y;
    const distanceSquared = dx * dx + dy * dy;
    const maxDistance = Math.max(constraint.collisionRadius, hitRadius);

    if (distanceSquared > maxDistance * maxDistance || distanceSquared >= bestDistanceSquared) {
      continue;
    }

    bestConstraint = constraint;
    bestDistanceSquared = distanceSquared;
  }

  return bestConstraint;
}

function getPreviewLine(
  snapshot: WorldSnapshot,
  interaction: InteractionState,
  pointerWorld: { x: number; y: number } | null,
): {
  start: { x: number; y: number };
  end: { x: number; y: number };
  color?: string;
} | null {
  if (!pointerWorld) {
    return null;
  }

  const pointsById = new Map(snapshot.points.map((point) => [point.id, point]));
  const previewPointId = interaction.pendingConstraintStartPointId ?? interaction.dragSourcePointId;

  if (previewPointId === null) {
    return null;
  }

  const startPoint = pointsById.get(previewPointId);

  if (!startPoint) {
    return null;
  }

  return {
    start: { x: startPoint.position.x, y: startPoint.position.y },
    end: pointerWorld,
    color: interaction.pendingConstraintStartPointId !== null ? "#ffd76a" : "#ff9f4d",
  };
}

function closestPointOnSegment(
  point: { x: number; y: number },
  segmentStart: { x: number; y: number },
  segmentEnd: { x: number; y: number },
): { x: number; y: number } {
  const abX = segmentEnd.x - segmentStart.x;
  const abY = segmentEnd.y - segmentStart.y;
  const abLengthSquared = abX * abX + abY * abY;

  if (abLengthSquared <= Number.EPSILON) {
    return segmentStart;
  }

  const apX = point.x - segmentStart.x;
  const apY = point.y - segmentStart.y;
  const t = clamp((apX * abX + apY * abY) / abLengthSquared, 0, 1);

  return {
    x: segmentStart.x + abX * t,
    y: segmentStart.y + abY * t,
  };
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-chip">
      <span className="stat-chip__label">{label}</span>
      <span className="stat-chip__value">{value}</span>
    </div>
  );
}

function createEmptyMetricsWindow(): MetricsWindow {
  return {
    elapsedSeconds: 0,
    frameCount: 0,
    totalStepMs: 0,
    stepCount: 0,
    totalSnapshotMs: 0,
    totalDrawMs: 0,
  };
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
  { value: "pull", label: "Pull" },
  { value: "push", label: "Push" },
  { value: "drag", label: "Drag" },
  { value: "deletePoint", label: "Delete Point" },
  { value: "deleteConstraint", label: "Delete Constraint" },
  { value: "createPoint", label: "Create Point" },
  { value: "createConstraint", label: "Create Constraint" },
];

export default App;
