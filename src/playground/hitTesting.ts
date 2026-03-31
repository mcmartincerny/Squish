import type { ConstraintSnapshot, PointSnapshot, WorldSnapshot } from '../engine/index.ts';

export interface PreviewLine {
  start: { x: number; y: number };
  end: { x: number; y: number };
  color?: string;
}

export function findPointAt(
  snapshot: WorldSnapshot,
  worldPosition: { x: number; y: number },
  hitRadius: number,
): PointSnapshot | null {
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

export function findConstraintAt(
  snapshot: WorldSnapshot,
  worldPosition: { x: number; y: number },
  hitRadius: number,
): ConstraintSnapshot | null {
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

export function getPreviewLine(
  snapshot: WorldSnapshot,
  previewPointId: number | null,
  pointerWorld: { x: number; y: number } | null,
  color?: string,
): PreviewLine | null {
  if (previewPointId === null || !pointerWorld) {
    return null;
  }

  const startPoint = snapshot.points.find((point) => point.id === previewPointId);

  if (!startPoint) {
    return null;
  }

  return {
    start: { x: startPoint.position.x, y: startPoint.position.y },
    end: pointerWorld,
    color,
  };
}

export function closestPointOnSegment(
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

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
