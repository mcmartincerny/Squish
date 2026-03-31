import type { WorldSnapshot } from '../engine/index.ts';
import type { BenchmarkScenario } from './benchmarkTypes.ts';

export const BENCHMARK_FILE_VERSION = 1;

const BENCHMARK_FILENAME_PREFIX = 'Squish_benchmark';
const FILENAME_DATE_PATTERN = /^Squish_benchmark_(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})(?:_(.+))?\.json$/;

export function normalizeBenchmarkLabel(label: string): string | null {
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function createBenchmarkFilename(date = new Date(), label?: string | null): string {
  const parts = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ];
  const normalizedLabel = sanitizeBenchmarkLabel(label);

  return normalizedLabel
    ? `${BENCHMARK_FILENAME_PREFIX}_${parts.join('_')}_${normalizedLabel}.json`
    : `${BENCHMARK_FILENAME_PREFIX}_${parts.join('_')}.json`;
}

export function parseBenchmarkFilenameTimestamp(fileName: string): number | null {
  const match = FILENAME_DATE_PATTERN.exec(fileName);

  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match;
  const timestamp = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  ).getTime();

  return Number.isNaN(timestamp) ? null : timestamp;
}

export function createBenchmarkScenarioSignature(scenario: BenchmarkScenario, snapshot: WorldSnapshot): string {
  const payload = stableStringify({
    scenarioId: scenario.id,
    settings: scenario.settings,
    snapshot,
  });

  return `world-setup-v1-${hashString(payload)}`;
}

function sanitizeBenchmarkLabel(label?: string | null): string | null {
  const normalizedLabel = normalizeBenchmarkLabel(label ?? '');

  if (!normalizedLabel) {
    return null;
  }

  const sanitized = normalizedLabel
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');

  return sanitized.length > 0 ? sanitized : null;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }

  if (value && typeof value === 'object') {
    const sortedEntries = Object.entries(value as Record<string, unknown>)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, entryValue]) => [key, sortValue(entryValue)]);

    return Object.fromEntries(sortedEntries);
  }

  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      return 'NaN';
    }

    if (!Number.isFinite(value)) {
      return value > 0 ? 'Infinity' : '-Infinity';
    }
  }

  return value;
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
