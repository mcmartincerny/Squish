import type { WorldSnapshot } from "../engine/index.ts";
import type { CameraState } from "./types.ts";

export function fitCameraToWorld(viewportWidth: number, viewportHeight: number, worldWidth: number, worldHeight: number): CameraState {
  const padding = 32;
  const safeWidth = Math.max(1, viewportWidth - padding * 2);
  const safeHeight = Math.max(1, viewportHeight - padding * 2);
  const zoom = Math.min(safeWidth / worldWidth, safeHeight / worldHeight);

  return {
    zoom,
    offsetX: (viewportWidth - worldWidth * zoom) / 2,
    offsetY: (viewportHeight - worldHeight * zoom) / 2,
  };
}

export function screenToWorld(camera: CameraState, screenX: number, screenY: number): { x: number; y: number } {
  return {
    x: (screenX - camera.offsetX) / camera.zoom,
    y: (screenY - camera.offsetY) / camera.zoom,
  };
}

export function zoomCameraAtPoint(camera: CameraState, screenX: number, screenY: number, nextZoom: number): CameraState {
  const worldX = (screenX - camera.offsetX) / camera.zoom;
  const worldY = (screenY - camera.offsetY) / camera.zoom;

  return {
    zoom: nextZoom,
    offsetX: screenX - worldX * nextZoom,
    offsetY: screenY - worldY * nextZoom,
  };
}

