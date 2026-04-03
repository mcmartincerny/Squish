import { useCallback, useEffect, useRef, useState } from 'react';
import { createWorld, type PhysicsWorld, type WorldSnapshot } from '../engine/index.ts';
import { SimulationCanvas, type SimulationFrameReport } from './SimulationCanvas.tsx';
import {
  BENCHMARK_FILE_VERSION,
  createBenchmarkFilename,
  createBenchmarkScenarioSignature,
  normalizeBenchmarkLabel,
} from './benchmarkFileFormat.ts';
import { BENCHMARK_SCENARIOS } from './benchmarkScenarios.ts';
import type { BenchmarkResult, BenchmarkRunFile, BenchmarkScenario, BenchmarkScenarioCounts } from './benchmarkTypes.ts';
import { summarizeStepDurations } from './simulationMetrics.ts';
import { fitCameraToWorld } from './render.ts';
import type { CameraState } from './types.ts';

const WARMUP_SECONDS = 1;
const MEASURE_SECONDS = 5;
const COOLDOWN_SECONDS = 1;
const FIXED_DT = 1 / 60;

type RunnerPhase = 'idle' | 'warmup' | 'measure' | 'cooldown' | 'done';

interface RunnerState {
  queue: BenchmarkScenario[];
  queueIndex: number;
  phase: RunnerPhase;
  stepsRemaining: number;
  currentSamples: number[];
  currentDefinition: RunnerScenarioDefinition | null;
  results: BenchmarkResult[];
}

interface BenchmarkRunnerProps {
  onBackToPlayground: () => void;
  onOpenBenchmarkCharts: () => void;
}

interface RunnerScenarioDefinition {
  counts: BenchmarkScenarioCounts;
  signature: string;
}

