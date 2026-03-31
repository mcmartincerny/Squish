import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BENCHMARK_FILE_VERSION, parseBenchmarkFilenameTimestamp } from './benchmarkFileFormat.ts';
import {
  BENCHMARK_METRICS,
  type BenchmarkMetricKey,
  type BenchmarkResult,
  type BenchmarkScenarioCounts,
  type BenchmarkRunFile,
} from './benchmarkTypes.ts';

const CHART_COLORS = ['#7aa2ff', '#ffb86b', '#7ce38b', '#c792ea', '#ff7a90', '#65d4ff', '#ffd866', '#8be9fd'];
const ALL_SCENARIO_ID = '__all__';

const METRIC_LABELS: Record<BenchmarkMetricKey, string> = {
  averageMs: 'Average ms',
  p99Ms: 'p99 ms',
  p95Ms: 'p95 ms',
  p5Ms: 'p5 ms',
  p1Ms: 'p1 ms',
};

interface BenchmarkChartsViewProps {
  onBackToBenchmarkRunner: () => void;
}

interface LoadedBenchmarkRun {
  id: string;
  importedFileName: string;
  sourceFilename: string;
  generatedAt: string;
  label: string | null;
  sortTimestamp: number;
  displayName: string;
  legendLabel: string;
  results: BenchmarkResult[];
  resultsByScenario: Map<string, BenchmarkResult>;
}

interface ScenarioEntry {
  id: string;
  name: string;
  description: string;
}

interface ScenarioWarning {
  key: string;
  message: string;
}

interface ScenarioMetrics {
  averageMs: number;
  p99Ms: number;
  p95Ms: number;
  p5Ms: number;
  p1Ms: number;
  samples: number;
  counts: BenchmarkScenarioCounts | null;
  countsLabel: string;
  signature: string | null;
}