export function drawWorld(
  context: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  camera: CameraState,
  pointerWorld: { x: number; y: number } | null,
  mouseRadius: number | null,
  previewLine?: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    color?: string;
  } | null,
  previewPoint?: {
    x: number;
    y: number;
    radius: number;
    pinned: boolean;
  } | null,
  gridSpacing?: number | null,
): void {
  const { width, height } = context.canvas;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#0f1118";
  context.fillRect(0, 0, width, height);

  context.save();
  context.translate(camera.offsetX, camera.offsetY);
  context.scale(camera.zoom, camera.zoom);

  context.fillStyle = "#0b0d12";
  context.strokeStyle = "#44506a";
  context.lineWidth = 2 / camera.zoom;
  context.beginPath();
  context.rect(0, 0, snapshot.config.size.x, snapshot.config.size.y);
  context.fill();
  context.stroke();

  if (gridSpacing && gridSpacing > 0) {
    context.strokeStyle = "rgba(180, 180, 180, 0.12)";
    context.lineWidth = 1 / camera.zoom;

    for (let x = gridSpacing; x < snapshot.config.size.x; x += gridSpacing) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, snapshot.config.size.y);
      context.stroke();
    }

    for (let y = gridSpacing; y < snapshot.config.size.y; y += gridSpacing) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(snapshot.config.size.x, y);
      context.stroke();
    }
  }

  context.lineCap = "round";
  context.lineJoin = "round";
  const pointsById = new Map(snapshot.points.map((point) => [point.id, point]));

  for (const cell of snapshot.gridCells) {
    const x = cell.cellX * cell.size;
    const y = cell.cellY * cell.size;
    const alpha = Math.min(0.28, 0.06 + cell.itemCount * 0.03);

    context.fillStyle = `rgba(87, 214, 152, ${alpha * 0.25})`;
    context.strokeStyle = `rgba(87, 214, 152, ${alpha})`;
    context.lineWidth = 1 / camera.zoom;
    context.beginPath();
    context.rect(x, y, cell.size, cell.size);
    context.fill();
    context.stroke();
  }

  for (const constraint of snapshot.constraints) {
    if (constraint.collisionRadius <= 0) {
      continue;
    }

    const pointA = pointsById.get(constraint.pointAId);
    const pointB = pointsById.get(constraint.pointBId);

    if (!pointA || !pointB) {
      continue;
    }

    context.strokeStyle = getCapsuleColor(constraint.layer);
    if (Math.floor(Math.abs(constraint.collisionRadius) * 100) % 10 === 1) {
      context.strokeStyle = "rgba(255, 0, 0, 1)";
    }
    context.lineWidth = constraint.collisionRadius * 2;
    context.beginPath();
    context.moveTo(pointA.position.x, pointA.position.y);
    context.lineTo(pointB.position.x, pointB.position.y);
    context.stroke();
  }

  for (const constraint of snapshot.constraints) {
    const pointA = pointsById.get(constraint.pointAId);
    const pointB = pointsById.get(constraint.pointBId);

    if (!pointA || !pointB) {
      continue;
    }

    context.strokeStyle = getConstraintColor(constraint.stretchRatio);
    context.lineWidth = 2 / camera.zoom;
    context.beginPath();
    context.moveTo(pointA.position.x, pointA.position.y);
    context.lineTo(pointB.position.x, pointB.position.y);
    context.stroke();
  }

  for (const point of snapshot.points) {
    context.fillStyle = point.pinned ? "#ffd76a" : getPointColor(point.layers);
    context.beginPath();
    context.arc(point.position.x, point.position.y, point.radius, 0, Math.PI * 2);
    context.fill();
  }

  if (previewLine) {
    context.strokeStyle = previewLine.color ?? "#ffd76a";
    context.lineWidth = 2 / camera.zoom;
    context.setLineDash([10 / camera.zoom, 7 / camera.zoom]);
    context.beginPath();
    context.moveTo(previewLine.start.x, previewLine.start.y);
    context.lineTo(previewLine.end.x, previewLine.end.y);
    context.stroke();
    context.setLineDash([]);
  }

  if (previewPoint) {
    context.fillStyle = "rgba(0,0,0,0)";
    context.strokeStyle = previewPoint.pinned ? "rgba(255, 215, 106, 1)" : "rgba(255, 255, 255, 1)";
    context.lineWidth = 1 / camera.zoom;
    context.beginPath();
    context.arc(previewPoint.x, previewPoint.y, previewPoint.radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  if (pointerWorld && mouseRadius !== null) {
    context.strokeStyle = "rgba(255, 255, 255, 0.3)";
    context.lineWidth = 1.5 / camera.zoom;
    context.setLineDash([8 / camera.zoom, 8 / camera.zoom]);
    context.beginPath();
    context.arc(pointerWorld.x, pointerWorld.y, mouseRadius, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
  }

  context.restore();
}

function getConstraintColor(stretchRatio: number): string {
  if (stretchRatio <= 0.5) {
    return "#4da2ff";
  }

  if (stretchRatio >= 1.5) {
    return "#ff5f68";
  }

  if (stretchRatio < 1) {
    const t = (stretchRatio - 0.5) / 0.5;
    return mixColor("#4da2ff", "#54e37b", t);
  }

  const t = (stretchRatio - 1) / 0.5;
  return mixColor("#54e37b", "#ff5f68", t);
}

function getPointColor(layers: number[]): string {
  if (layers.some((layer) => layer < 0)) {
    return "#ffffff";
  }

  if (layers.includes(0)) {
    return "#cccccc";
  }

  if (layers.includes(1)) {
    return "#888888";
  }

  if (layers.includes(2)) {
    return "#444444";
  }

  return "#222222";
}

function getCapsuleColor(layer: number): string {
  if (layer < 0) {
    return "rgba(255, 86, 81, 0.38)";
  }

  if (layer === 0) {
    return "rgba(49, 87, 255, 0.38)";
  }

  if (layer === 1) {
    return "rgba(63, 255, 46, 0.38)";
  }

  if (layer === 2) {
    return "rgba(240, 255, 26, 0.38)";
  }

  if (layer === 3) {
    return "rgba(225, 0, 255, 0.38)";
  }

  return "rgba(68, 68, 68, 0.38)";
}

function mixColor(fromHex: string, toHex: string, t: number): string {
  const from = hexToRgb(fromHex);
  const to = hexToRgb(toHex);
  const mix = (fromValue: number, toValue: number) => Math.round(fromValue + (toValue - fromValue) * t);

  return `rgb(${mix(from.r, to.r)}, ${mix(from.g, to.g)}, ${mix(from.b, to.b)})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}