export function BenchmarkRunner({ onBackToPlayground, onOpenBenchmarkCharts }: BenchmarkRunnerProps) {
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>(BENCHMARK_SCENARIOS.map((scenario) => scenario.id));
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [running, setRunning] = useState(false);
  const [useXPBDSolver, setUseXPBDSolver] = useState(false);
  const [statusText, setStatusText] = useState('Select benchmark scenarios and click Run.');
  const [visibleScenarioId, setVisibleScenarioId] = useState<string | null>(BENCHMARK_SCENARIOS[0]?.id ?? null);
  const [downloadLabel, setDownloadLabel] = useState('');
  const [camera, setCamera] = useState<CameraState>({
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  });

  const worldRef = useRef<PhysicsWorld | null>(null);
  const runnerStateRef = useRef<RunnerState>({
    queue: [],
    queueIndex: 0,
    phase: 'idle',
    stepsRemaining: 0,
    currentSamples: [],
    currentDefinition: null,
    results: [],
  });
  const canvasSizeRef = useRef({ width: 0, height: 0 });
  const pendingFitRef = useRef(false);
  const normalizedDownloadLabel = normalizeBenchmarkLabel(downloadLabel);

  const fitCameraIfPossible = useCallback((scenario: BenchmarkScenario) => {
    if (canvasSizeRef.current.width <= 0 || canvasSizeRef.current.height <= 0) {
      pendingFitRef.current = true;
      return;
    }

    pendingFitRef.current = false;
    setCamera(
      fitCameraToWorld(
        canvasSizeRef.current.width,
        canvasSizeRef.current.height,
        scenario.settings.worldWidth,
        scenario.settings.worldHeight,
      ),
    );
  }, []);

  const createScenarioDefinition = useCallback(
    (scenario: BenchmarkScenario, world: PhysicsWorld): RunnerScenarioDefinition =>
      createScenarioDefinitionFromSnapshot(scenario, world.getSnapshot()),
    [],
  );

  const loadScenarioIntoWorld = useCallback(
    (scenario: BenchmarkScenario, emptyOnly = false): RunnerScenarioDefinition | null => {
      const world = createWorld({
        gravity: { x: 0, y: scenario.settings.gravity },
        size: { x: scenario.settings.worldWidth, y: scenario.settings.worldHeight },
        iterations: scenario.settings.iterations,
        globalDamping: scenario.settings.globalDamping,
        friction: scenario.settings.friction,
        restitution: scenario.settings.restitution,
        defaultPointRadius: scenario.settings.pointRadius,
        defaultColliderRadius: scenario.settings.colliderRadius,
        gridCellSize: Math.max(scenario.settings.colliderRadius * 4, 48),
      });
      let definition: RunnerScenarioDefinition | null = null;

      if (!emptyOnly) {
        scenario.setup(world);
        definition = createScenarioDefinition(scenario, world);
      }

      worldRef.current = world;
      fitCameraIfPossible(scenario);
      return definition;
    },
    [createScenarioDefinition, fitCameraIfPossible],
  );

  useEffect(() => {
    if (running) {
      return;
    }

    const previewScenario =
      BENCHMARK_SCENARIOS.find((scenario) => scenario.id === visibleScenarioId) ?? BENCHMARK_SCENARIOS[0];

    if (!previewScenario) {
      return;
    }

    loadScenarioIntoWorld(previewScenario);
  }, [loadScenarioIntoWorld, running, visibleScenarioId]);

  const startRun = useCallback(() => {
    const queue = BENCHMARK_SCENARIOS.filter((scenario) => selectedScenarioIds.includes(scenario.id));

    if (queue.length === 0) {
      setStatusText('Select at least one benchmark scenario.');
      return;
    }

    const firstDefinition = loadScenarioIntoWorld(queue[0]);

    runnerStateRef.current = {
      queue,
      queueIndex: 0,
      phase: 'warmup',
      stepsRemaining: secondsToSteps(WARMUP_SECONDS),
      currentSamples: [],
      currentDefinition: firstDefinition,
      results: [],
    };

    setResults([]);
    setRunning(true);
    setVisibleScenarioId(queue[0].id);
    setStatusText(`Warmup: ${queue[0].name}`);
  }, [loadScenarioIntoWorld, selectedScenarioIds]);

  const stopRun = useCallback(
    (message: string) => {
      runnerStateRef.current.phase = 'done';
      runnerStateRef.current.stepsRemaining = 0;
      runnerStateRef.current.currentSamples = [];
      runnerStateRef.current.currentDefinition = null;
      setRunning(false);
      setStatusText(message);

      const currentScenario = runnerStateRef.current.queue[runnerStateRef.current.queueIndex];

      if (currentScenario) {
        loadScenarioIntoWorld(currentScenario);
      }
    },
    [loadScenarioIntoWorld],
  );

  const advanceToNextScenario = useCallback(
    (index: number) => {
      const nextScenario = runnerStateRef.current.queue[index];

      if (!nextScenario) {
        stopRun('Benchmark run complete.');
        return;
      }

      runnerStateRef.current.queueIndex = index;
      runnerStateRef.current.phase = 'warmup';
      runnerStateRef.current.stepsRemaining = secondsToSteps(WARMUP_SECONDS);
      runnerStateRef.current.currentSamples = [];
      runnerStateRef.current.currentDefinition = loadScenarioIntoWorld(nextScenario);
      setVisibleScenarioId(nextScenario.id);
      setStatusText(`Warmup: ${nextScenario.name}`);
    },
    [loadScenarioIntoWorld, stopRun],
  );

  const handleFrameRendered = useCallback(
    (report: SimulationFrameReport) => {
      if (!running) {
        return;
      }

      const state = runnerStateRef.current;

      if (state.phase === 'idle' || state.phase === 'done') {
        return;
      }

      const currentScenario = state.queue[state.queueIndex];

      if (!currentScenario) {
        stopRun('Benchmark queue finished.');
        return;
      }

      if (state.phase === 'warmup') {
        state.stepsRemaining -= report.stepDurationsMs.length;

        if (state.stepsRemaining <= 0) {
          state.phase = 'measure';
          state.stepsRemaining = secondsToSteps(MEASURE_SECONDS);
          state.currentSamples = [];
          setStatusText(`Measuring: ${currentScenario.name}`);
        }

        return;
      }

      if (state.phase === 'measure') {
        const sampleCountToTake = Math.min(state.stepsRemaining, report.stepDurationsMs.length);

        for (let index = 0; index < sampleCountToTake; index += 1) {
          state.currentSamples.push(report.stepDurationsMs[index]);
        }

        state.stepsRemaining -= sampleCountToTake;

        if (state.stepsRemaining <= 0) {
          state.phase = 'done';
          state.stepsRemaining = 0;

          const summary = summarizeStepDurations(state.currentSamples);
          const definition =
            state.currentDefinition ?? createScenarioDefinitionFromSnapshot(currentScenario, report.snapshot);
          const nextResult: BenchmarkResult = {
            scenarioId: currentScenario.id,
            scenarioName: currentScenario.name,
            description: currentScenario.description,
            signature: definition.signature,
            signatureVersion: 'world-setup-v1',
            counts: definition.counts,
            averageMs: summary.averageMs,
            p99Ms: summary.p99Ms,
            p95Ms: summary.p95Ms,
            p5Ms: summary.p5Ms,
            p1Ms: summary.p1Ms,
            samples: state.currentSamples.length,
          };

          state.results = [...state.results, nextResult];
          setResults(state.results);

          const nextScenarioIndex = state.queueIndex + 1;
          const nextScenario = state.queue[nextScenarioIndex];

          if (!nextScenario) {
            stopRun('Benchmark run complete.');
            return;
          }

          state.phase = 'cooldown';
          state.stepsRemaining = secondsToSteps(COOLDOWN_SECONDS);
          state.currentDefinition = null;
          setStatusText(`Cooldown before: ${nextScenario.name}`);
          loadScenarioIntoWorld(nextScenario, true);
        }

        return;
      }

      if (state.phase === 'cooldown') {
        state.stepsRemaining -= report.stepDurationsMs.length;

        if (state.stepsRemaining <= 0) {
          advanceToNextScenario(state.queueIndex + 1);
        }
      }
    },
    [advanceToNextScenario, loadScenarioIntoWorld, running, stopRun],
  );

  const handleDownloadResults = useCallback(
    (includeLabel: boolean) => {
      if (results.length === 0) {
        return;
      }

      if (includeLabel && !normalizedDownloadLabel) {
        setStatusText('Enter a custom label before downloading with a label.');
        return;
      }

      const now = new Date();
      const fileName = createBenchmarkFilename(now, includeLabel ? normalizedDownloadLabel : null);
      const payload: BenchmarkRunFile = {
        version: BENCHMARK_FILE_VERSION,
        generatedAt: now.toISOString(),
        label: includeLabel ? normalizedDownloadLabel : null,
        sourceFilename: fileName,
        runConfig: {
          warmupSeconds: WARMUP_SECONDS,
          measureSeconds: MEASURE_SECONDS,
          cooldownSeconds: COOLDOWN_SECONDS,
          fixedDt: FIXED_DT,
        },
        results,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const link = document.createElement('a');

      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(link.href);
      setStatusText(`Downloaded ${fileName}`);
    },
    [normalizedDownloadLabel, results],
  );

  const visibleScenario = BENCHMARK_SCENARIOS.find((scenario) => scenario.id === visibleScenarioId) ?? BENCHMARK_SCENARIOS[0];

  return (
    <div className="runner-shell">
      <header className="runner-toolbar">
        <div className="runner-toolbar__group">
          <button className="toolbar__button" onClick={onBackToPlayground}>
            Back To Playground
          </button>
          <button className="toolbar__button" onClick={onOpenBenchmarkCharts}>
            Open Charts
          </button>
          <button className="toolbar__button toolbar__button--accent" disabled={running} onClick={startRun}>
            Run Selected
          </button>
          <button className="toolbar__button" disabled={results.length === 0} onClick={() => handleDownloadResults(false)}>
            Download Results
          </button>
          <button
            className="toolbar__button"
            disabled={results.length === 0 || normalizedDownloadLabel === null}
            onClick={() => handleDownloadResults(true)}
          >
            Download With Label
          </button>
          <input
            className="toolbar__input"
            placeholder="Optional run label"
            value={downloadLabel}
            onChange={(event) => setDownloadLabel(event.target.value)}
          />
          <label className="control control--boolean">
            <span className="control__label">Use XPBD solver</span>
            <input
              className="control__checkbox"
              type="checkbox"
              checked={useXPBDSolver}
              disabled={running}
              onChange={(event) => setUseXPBDSolver(event.target.checked)}
            />
          </label>
        </div>
        <div className="runner-toolbar__status">
          <strong>{visibleScenario?.name ?? 'No scenario'}</strong>
          <span>{statusText}</span>
        </div>
      </header>

      <section className="runner-body">
        <aside className="runner-sidebar">
          <div className="runner-sidebar__actions">
            <button
              className="toolbar__button"
              disabled={running}
              onClick={() => {
                const nextIds = BENCHMARK_SCENARIOS.map((scenario) => scenario.id);
                setSelectedScenarioIds(nextIds);
                setVisibleScenarioId(nextIds[0] ?? null);
              }}
            >
              Select All
            </button>
            <button
              className="toolbar__button"
              disabled={running}
              onClick={() => {
                setSelectedScenarioIds([]);
                setVisibleScenarioId(BENCHMARK_SCENARIOS[0]?.id ?? null);
              }}
            >
              Clear All
            </button>
          </div>

          <div className="runner-scenarios">
            {BENCHMARK_SCENARIOS.map((scenario) => (
              <label key={scenario.id} className="runner-scenario">
                <input
                  type="checkbox"
                  checked={selectedScenarioIds.includes(scenario.id)}
                  disabled={running}
                  onChange={(event) => {
                    setSelectedScenarioIds((current) => {
                      const nextIds = event.target.checked
                        ? [...new Set([...current, scenario.id])]
                        : current.filter((id) => id !== scenario.id);

                      if (event.target.checked) {
                        setVisibleScenarioId(scenario.id);
                      } else if (visibleScenarioId === scenario.id) {
                        setVisibleScenarioId(nextIds[0] ?? BENCHMARK_SCENARIOS[0]?.id ?? null);
                      }

                      return nextIds;
                    });
                  }}
                />
                <div>
                  <div className="runner-scenario__name">{scenario.name}</div>
                  <div className="runner-scenario__description">{scenario.description}</div>
                </div>
              </label>
            ))}
          </div>
        </aside>

        <div className="runner-main">
          <div className="runner-preview">
            <SimulationCanvas
              worldRef={worldRef}
              camera={camera}
              paused={false}
              useXPBDSolver={useXPBDSolver}
              enablePanZoom={false}
              enablePrimaryInteraction={false}
              onCameraChange={setCamera}
              onFrameRendered={handleFrameRendered}
              onCanvasSizeChange={(size) => {
                canvasSizeRef.current = size;

                if (pendingFitRef.current && visibleScenario) {
                  fitCameraIfPossible(visibleScenario);
                }
              }}
            />
          </div>

          <div className="runner-results">
            <table className="runner-table">
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Points</th>
                  <th>Constraints</th>
                  <th>Avg ms</th>
                  <th>p95 ms</th>
                  <th>p99 ms</th>
                  <th>p5 ms</th>
                  <th>p1 ms</th>
                  <th>Samples</th>
                </tr>
              </thead>
              <tbody>
                {results.length === 0 ? (
                  <tr>
                    <td className="runner-table__empty" colSpan={9}>
                      No benchmark results yet.
                    </td>
                  </tr>
                ) : (
                  results.map((result) => (
                    <tr key={result.scenarioId}>
                      <td>{result.scenarioName}</td>
                      <td>{result.counts.points}</td>
                      <td>{result.counts.constraints}</td>
                      <td>{result.averageMs.toFixed(3)}</td>
                      <td>{result.p95Ms.toFixed(3)}</td>
                      <td>{result.p99Ms.toFixed(3)}</td>
                      <td>{result.p5Ms.toFixed(3)}</td>
                      <td>{result.p1Ms.toFixed(3)}</td>
                      <td>{result.samples}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function secondsToSteps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

function createScenarioDefinitionFromSnapshot(
  scenario: BenchmarkScenario,
  snapshot: WorldSnapshot,
): RunnerScenarioDefinition {
  return {
    counts: {
      points: snapshot.points.length,
      constraints: snapshot.constraints.length,
    },
    signature: createBenchmarkScenarioSignature(scenario, snapshot),
  };
}
