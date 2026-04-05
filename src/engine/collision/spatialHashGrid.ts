import type { GridCellSnapshot, LayerId } from "../entities/types.ts";

interface EntryBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export class SpatialHashGrid {
  private readonly cells = new Map<string, number[]>()
  private cellSize: number

  constructor(cellSize: number) {
    this.cellSize = cellSize
  }

  setCellSize(cellSize: number): void {
    this.cellSize = Math.max(1, cellSize)
    this.clear()
  }

  clear(): void {
    this.cells.clear()
  }

  insert(id: number, bounds: EntryBounds, layer: LayerId): void {
    const minCellX = Math.floor(bounds.minX / this.cellSize)
    const minCellY = Math.floor(bounds.minY / this.cellSize)
    const maxCellX = Math.floor(bounds.maxX / this.cellSize)
    const maxCellY = Math.floor(bounds.maxY / this.cellSize)

    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        const key = this.getKey(cellX, cellY, layer)
        const bucket = this.cells.get(key)

        if (bucket) {
          bucket.push(id)
        } else {
          this.cells.set(key, [id])
        }
      }
    }
  }

  queryCircle(x: number, y: number, radius: number, layers: readonly LayerId[]): number[] {
    const minCellX = Math.floor((x - radius) / this.cellSize)
    const minCellY = Math.floor((y - radius) / this.cellSize)
    const maxCellX = Math.floor((x + radius) / this.cellSize)
    const maxCellY = Math.floor((y + radius) / this.cellSize)
    return this.queryCells(minCellX, minCellY, maxCellX, maxCellY, layers)
  }

  queryBounds(minX: number, minY: number, maxX: number, maxY: number, layers: readonly LayerId[]): number[] {
    const minCellX = Math.floor(minX / this.cellSize)
    const minCellY = Math.floor(minY / this.cellSize)
    const maxCellX = Math.floor(maxX / this.cellSize)
    const maxCellY = Math.floor(maxY / this.cellSize)
    return this.queryCells(minCellX, minCellY, maxCellX, maxCellY, layers)
  }

  private queryCells(
    minCellX: number,
    minCellY: number,
    maxCellX: number,
    maxCellY: number,
    layers: readonly LayerId[],
  ): number[] {
    const seen = new Set<number>()

    for (const layer of layers) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
          const bucket = this.cells.get(this.getKey(cellX, cellY, layer))

          if (!bucket) {
            continue
          }

          for (const id of bucket) {
            seen.add(id)
          }
        }
      }
    }

    return [...seen]
  }

  getSnapshot(): GridCellSnapshot[] {
    const cells: GridCellSnapshot[] = []

    for (const [key, bucket] of this.cells) {
      const [cellXString, cellYString, layerString] = key.split(',')

      cells.push({
        cellX: Number(cellXString),
        cellY: Number(cellYString),
        size: this.cellSize,
        itemCount: bucket.length,
        layer: Number(layerString),
      })
    }

    return cells
  }

  private getKey(cellX: number, cellY: number, layer: LayerId): string {
    return `${cellX},${cellY},${layer}`
  }
}