export function BenchmarkChartsView({ onBackToBenchmarkRunner }: BenchmarkChartsViewProps) {
  const [runs, setRuns] = useState<LoadedBenchmarkRun[]>([]);
  const [metric, setMetric] = useState<BenchmarkMetricKey>('averageMs');
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>([]);
  const [baselineRunId, setBaselineRunId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [comparisonWarningsDismissed, setComparisonWarningsDismissed] = useState(false);

  const realScenarios = useMemo(() => {
    const byId = new Map<string, ScenarioEntry>();

    for (const run of runs) {
      for (const result of run.results) {
        if (!byId.has(result.scenarioId)) {
          byId.set(result.scenarioId, {
            id: result.scenarioId,
            name: result.scenarioName,
            description: result.description,
          });
        }
      }
    }

    return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [runs]);
  const scenarios = useMemo(
    () =>
      runs.length === 0
        ? []
        : [
            {
              id: ALL_SCENARIO_ID,
              name: 'All',
              description: 'Synthetic average across all scenarios available in each loaded run.',
            },
            ...realScenarios,
          ],
    [realScenarios, runs.length],
  );
  const scenariosById = useMemo(() => new Map(scenarios.map((scenario) => [scenario.id, scenario])), [scenarios]);
  const scenarioKey = scenarios.map((scenario) => scenario.id).join('|');

  useEffect(() => {
    if (runs.length === 0) {
      setBaselineRunId(null);
      return;
    }

    setBaselineRunId((current) => (current && runs.some((run) => run.id === current) ? current : runs[0].id));
  }, [runs]);

  useEffect(() => {
    if (scenarios.length === 0) {
      setSelectedScenarioId(null);
      setSelectedScenarioIds([]);
      return;
    }

    setSelectedScenarioId((current) => (current && scenariosById.has(current) ? current : scenarios[0].id));
    setSelectedScenarioIds((current) => {
      const filtered = current.filter((scenarioId) => scenariosById.has(scenarioId));
      return filtered.length > 0 ? filtered : scenarios.map((scenario) => scenario.id);
    });
  }, [scenarioKey, scenarios, scenariosById]);

  const warnings = useMemo(() => {
    const nextWarnings: ScenarioWarning[] = [];

    for (const scenario of realScenarios) {
      const scenarioResults = runs
        .map((run) => ({ run, result: getScenarioMetrics(run, scenario.id) }))
        .filter((entry): entry is { run: LoadedBenchmarkRun; result: ScenarioMetrics } => Boolean(entry.result));

      if (scenarioResults.length < 2) {
        continue;
      }

      const signatureCount = new Set(scenarioResults.map((entry) => entry.result.signature)).size;
      const sampleCount = new Set(scenarioResults.map((entry) => entry.result.samples)).size;
      const worldCount = new Set(
        scenarioResults.map(
          (entry) =>
            `${entry.result.counts?.points}:${entry.result.counts?.constraints}:${entry.result.counts?.bodies}`,
        ),
      ).size;

      if (signatureCount > 1) {
        nextWarnings.push({
          key: `${scenario.id}-signature`,
          message: `${scenario.name}: the setup hash differs across the loaded runs, so this benchmark is not directly comparable.`,
        });
      }

      if (sampleCount > 1) {
        nextWarnings.push({
          key: `${scenario.id}-samples`,
          message: `${scenario.name}: the sample counts differ across runs, so timing variance may not be apples to apples.`,
        });
      }

      if (worldCount > 1) {
        nextWarnings.push({
          key: `${scenario.id}-counts`,
          message: `${scenario.name}: the point, constraint, or body counts differ across runs even though the scenario id matches.`,
        });
      }
    }

    return nextWarnings;
  }, [realScenarios, runs]);

  const warningsSignature = useMemo(() => warnings.map((w) => w.key).join('|'), [warnings]);

  useEffect(() => {
    setComparisonWarningsDismissed(false);
  }, [warningsSignature]);

  const trendData = useMemo(() => {
    if (!selectedScenarioId) {
      return [];
    }

    return runs.flatMap((run) => {
      const result = getScenarioMetrics(run, selectedScenarioId);

      if (!result) {
        return [];
      }

      return [
        {
          runLabel: run.legendLabel,
          runDisplayName: run.displayName,
          metricValue: result[metric],
          samples: result.samples,
          counts: result.countsLabel,
          signature: result.signature,
        },
      ];
    });
  }, [metric, runs, selectedScenarioId]);

  const comparisonScenarioIds = useMemo(
    () => selectedScenarioIds.filter((scenarioId) => scenariosById.has(scenarioId)),
    [scenariosById, selectedScenarioIds],
  );

  const comparisonData = useMemo(() => {
    return comparisonScenarioIds.map((scenarioId) => {
      const scenario = scenariosById.get(scenarioId);
      const row: Record<string, string | number | null> = {
        scenarioId,
        scenarioName: scenario?.name ?? scenarioId,
      };

      for (const run of runs) {
        row[run.id] = getScenarioMetrics(run, scenarioId)?.[metric] ?? null;
      }

      return row;
    });
  }, [comparisonScenarioIds, metric, runs, scenariosById]);

  const baselineRun = runs.find((run) => run.id === baselineRunId) ?? null;

  const summaryRows = useMemo(() => {
    if (!baselineRun) {
      return [];
    }

    return comparisonScenarioIds.map((scenarioId) => {
      const scenario = scenariosById.get(scenarioId);
      const baselineResult = getScenarioMetrics(baselineRun, scenarioId);

      return {
        scenarioId,
        scenarioName: scenario?.name ?? scenarioId,
        baselineValue: baselineResult?.[metric] ?? null,
        values: runs.map((run) => {
          const result = getScenarioMetrics(run, scenarioId);
          const value = result?.[metric] ?? null;
          const delta = baselineResult && value !== null ? value - baselineResult[metric] : null;

          return {
            runId: run.id,
            value,
            delta,
          };
        }),
      };
    });
  }, [baselineRun, comparisonScenarioIds, metric, runs, scenariosById]);

  const selectedScenario = selectedScenarioId ? scenariosById.get(selectedScenarioId) ?? null : null;

  const handleFilesSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];

    if (files.length === 0) {
      return;
    }

    try {
      const loadedRuns = await Promise.all(
        files.map(async (file) => parseBenchmarkUpload(file.name, await file.text())),
      );

      setRuns((current) => mergeRuns(current, loadedRuns));
      setLoadError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load the selected benchmark files.';
      setLoadError(message);
    } finally {
      event.target.value = '';
    }
  }, []);

  return (
    <div className="charts-shell">
      <header className="charts-toolbar">
        <div className="charts-toolbar__group">
          <button className="toolbar__button" onClick={onBackToBenchmarkRunner}>
            Back To Benchmark Runner
          </button>
          <label className="toolbar__button toolbar__button--accent">
            Load Benchmark JSON
            <input className="charts-file-input" type="file" accept="application/json,.json" multiple onChange={handleFilesSelected} />
          </label>
          <button className="toolbar__button" disabled={runs.length === 0} onClick={() => setRuns([])}>
            Clear Loaded Runs
          </button>
        </div>
        <div className="charts-toolbar__stats">
          <div className="stat-chip">
            <span className="stat-chip__label">Runs</span>
            <span className="stat-chip__value">{runs.length}</span>
          </div>
          <div className="stat-chip">
            <span className="stat-chip__label">Scenarios</span>
            <span className="stat-chip__value">{scenarios.length}</span>
          </div>
        </div>
      </header>

      <section className="charts-body">
        <aside className="charts-sidebar">
          <div className="charts-panel">
            <div className="charts-panel__header">
              <h2 className="charts-panel__title">Loaded Runs</h2>
            </div>
            <div className="charts-run-list">
              {runs.length === 0 ? (
                <div className="panel-note">Load one or more benchmark exports to start comparing runs.</div>
              ) : (
                runs.map((run) => (
                  <div key={run.id} className="charts-run-card">
                    <div className="charts-run-card__title">{run.displayName}</div>
                    <div className="charts-run-card__meta">{run.sourceFilename}</div>
                    <div className="charts-run-card__meta">{run.results.length} scenarios</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="charts-panel">
            <div className="charts-panel__header">
              <h2 className="charts-panel__title">Scenario Filter</h2>
              <div className="charts-panel__actions">
                <button className="toolbar__button" onClick={() => setSelectedScenarioIds(scenarios.map((scenario) => scenario.id))}>
                  Select All
                </button>
                <button className="toolbar__button" onClick={() => setSelectedScenarioIds([])}>
                  Clear
                </button>
              </div>
            </div>
            <div className="charts-scenario-list">
              {scenarios.map((scenario) => {
                const isChecked = selectedScenarioIds.includes(scenario.id);
                const isActive = selectedScenarioId === scenario.id;

                return (
                  <label key={scenario.id} className={`charts-scenario-card${isActive ? ' charts-scenario-card--active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(event) => {
                        setSelectedScenarioIds((current) =>
                          event.target.checked
                            ? [...new Set([...current, scenario.id])]
                            : current.filter((id) => id !== scenario.id),
                        );
                      }}
                    />
                    <button className="charts-scenario-card__button" type="button" onClick={() => setSelectedScenarioId(scenario.id)}>
                      <span className="charts-scenario-card__name">{scenario.name}</span>
                      <span className="charts-scenario-card__description">{scenario.description}</span>
                    </button>
                  </label>
                );
              })}
            </div>
          </div>
        </aside>

        <div className="charts-main">
          <div className="charts-panel charts-controls">
            <div className="charts-control">
              <span className="control__label">Trend Scenario</span>
              <select
                className="toolbar__select"
                value={selectedScenarioId ?? ''}
                onChange={(event) => setSelectedScenarioId(event.target.value || null)}
              >
                {scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="charts-control">
              <span className="control__label">Y Metric</span>
              <select className="toolbar__select" value={metric} onChange={(event) => setMetric(event.target.value as BenchmarkMetricKey)}>
                {BENCHMARK_METRICS.map((metricOption) => (
                  <option key={metricOption} value={metricOption}>
                    {METRIC_LABELS[metricOption]}
                  </option>
                ))}
              </select>
            </div>

            <div className="charts-control">
              <span className="control__label">Baseline Run</span>
              <select
                className="toolbar__select"
                value={baselineRunId ?? ''}
                onChange={(event) => setBaselineRunId(event.target.value || null)}
              >
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.displayName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loadError ? <div className="charts-warning charts-warning--danger">{loadError}</div> : null}
          {warnings.length > 0 && !comparisonWarningsDismissed ? (
            <div className="charts-warning charts-warning--danger">
              <div className="charts-warning__header">
                <strong>Comparison warnings</strong>
                <button
                  type="button"
                  className="charts-warning__dismiss"
                  aria-label="Dismiss comparison warnings"
                  onClick={() => setComparisonWarningsDismissed(true)}
                >
                  ×
                </button>
              </div>
              <ul className="charts-warning__list">
                {warnings.map((warning) => (
                  <li key={warning.key}>{warning.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="charts-grid">
            <section className="charts-panel charts-panel--chart">
              <div className="charts-panel__header">
                <h2 className="charts-panel__title">{selectedScenario ? `${selectedScenario.name} Over Time` : 'Scenario Trend'}</h2>
                <span className="charts-panel__subtitle">{METRIC_LABELS[metric]}</span>
              </div>
              {trendData.length === 0 ? (
                <div className="panel-note">No loaded run contains the selected scenario yet.</div>
              ) : (
                <div className="charts-chart">
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={trendData} margin={{ top: 16, right: 20, bottom: 20, left: 0 }}>
                      <CartesianGrid stroke="rgba(145, 163, 196, 0.12)" strokeDasharray="3 3" />
                      <XAxis dataKey="runLabel" tick={{ fill: '#91a3c4', fontSize: 12 }} interval={0} angle={-12} textAnchor="end" height={56} />
                      <YAxis tick={{ fill: '#91a3c4', fontSize: 12 }} width={72} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(value: unknown) => [formatUnknownMetric(value), METRIC_LABELS[metric]]}
                        labelFormatter={(label: unknown, payload) => {
                          const firstPoint = payload[0]?.payload as { runDisplayName?: string } | undefined;
                          return firstPoint?.runDisplayName ?? String(label ?? '');
                        }}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="metricValue"
                        name={METRIC_LABELS[metric]}
                        stroke={CHART_COLORS[0]}
                        strokeWidth={3}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            <section className="charts-panel charts-panel--chart">
              <div className="charts-panel__header">
                <h2 className="charts-panel__title">Multi-Scenario Comparison</h2>
                <span className="charts-panel__subtitle">{comparisonScenarioIds.length} scenarios selected</span>
              </div>
              {comparisonData.length === 0 || runs.length === 0 ? (
                <div className="panel-note">Select scenarios and load benchmark files to compare multiple tests together.</div>
              ) : (
                <div className="charts-chart charts-chart--wide">
                  <ResponsiveContainer width="100%" height={340}>
                    <BarChart data={comparisonData} margin={{ top: 16, right: 20, bottom: 20, left: 0 }}>
                      <CartesianGrid stroke="rgba(145, 163, 196, 0.12)" strokeDasharray="3 3" />
                      <XAxis dataKey="scenarioName" tick={{ fill: '#91a3c4', fontSize: 12 }} interval={0} angle={-12} textAnchor="end" height={72} />
                      <YAxis tick={{ fill: '#91a3c4', fontSize: 12 }} width={72} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(value: unknown) => [formatUnknownMetric(value), METRIC_LABELS[metric]]}
                      />
                      <Legend />
                      {runs.map((run, index) => (
                        <Bar
                          key={run.id}
                          dataKey={run.id}
                          name={run.legendLabel}
                          fill={CHART_COLORS[index % CHART_COLORS.length]}
                          radius={[6, 6, 0, 0]}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>
          </div>

          <section className="charts-panel charts-panel--table">
            <div className="charts-panel__header">
              <h2 className="charts-panel__title">Delta Summary</h2>
              <span className="charts-panel__subtitle">
                {baselineRun ? `Baseline: ${baselineRun.displayName}` : 'Choose a baseline to see deltas'}
              </span>
            </div>
            {summaryRows.length === 0 ? (
              <div className="panel-note">Load benchmark runs and pick a baseline to see per-scenario deltas.</div>
            ) : (
              <div className="charts-table-wrap">
                <table className="runner-table">
                  <thead>
                    <tr>
                      <th>Scenario</th>
                      <th>Baseline</th>
                      {runs.map((run) => (
                        <th key={run.id}>{run.legendLabel}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summaryRows.map((row) => (
                      <tr key={row.scenarioId}>
                        <td>{row.scenarioName}</td>
                        <td>{formatNullableMetric(row.baselineValue)}</td>
                        {row.values.map((value) => (
                          <td key={value.runId}>
                            <div className="charts-delta-cell">
                              <span>{formatNullableMetric(value.value)}</span>
                              <span className={getDeltaClassName(value.delta)}>{formatDelta(value.delta)}</span>
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function mergeRuns(currentRuns: LoadedBenchmarkRun[], nextRuns: LoadedBenchmarkRun[]): LoadedBenchmarkRun[] {
  const merged = new Map<string, LoadedBenchmarkRun>();

  for (const run of [...currentRuns, ...nextRuns]) {
    merged.set(run.id, run);
  }

  return [...merged.values()].sort((left, right) => left.sortTimestamp - right.sortTimestamp);
}

function getScenarioMetrics(run: LoadedBenchmarkRun, scenarioId: string): ScenarioMetrics | null {
  if (scenarioId === ALL_SCENARIO_ID) {
    return createAllScenarioMetrics(run.results);
  }

  const result = run.resultsByScenario.get(scenarioId);
  return result ? createScenarioMetrics(result) : null;
}

function parseBenchmarkUpload(fileName: string, content: string): LoadedBenchmarkRun {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`"${fileName}" is not valid JSON.`);
  }

  if (!isBenchmarkRunFile(parsed)) {
    throw new Error(`"${fileName}" does not match the expected benchmark export format.`);
  }

  if (parsed.version !== BENCHMARK_FILE_VERSION) {
    throw new Error(`"${fileName}" uses benchmark format version ${parsed.version}, but this view expects ${BENCHMARK_FILE_VERSION}.`);
  }

  const timestampFromBody = Date.parse(parsed.generatedAt);
  const timestampFromFile = parseBenchmarkFilenameTimestamp(fileName) ?? parseBenchmarkFilenameTimestamp(parsed.sourceFilename);
  const sortTimestamp = Number.isNaN(timestampFromBody) ? timestampFromFile : timestampFromBody;

  if (sortTimestamp === null || Number.isNaN(sortTimestamp)) {
    throw new Error(`"${fileName}" is missing a valid generated timestamp.`);
  }

  const legendLabel = parsed.label ?? formatShortTimestamp(sortTimestamp);
  const displayName = parsed.label ? `${parsed.label} · ${formatFullTimestamp(sortTimestamp)}` : formatFullTimestamp(sortTimestamp);

  return {
    id: `${fileName}::${parsed.generatedAt}`,
    importedFileName: fileName,
    sourceFilename: parsed.sourceFilename,
    generatedAt: parsed.generatedAt,
    label: parsed.label,
    sortTimestamp,
    displayName,
    legendLabel,
    results: parsed.results,
    resultsByScenario: new Map(parsed.results.map((result) => [result.scenarioId, result])),
  };
}

function isBenchmarkRunFile(value: unknown): value is BenchmarkRunFile {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.version === 'number' &&
    typeof value.generatedAt === 'string' &&
    (value.label === null || typeof value.label === 'string') &&
    typeof value.sourceFilename === 'string' &&
    isBenchmarkRunConfig(value.runConfig) &&
    Array.isArray(value.results) &&
    value.results.every((result) => isBenchmarkResult(result))
  );
}

function isBenchmarkRunConfig(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.warmupSeconds === 'number' &&
    typeof value.measureSeconds === 'number' &&
    typeof value.cooldownSeconds === 'number' &&
    typeof value.fixedDt === 'number'
  );
}

function isBenchmarkResult(value: unknown): value is BenchmarkResult {
  if (!isRecord(value) || !isBenchmarkCounts(value.counts)) {
    return false;
  }

  return (
    typeof value.scenarioId === 'string' &&
    typeof value.scenarioName === 'string' &&
    typeof value.description === 'string' &&
    typeof value.signature === 'string' &&
    value.signatureVersion === 'world-setup-v1' &&
    typeof value.averageMs === 'number' &&
    typeof value.p99Ms === 'number' &&
    typeof value.p95Ms === 'number' &&
    typeof value.p5Ms === 'number' &&
    typeof value.p1Ms === 'number' &&
    typeof value.samples === 'number'
  );
}

function isBenchmarkCounts(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.points === 'number' &&
    typeof value.constraints === 'number' &&
    typeof value.bodies === 'number'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatMetricValue(value: number): string {
  return `${value.toFixed(3)} ms`;
}

function formatNullableMetric(value: number | null): string {
  return value === null ? 'n/a' : formatMetricValue(value);
}

function formatUnknownMetric(value: unknown): string {
  return typeof value === 'number' ? formatMetricValue(value) : 'n/a';
}

function formatDelta(value: number | null): string {
  if (value === null) {
    return 'n/a';
  }

  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(3)} ms`;
}

function getDeltaClassName(value: number | null): string {
  if (value === null || value === 0) {
    return 'charts-delta charts-delta--neutral';
  }

  return value > 0 ? 'charts-delta charts-delta--worse' : 'charts-delta charts-delta--better';
}

function formatShortTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

function formatFullTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);
}

function createAllScenarioMetrics(results: BenchmarkResult[]): ScenarioMetrics | null {
  if (results.length === 0) {
    return null;
  }

  const total = results.reduce(
    (accumulator, result) => ({
      averageMs: accumulator.averageMs + result.averageMs,
      p99Ms: accumulator.p99Ms + result.p99Ms,
      p95Ms: accumulator.p95Ms + result.p95Ms,
      p5Ms: accumulator.p5Ms + result.p5Ms,
      p1Ms: accumulator.p1Ms + result.p1Ms,
      samples: accumulator.samples + result.samples,
    }),
    {
      averageMs: 0,
      p99Ms: 0,
      p95Ms: 0,
      p5Ms: 0,
      p1Ms: 0,
      samples: 0,
    },
  );
  const divisor = results.length;

  return {
    averageMs: total.averageMs / divisor,
    p99Ms: total.p99Ms / divisor,
    p95Ms: total.p95Ms / divisor,
    p5Ms: total.p5Ms / divisor,
    p1Ms: total.p1Ms / divisor,
    samples: total.samples / divisor,
    counts: null,
    countsLabel: `${results.length} scenarios averaged`,
    signature: null,
  };
}

function createScenarioMetrics(result: BenchmarkResult): ScenarioMetrics {
  return {
    averageMs: result.averageMs,
    p99Ms: result.p99Ms,
    p95Ms: result.p95Ms,
    p5Ms: result.p5Ms,
    p1Ms: result.p1Ms,
    samples: result.samples,
    counts: result.counts,
    countsLabel: `${result.counts.points}/${result.counts.constraints}/${result.counts.bodies}`,
    signature: result.signature,
  };
}

const tooltipStyle = {
  backgroundColor: 'rgba(11, 13, 18, 0.96)',
  border: '1px solid rgba(41, 49, 69, 1)',
  borderRadius: '12px',
  color: '#dbe7ff',
};
