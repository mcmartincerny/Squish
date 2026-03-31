import type { LayerId, PointId, PointSnapshot, WorldSnapshot } from "../engine/index.ts";
import type { PlaygroundSettings } from "./types.ts";

export function getCreatePointLayers(settings: PlaygroundSettings): LayerId[] {
  const layers: LayerId[] = [];

  if (settings.createPointLayerNegativeOne) {
    layers.push(-1);
  }

  if (settings.createPointLayerZero) {
    layers.push(0);
  }

  if (settings.createPointLayerOne) {
    layers.push(1);
  }

  return layers;
}

export function getCreateConstraintLayer(settings: PlaygroundSettings): LayerId | undefined {
  return settings.createConstraintLayer === "auto" ? undefined : settings.createConstraintLayer;
}

export function findPointSnapshotById(snapshot: WorldSnapshot, pointId: PointId): PointSnapshot | null {
  return snapshot.points.find((point) => point.id === pointId) ?? null;
}

export function getSharedLayers(layersA: readonly LayerId[], layersB: readonly LayerId[]): LayerId[] {
  const sharedLayers: LayerId[] = [];

  for (const layer of layersA) {
    if (layersB.includes(layer)) {
      sharedLayers.push(layer);
    }
  }

  return sharedLayers;
}

export function canCreateConstraintBetween(
  pointA: PointSnapshot,
  pointB: PointSnapshot,
  requestedLayer?: LayerId,
): boolean {
  if (requestedLayer !== undefined) {
    return pointA.layers.includes(requestedLayer) && pointB.layers.includes(requestedLayer);
  }

  return getSharedLayers(pointA.layers, pointB.layers).length === 1;
}

export function getPreviewConstraintColor(
  snapshot: WorldSnapshot,
  startPointId: PointId | null,
  hoveredPointId: PointId | null,
  requestedLayer?: LayerId,
): string {
  if (startPointId === null || hoveredPointId === null || startPointId === hoveredPointId) {
    return "#666666";
  }

  const startPoint = findPointSnapshotById(snapshot, startPointId);
  const hoveredPoint = findPointSnapshotById(snapshot, hoveredPointId);

  if (!startPoint || !hoveredPoint) {
    return "#666666";
  }

  return canCreateConstraintBetween(startPoint, hoveredPoint, requestedLayer) ? "#44cc6a" : "#ff5f68";
}
