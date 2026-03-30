import type { Vec2, Vec2Like } from '../entities/types.ts'

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y }
}

export function cloneVec2(value: Vec2Like): Vec2 {
  return { x: value.x, y: value.y }
}

export function add(a: Vec2Like, b: Vec2Like): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function subtract(a: Vec2Like, b: Vec2Like): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function scale(value: Vec2Like, factor: number): Vec2 {
  return { x: value.x * factor, y: value.y * factor }
}

export function dot(a: Vec2Like, b: Vec2Like): number {
  return a.x * b.x + a.y * b.y
}

export function lengthSquared(value: Vec2Like): number {
  return dot(value, value)
}

export function length(value: Vec2Like): number {
  return Math.sqrt(lengthSquared(value))
}

export function distance(a: Vec2Like, b: Vec2Like): number {
  return length(subtract(a, b))
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
