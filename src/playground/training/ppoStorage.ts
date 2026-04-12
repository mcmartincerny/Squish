import * as tf from "@tensorflow/tfjs";
import type { PpoNetworkConfig, PpoTrainingConfig } from "./ppoTypes.ts";
import type { TrainingRewardWeights } from "./trainingTypes.ts";

const NAMED_MODELS_INDEX_KEY = "squish:ppo:named-models";
const NAMED_MODEL_KEY_PREFIX = "squish:ppo:model:";
const AUTOSAVE_KEY_PREFIX = "squish:ppo:autosave:";

export interface SerializedTensorData {
  shape: number[];
  values: number[];
}

export interface StoredPpoCheckpoint {
  name: string;
  savedAt: number;
  observationSize: number;
  actionSize: number;
  networkConfig: PpoNetworkConfig;
  trainingConfig: PpoTrainingConfig;
  rewardWeights: TrainingRewardWeights;
  modelWeights: SerializedTensorData[];
  logStd: number[];
}

export interface StoredPpoModelSummary {
  name: string;
  savedAt: number;
}

export function serializeTensor(tensor: tf.Tensor): SerializedTensorData {
  return {
    shape: [...tensor.shape],
    values: Array.from(tensor.dataSync()),
  };
}

export function deserializeTensor(serialized: SerializedTensorData): tf.Tensor {
  return tf.tensor(serialized.values, serialized.shape);
}

export function listStoredPpoModels(): StoredPpoModelSummary[] {
  const raw = localStorage.getItem(NAMED_MODELS_INDEX_KEY);

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as StoredPpoModelSummary[];
    return [...parsed].sort((left, right) => right.savedAt - left.savedAt);
  } catch {
    return [];
  }
}

export function saveNamedPpoModel(checkpoint: StoredPpoCheckpoint): void {
  const normalizedName = checkpoint.name.trim();

  if (!normalizedName) {
    throw new Error("Model name cannot be empty.");
  }

  const nextCheckpoint = {
    ...checkpoint,
    name: normalizedName,
    savedAt: Date.now(),
  };

  localStorage.setItem(getNamedModelKey(normalizedName), JSON.stringify(nextCheckpoint));

  const summaries = listStoredPpoModels().filter((entry) => entry.name !== normalizedName);
  summaries.unshift({
    name: normalizedName,
    savedAt: nextCheckpoint.savedAt,
  });
  localStorage.setItem(NAMED_MODELS_INDEX_KEY, JSON.stringify(summaries));
}

export function loadNamedPpoModel(name: string): StoredPpoCheckpoint | null {
  return parseStoredPpoCheckpoint(localStorage.getItem(getNamedModelKey(name)));
}

export function savePpoAutosave(scenarioId: string, checkpoint: StoredPpoCheckpoint): void {
  const autosaveCheckpoint = {
    ...checkpoint,
    name: `${scenarioId} autosave`,
    savedAt: Date.now(),
  };
  localStorage.setItem(getAutosaveKey(scenarioId), JSON.stringify(autosaveCheckpoint));
}

export function loadPpoAutosave(scenarioId: string): StoredPpoCheckpoint | null {
  return parseStoredPpoCheckpoint(localStorage.getItem(getAutosaveKey(scenarioId)));
}

function parseStoredPpoCheckpoint(rawValue: string | null): StoredPpoCheckpoint | null {
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as StoredPpoCheckpoint;
  } catch {
    return null;
  }
}

function getNamedModelKey(name: string): string {
  return `${NAMED_MODEL_KEY_PREFIX}${encodeURIComponent(name.trim())}`;
}

function getAutosaveKey(scenarioId: string): string {
  return `${AUTOSAVE_KEY_PREFIX}${scenarioId}`;
}
