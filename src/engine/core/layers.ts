import type { LayerId } from "../entities/types.ts";

const DEFAULT_POINT_LAYER: LayerId = 0;

export function normalizePointLayers(layers?: LayerId[]): LayerId[] {
  if (!layers || layers.length === 0) {
    return [DEFAULT_POINT_LAYER];
  }

  const uniqueLayers = new Set<LayerId>();

  for (const layer of layers) {
    validateLayer(layer);
    uniqueLayers.add(layer);
  }

  return [...uniqueLayers].sort((a, b) => a - b);
}

// Can be unnecessary and expensive, so we should remove it later
export function validateLayer(layer: LayerId): void {
  if (!Number.isInteger(layer)) {
    throw new Error(`Layer must be an integer. Received ${layer}.`);
  }
}

export function getSharedLayers(layersA: readonly LayerId[], layersB: readonly LayerId[]): LayerId[] {
  const sharedLayers: LayerId[] = [];
  let indexA = 0;
  let indexB = 0;

  while (indexA < layersA.length && indexB < layersB.length) {
    const layerA = layersA[indexA];
    const layerB = layersB[indexB];

    if (layerA === layerB) {
      sharedLayers.push(layerA);
      indexA += 1;
      indexB += 1;
      continue;
    }

    if (layerA < layerB) {
      indexA += 1;
      continue;
    }

    indexB += 1;
  }

  return sharedLayers;
}

export function resolveConstraintLayer(
  layersA: readonly LayerId[],
  layersB: readonly LayerId[],
  requestedLayer?: LayerId,
): LayerId {
  const sharedLayers = getSharedLayers(layersA, layersB);

  if (sharedLayers.length === 0) {
    throw new Error("Constraints require two points that share at least one layer.");
  }

  if (requestedLayer !== undefined) {
    validateLayer(requestedLayer);

    if (!layersA.includes(requestedLayer) || !layersB.includes(requestedLayer)) {
      throw new Error(`Constraint layer ${requestedLayer} must exist on both points.`);
    }

    return requestedLayer;
  }

  if (sharedLayers.length > 1) {
    throw new Error("Constraint layer is required when the two points share multiple layers.");
  }

  return sharedLayers[0];
}
