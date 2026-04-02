import { useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react';
import type { PhysicsWorld, WorldSnapshot } from '../engine/index.ts';
import { drawWorld, screenToWorld, zoomCameraAtPoint } from './render.ts';
import type { PreviewLine } from './hitTesting.ts';
import type { CameraState } from './types.ts';

const FIXED_DELTA_TIME = 1 / 60;

export interface SimulationFrameReport {
  elapsedSeconds: number;
  stepDurationsMs: number[];
  snapshotMs: number;
  drawMs: number;
  snapshot: WorldSnapshot;
}

interface SimulationCanvasProps {
  worldRef: MutableRefObject<PhysicsWorld | null>;
  camera: CameraState;
  paused: boolean;
  className?: string;
  enablePanZoom?: boolean;
  enablePrimaryInteraction?: boolean;
  onCameraChange: (camera: CameraState) => void;
  onPointerWorldChange?: (position: { x: number; y: number } | null) => void;
  onBeforeStep?: (world: PhysicsWorld, deltaTime: number) => void;
  onFrameRendered?: (report: SimulationFrameReport) => void;
  onPrimaryPointerDown?: () => void;
  onPrimaryPointerUp?: () => void;
  onPointerLeave?: () => void;
  onCanvasSizeChange?: (size: { width: number; height: number }) => void;
  getOverlayState?: () => {
    pointerWorld: { x: number; y: number } | null;
    overlayRadius: number | null;
    previewLine: PreviewLine | null;
    previewPoint: { x: number; y: number; radius: number; pinned: boolean } | null;
    gridSpacing: number | null;
  };
}

export function SimulationCanvas({
  worldRef,
  camera,
  paused,
  className = 'playground-canvas',
  enablePanZoom = true,
  enablePrimaryInteraction = true,
  onCameraChange,
  onPointerWorldChange,
  onBeforeStep,
  onFrameRendered,
  onPrimaryPointerDown,
  onPrimaryPointerUp,
  onPointerLeave,
  onCanvasSizeChange,
  getOverlayState,
}: SimulationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRef = useRef(camera);
  const pausedRef = useRef(paused);
  const onCameraChangeRef = useRef(onCameraChange);
  const onPointerWorldChangeRef = useRef(onPointerWorldChange);
  const onBeforeStepRef = useRef(onBeforeStep);
  const onFrameRenderedRef = useRef(onFrameRendered);
  const onPrimaryPointerDownRef = useRef(onPrimaryPointerDown);
  const onPrimaryPointerUpRef = useRef(onPrimaryPointerUp);
  const onPointerLeaveRef = useRef(onPointerLeave);
  const onCanvasSizeChangeRef = useRef(onCanvasSizeChange);
  const getOverlayStateRef = useRef(getOverlayState);
  const pointerStateRef = useRef({
    rightDown: false,
    lastScreenX: 0,
    lastScreenY: 0,
  });
  const accumulatorRef = useRef(0);
  const lastFrameTimeRef = useRef<number | null>(null);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    onCameraChangeRef.current = onCameraChange;
  }, [onCameraChange]);

  useEffect(() => {
    onPointerWorldChangeRef.current = onPointerWorldChange;
  }, [onPointerWorldChange]);

  useEffect(() => {
    onBeforeStepRef.current = onBeforeStep;
  }, [onBeforeStep]);

  useEffect(() => {
    onFrameRenderedRef.current = onFrameRendered;
  }, [onFrameRendered]);

  useEffect(() => {
    onPrimaryPointerDownRef.current = onPrimaryPointerDown;
  }, [onPrimaryPointerDown]);

  useEffect(() => {
    onPrimaryPointerUpRef.current = onPrimaryPointerUp;
  }, [onPrimaryPointerUp]);

  useEffect(() => {
    onPointerLeaveRef.current = onPointerLeave;
  }, [onPointerLeave]);

  useEffect(() => {
    onCanvasSizeChangeRef.current = onCanvasSizeChange;
  }, [onCanvasSizeChange]);

  useEffect(() => {
    getOverlayStateRef.current = getOverlayState;
  }, [getOverlayState]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');

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

      const elapsedSeconds =
        lastFrameTimeRef.current === null ? FIXED_DELTA_TIME : Math.min((time - lastFrameTimeRef.current) / 1000, 1 / 20);
      lastFrameTimeRef.current = time;

      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        onCanvasSizeChangeRef.current?.({
          width: canvas.clientWidth,
          height: canvas.clientHeight,
        });
      }

      const stepDurationsMs: number[] = [];

      if (!pausedRef.current) {
        accumulatorRef.current += elapsedSeconds;

        while (accumulatorRef.current >= FIXED_DELTA_TIME) {
          onBeforeStepRef.current?.(currentWorld, FIXED_DELTA_TIME);

          const stepStart = performance.now();
          currentWorld.step(FIXED_DELTA_TIME);
          stepDurationsMs.push(performance.now() - stepStart);
          accumulatorRef.current -= FIXED_DELTA_TIME;
        }
      }

      const snapshotStart = performance.now();
      const snapshot = currentWorld.getSnapshot();
      const snapshotMs = performance.now() - snapshotStart;
      const drawStart = performance.now();
      const overlayState = getOverlayStateRef.current?.() ?? {
        pointerWorld: null,
        overlayRadius: null,
        previewLine: null,
        previewPoint: null,
        gridSpacing: null,
      };
      drawWorld(
        context,
        snapshot,
        cameraRef.current,
        overlayState.pointerWorld,
        overlayState.overlayRadius,
        overlayState.previewLine,
        overlayState.previewPoint,
        overlayState.gridSpacing,
      );
      const drawMs = performance.now() - drawStart;

      onFrameRenderedRef.current?.({
        elapsedSeconds,
        stepDurationsMs,
        snapshotMs,
        drawMs,
        snapshot,
      });

      animationFrameId = window.requestAnimationFrame(renderFrame);
    };

    animationFrameId = window.requestAnimationFrame(renderFrame);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      lastFrameTimeRef.current = null;
      accumulatorRef.current = 0;
    };
  }, [worldRef]);

  const updatePointerWorld = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    const worldPosition = screenToWorld(cameraRef.current, screenX, screenY);

    onPointerWorldChangeRef.current?.(worldPosition);

    if (pointerStateRef.current.rightDown && enablePanZoom) {
      const deltaX = screenX - pointerStateRef.current.lastScreenX;
      const deltaY = screenY - pointerStateRef.current.lastScreenY;

      onCameraChangeRef.current({
        ...cameraRef.current,
        offsetX: cameraRef.current.offsetX + deltaX,
        offsetY: cameraRef.current.offsetY + deltaY,
      });
    }

    pointerStateRef.current.lastScreenX = screenX;
    pointerStateRef.current.lastScreenY = screenY;
  };

  return (
    <canvas
      ref={canvasRef}
      className={className}
      onPointerMove={updatePointerWorld}
      onPointerDown={(event) => {
        const canvas = canvasRef.current;

        if (!canvas) {
          return;
        }

        canvas.setPointerCapture(event.pointerId);
        updatePointerWorld(event);

        if (event.button === 2 && enablePanZoom) {
          pointerStateRef.current.rightDown = true;
          return;
        }

        if (event.button === 0 && enablePrimaryInteraction) {
          onPrimaryPointerDownRef.current?.();
        }
      }}
      onPointerUp={(event) => {
        const canvas = canvasRef.current;

        if (canvas) {
          canvas.releasePointerCapture(event.pointerId);
        }

        if (event.button === 2) {
          pointerStateRef.current.rightDown = false;
          return;
        }

        if (event.button === 0 && enablePrimaryInteraction) {
          onPrimaryPointerUpRef.current?.();
        }
      }}
      onPointerLeave={() => {
        pointerStateRef.current.rightDown = false;
        onPointerWorldChangeRef.current?.(null);
        onPointerLeaveRef.current?.();
      }}
      onWheel={(event) => {
        if (!enablePanZoom) {
          return;
        }

        event.preventDefault();

        const canvas = canvasRef.current;

        if (!canvas) {
          return;
        }

        const rect = canvas.getBoundingClientRect();
        const screenX = event.clientX - rect.left;
        const screenY = event.clientY - rect.top;
        const nextZoom = clamp(cameraRef.current.zoom * Math.exp(-event.deltaY * 0.001), 0.1, 8);

        onCameraChangeRef.current(zoomCameraAtPoint(cameraRef.current, screenX, screenY, nextZoom));
      }}
      onContextMenu={(event) => event.preventDefault()}
    />
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
