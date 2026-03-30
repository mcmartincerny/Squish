import type { Vec2Like } from '../entities/types.ts'
import { clamp, dot } from './vector.ts'

export interface ClosestPointOnSegmentResult {
  x: number
  y: number
  t: number
}

export function closestPointOnSegment(
  point: Vec2Like,
  segmentStart: Vec2Like,
  segmentEnd: Vec2Like,
): ClosestPointOnSegmentResult {
  const abX = segmentEnd.x - segmentStart.x
  const abY = segmentEnd.y - segmentStart.y
  const apX = point.x - segmentStart.x
  const apY = point.y - segmentStart.y
  const abLengthSquared = abX * abX + abY * abY

  if (abLengthSquared <= Number.EPSILON) {
    return {
      x: segmentStart.x,
      y: segmentStart.y,
      t: 0,
    }
  }

  const t = clamp(dot({ x: apX, y: apY }, { x: abX, y: abY }) / abLengthSquared, 0, 1)

  return {
    x: segmentStart.x + abX * t,
    y: segmentStart.y + abY * t,
    t,
  }
}
