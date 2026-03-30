interface EntryBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

interface GridCellSnapshot {
  cellX: number
  cellY: number
  size: number
  itemCount: number
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

  insert(id: number, bounds: EntryBounds): void {
    const minCellX = Math.floor(bounds.minX / this.cellSize)
    const minCellY = Math.floor(bounds.minY / this.cellSize)
    const maxCellX = Math.floor(bounds.maxX / this.cellSize)
    const maxCellY = Math.floor(bounds.maxY / this.cellSize)

    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        const key = `${cellX},${cellY}`
        const bucket = this.cells.get(key)

        if (bucket) {
          bucket.push(id)
        } else {
          this.cells.set(key, [id])
        }
      }
    }
  }

  queryCircle(x: number, y: number, radius: number): number[] {
    const minCellX = Math.floor((x - radius) / this.cellSize)
    const minCellY = Math.floor((y - radius) / this.cellSize)
    const maxCellX = Math.floor((x + radius) / this.cellSize)
    const maxCellY = Math.floor((y + radius) / this.cellSize)
    const seen = new Set<number>()

    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        const bucket = this.cells.get(`${cellX},${cellY}`)

        if (!bucket) {
          continue
        }

        for (const id of bucket) {
          seen.add(id)
        }
      }
    }

    return [...seen]
  }

  getSnapshot(): GridCellSnapshot[] {
    const cells: GridCellSnapshot[] = []

    for (const [key, bucket] of this.cells) {
      const [cellXString, cellYString] = key.split(',')

      cells.push({
        cellX: Number(cellXString),
        cellY: Number(cellYString),
        size: this.cellSize,
        itemCount: bucket.length,
      })
    }

    return cells
  }
}
