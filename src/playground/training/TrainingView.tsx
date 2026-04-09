import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CharacterConstantsOverride, CharacterController } from "../../engine/behaviors/index.ts";
import type { PhysicsWorld } from "../../engine/index.ts";
import { NumberControl } from "../NumberControl.tsx";
import { SimulationCanvas } from "../SimulationCanvas.tsx";
import { createCameraForTrainingWorld, createInitialPopulation, createNextPopulation, createTrainingWorldRuntime, isTrainingEvaluationComplete, scoreTrainingCandidate, summarizeTrainingGeneration } from "./trainingSession.ts";
import { TrainingChart } from "./trainingChart.tsx";
import { getTrainingRewardDefinitionById, TRAINING_REWARD_DEFINITIONS } from "./trainingReward.ts";
import { getTrainingScenarioById, TRAINING_SCENARIOS } from "./trainingScenarios.ts";
import { getTrainingStrategyById, TRAINING_STRATEGIES } from "./trainingStrategies.ts";
import { CHARACTER_CONSTANT_SPECS, type ScoredTrainingCandidate, type TrainingCandidate, type TrainingGenerationSummary } from "./trainingTypes.ts";

interface TrainingViewProps {
  onBackToPlayground: () => void;
}

export function TrainingView({ onBackToPlayground }: TrainingViewProps) {
  const [strategyId, setStrategyId] = useState(TRAINING_STRATEGIES[0]?.id ?? "");
  const [scenarioId, setScenarioId] = useState(TRAINING_SCENARIOS[0]?.id ?? "");
  const [rewardId, setRewardId] = useState(TRAINING_REWARD_DEFINITIONS[0]?.id ?? "");
  const [populationSize, setPopulationSize] = useState(10);
  const [eliteCount, setEliteCount] = useState(2);
  const [evaluationUpdates, setEvaluationUpdates] = useState(1700);
  const [mutationStrength, setMutationStrength] = useState(0.12);
  const [distanceWeight, setDistanceWeight] = useState(1);
  const [xOscillationPenalty, setXOscillationPenalty] = useState(0.02);
  const [yOscillationPenalty, setYOscillationPenalty] = useState(0.05);
  const [ultraSpeed, setUltraSpeed] = useState(true);
  const [running, setRunning] = useState(false);
  const [camera, setCamera] = useState({ zoom: 1, offsetX: 0, offsetY: 0 });
  const [statusText, setStatusText] = useState("Configure training and click Start.");
  const [generation, setGeneration] = useState(0);
  const [candidateProgress, setCandidateProgress] = useState({ current: 0, total: 0 });
  const [currentResults, setCurrentResults] = useState<ScoredTrainingCandidate[]>([]);
  const [history, setHistory] = useState<TrainingGenerationSummary[]>([]);
  const [bestOverall, setBestOverall] = useState<ScoredTrainingCandidate | null>(null);

  const worldRef = useRef<PhysicsWorld | null>(null);
  const currentControllerRef = useRef<CharacterController | null>(null);
  const currentPopulationRef = useRef<TrainingCandidate[]>([]);
  const currentResultsRef = useRef<ScoredTrainingCandidate[]>([]);
  const currentGenerationRef = useRef(0);
  const currentCandidateIndexRef = useRef(0);
  const bestOverallRef = useRef<ScoredTrainingCandidate | null>(null);
  const canvasSizeRef = useRef({ width: 0, height: 0 });
  const pendingFitRef = useRef(false);

  const selectedStrategy = useMemo(() => getTrainingStrategyById(strategyId), [strategyId]);
  const selectedScenario = useMemo(() => getTrainingScenarioById(scenarioId), [scenarioId]);
  const selectedReward = useMemo(() => getTrainingRewardDefinitionById(rewardId), [rewardId]);
  const rewardWeights = useMemo(
    () => ({
      distanceWeight,
      xOscillationPenalty,
      yOscillationPenalty,
    }),
    [distanceWeight, xOscillationPenalty, yOscillationPenalty],
  );
  const resolvedEliteCount = Math.max(1, Math.min(eliteCount, populationSize));
  const sortedCurrentResults = useMemo(
    () => [...currentResults].sort((left, right) => right.reward - left.reward),
    [currentResults],
  );
  const currentBestReward = sortedCurrentResults[0]?.reward ?? 0;
  const currentAverageReward =
    currentResults.length === 0 ? 0 : currentResults.reduce((sum, result) => sum + result.reward, 0) / currentResults.length;

  const fitCameraIfPossible = useCallback(() => {
    if (canvasSizeRef.current.width <= 0 || canvasSizeRef.current.height <= 0) {
      pendingFitRef.current = true;
      return;
    }

    pendingFitRef.current = false;
    setCamera(createCameraForTrainingWorld(canvasSizeRef.current, selectedScenario));
  }, [selectedScenario]);

  const loadCandidate = useCallback(
    (candidate: TrainingCandidate, index: number, generationNumber: number) => {
      const runtime = createTrainingWorldRuntime(selectedScenario, candidate);
      worldRef.current = runtime.world;
      currentControllerRef.current = runtime.controller;
      currentCandidateIndexRef.current = index;
      setGeneration(generationNumber);
      setCandidateProgress({
        current: index + 1,
        total: currentPopulationRef.current.length,
      });
      setStatusText(`Generation ${generationNumber}: evaluating candidate ${index + 1}/${currentPopulationRef.current.length}`);
      fitCameraIfPossible();
    },
    [fitCameraIfPossible, selectedScenario],
  );

  const loadPreviewWorld = useCallback(() => {
    const previewConstants = Object.fromEntries(
      CHARACTER_CONSTANT_SPECS.map((spec) => [spec.key, spec.defaultValue]),
    ) as CharacterConstantsOverride;
    loadCandidate(
      {
        id: "preview",
        generation: 0,
        constants: previewConstants,
        parentId: null,
        strategyId: selectedStrategy.id,
      },
      0,
      0,
    );
    setCandidateProgress({ current: 0, total: 0 });
    setStatusText("Previewing the selected training scenario.");
  }, [loadCandidate, selectedStrategy.id]);

  const resetTraining = useCallback(() => {
    setRunning(false);
    setGeneration(0);
    setCandidateProgress({ current: 0, total: 0 });
    setCurrentResults([]);
    setHistory([]);
    setBestOverall(null);
    currentGenerationRef.current = 0;
    currentCandidateIndexRef.current = 0;
    currentPopulationRef.current = [];
    currentResultsRef.current = [];
    bestOverallRef.current = null;
    loadPreviewWorld();
  }, [loadPreviewWorld]);

  const startNewRun = useCallback(() => {
    const population = createInitialPopulation(selectedStrategy, {
      generation: 1,
      populationSize,
      eliteCount: resolvedEliteCount,
      mutationStrength,
      specs: CHARACTER_CONSTANT_SPECS,
    });

    currentPopulationRef.current = population;
    currentResultsRef.current = [];
    currentGenerationRef.current = 1;
    currentCandidateIndexRef.current = 0;
    bestOverallRef.current = null;
    setCurrentResults([]);
    setHistory([]);
    setBestOverall(null);
    setRunning(true);
    loadCandidate(population[0], 0, 1);
  }, [loadCandidate, mutationStrength, populationSize, resolvedEliteCount, selectedStrategy]);

  const pauseRun = useCallback(() => {
    setRunning(false);
    setStatusText("Training paused.");
  }, []);

  const resumeRun = useCallback(() => {
    if (!currentControllerRef.current) {
      startNewRun();
      return;
    }

    setRunning(true);
    setStatusText(
      `Generation ${currentGenerationRef.current}: evaluating candidate ${currentCandidateIndexRef.current + 1}/${currentPopulationRef.current.length}`,
    );
  }, [startNewRun]);

  useEffect(() => {
    setDistanceWeight(selectedReward.defaultWeights.distanceWeight);
    setXOscillationPenalty(selectedReward.defaultWeights.xOscillationPenalty);
    setYOscillationPenalty(selectedReward.defaultWeights.yOscillationPenalty);
  }, [selectedReward]);

  useEffect(() => {
    if (running) {
      return;
    }

    if (currentPopulationRef.current.length > 0) {
      return;
    }

    loadPreviewWorld();
  }, [loadPreviewWorld, running]);

  const handleFrameRendered = useCallback(() => {
    if (!running) {
      return;
    }

    const controller = currentControllerRef.current;

    if (!controller || !isTrainingEvaluationComplete(controller.updateNumber, evaluationUpdates)) {
      return;
    }

    const population = currentPopulationRef.current;
    const currentCandidate = population[currentCandidateIndexRef.current];

    if (!currentCandidate) {
      return;
    }

    const runtime = {
      world: worldRef.current!,
      controller,
      settings: selectedScenario.settings,
    };
    const scored = scoreTrainingCandidate(currentCandidate, runtime, selectedReward, rewardWeights);
    const nextResults = [...currentResultsRef.current, scored];
    currentResultsRef.current = nextResults;
    setCurrentResults(nextResults);

    if (!bestOverallRef.current || scored.reward > bestOverallRef.current.reward) {
      bestOverallRef.current = scored;
      setBestOverall(scored);
    }

    const nextCandidateIndex = currentCandidateIndexRef.current + 1;

    if (nextCandidateIndex < population.length) {
      loadCandidate(population[nextCandidateIndex], nextCandidateIndex, currentGenerationRef.current);
      return;
    }

    const summary = summarizeTrainingGeneration(currentGenerationRef.current, nextResults);
    setHistory((currentHistory) => [...currentHistory, summary]);

    const nextGeneration = currentGenerationRef.current + 1;
    const nextPopulation = createNextPopulation(selectedStrategy, {
      generation: nextGeneration,
      populationSize,
      eliteCount: resolvedEliteCount,
      mutationStrength,
      previousResults: nextResults,
      specs: CHARACTER_CONSTANT_SPECS,
    });

    currentGenerationRef.current = nextGeneration;
    currentPopulationRef.current = nextPopulation;
    currentResultsRef.current = [];
    setCurrentResults([]);
    loadCandidate(nextPopulation[0], 0, nextGeneration);
  }, [
    loadCandidate,
    mutationStrength,
    populationSize,
    evaluationUpdates,
    resolvedEliteCount,
    rewardWeights,
    running,
    selectedReward,
    selectedScenario.settings,
    selectedStrategy,
  ]);

  return (
    <div className="runner-shell">
      <header className="runner-toolbar">
        <div className="runner-toolbar__group">
          <button className="toolbar__button" onClick={onBackToPlayground}>
            Back To Playground
          </button>
          <button className="toolbar__button toolbar__button--accent" disabled={running} onClick={startNewRun}>
            Start
          </button>
          <button className="toolbar__button" disabled={!running} onClick={pauseRun}>
            Pause
          </button>
          <button className="toolbar__button" disabled={running || !currentControllerRef.current} onClick={resumeRun}>
            Resume
          </button>
          <button className="toolbar__button" onClick={resetTraining}>
            Reset
          </button>
          <label className="control control--boolean">
            <span className="control__label">Ultra speed</span>
            <input
              className="control__checkbox"
              type="checkbox"
              checked={ultraSpeed}
              onChange={(event) => setUltraSpeed(event.target.checked)}
            />
          </label>
        </div>
        <div className="runner-toolbar__status">
          <strong>{selectedScenario.name}</strong>
          <span>{statusText}</span>
        </div>
      </header>

      <section className="runner-body">
        <aside className="runner-sidebar training-sidebar">
          <div className="training-sidebar__controls">
            <label className="charts-control">
              <span className="control__label">Strategy</span>
              <select className="toolbar__select" value={strategyId} disabled={running} onChange={(event) => setStrategyId(event.target.value)}>
                {TRAINING_STRATEGIES.map((strategy) => (
                  <option key={strategy.id} value={strategy.id}>
                    {strategy.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="charts-control">
              <span className="control__label">Scenario</span>
              <select className="toolbar__select" value={scenarioId} disabled={running} onChange={(event) => setScenarioId(event.target.value)}>
                {TRAINING_SCENARIOS.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="charts-control">
              <span className="control__label">Reward</span>
              <select className="toolbar__select" value={rewardId} disabled={running} onChange={(event) => setRewardId(event.target.value)}>
                {TRAINING_REWARD_DEFINITIONS.map((definition) => (
                  <option key={definition.id} value={definition.id}>
                    {definition.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="controls training-controls">
            <NumberControl label="Population size" min={1} max={50} step={1} value={populationSize} onChange={(value) => setPopulationSize(Math.round(value))} />
            <NumberControl label="Elite count" min={1} max={Math.max(1, populationSize)} step={1} value={resolvedEliteCount} onChange={(value) => setEliteCount(Math.round(value))} />
            <NumberControl label="Evaluation updates" min={60} max={10000} step={10} value={evaluationUpdates} onChange={(value) => setEvaluationUpdates(Math.round(value))} />
            <NumberControl label="Mutation strength" min={0.01} max={1} step={0.01} value={mutationStrength} onChange={setMutationStrength} />
            <NumberControl label="Distance weight" min={0} max={5} step={0.05} value={distanceWeight} onChange={setDistanceWeight} />
            <NumberControl label="X oscillation penalty" min={0} max={2} step={0.01} value={xOscillationPenalty} onChange={setXOscillationPenalty} />
            <NumberControl label="Y oscillation penalty" min={0} max={2} step={0.01} value={yOscillationPenalty} onChange={setYOscillationPenalty} />
          </div>

          <div className="charts-run-card training-summary">
            <div className="charts-run-card__title">Live Summary</div>
            <div className="charts-run-card__meta">Generation {generation} | Candidate {candidateProgress.current}/{candidateProgress.total || populationSize}</div>
            <div className="training-summary__grid">
              <span>Best overall</span>
              <strong>{bestOverall ? bestOverall.reward.toFixed(2) : "n/a"}</strong>
              <span>Best this gen</span>
              <strong>{currentResults.length > 0 ? currentBestReward.toFixed(2) : "n/a"}</strong>
              <span>Average this gen</span>
              <strong>{currentResults.length > 0 ? currentAverageReward.toFixed(2) : "n/a"}</strong>
            </div>
          </div>
        </aside>

        <div className="runner-main training-main">
          <div className="runner-preview">
            <SimulationCanvas
              worldRef={worldRef}
              camera={camera}
              paused={!running}
              enablePanZoom={false}
              enablePrimaryInteraction={false}
              ultraSpeed={ultraSpeed}
              onCameraChange={setCamera}
              onFrameRendered={handleFrameRendered}
              onCanvasSizeChange={(size) => {
                canvasSizeRef.current = size;

                if (pendingFitRef.current) {
                  fitCameraIfPossible();
                }
              }}
            />
          </div>

          <div className="training-results-grid">
            <section className="charts-panel charts-panel--chart">
              <div className="charts-panel__header">
                <div>
                  <h2 className="charts-panel__title">Reward History</h2>
                  <div className="charts-panel__subtitle">Highest and average reward per generation.</div>
                </div>
              </div>
              <TrainingChart history={history} />
            </section>

            <section className="runner-results">
              <table className="runner-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {bestOverall ? (
                    <>
                      <tr>
                        <td>Best reward</td>
                        <td>{bestOverall.reward.toFixed(3)}</td>
                      </tr>
                      {CHARACTER_CONSTANT_SPECS.map((spec) => (
                        <tr key={spec.key}>
                          <td>{spec.label}</td>
                          <td>{bestOverall.constants[spec.key]?.toFixed(3) ?? "n/a"}</td>
                        </tr>
                      ))}
                    </>
                  ) : (
                    <tr>
                      <td className="runner-table__empty" colSpan={2}>
                        No best result yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>

            <section className="runner-results">
              <table className="runner-table">
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Reward</th>
                    <th>{`X after ${evaluationUpdates}`}</th>
                    <th>X oscillation</th>
                    <th>Y oscillation</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCurrentResults.length === 0 ? (
                    <tr>
                      <td className="runner-table__empty" colSpan={5}>
                        No evaluated candidates in the current generation yet.
                      </td>
                    </tr>
                  ) : (
                    sortedCurrentResults.map((result) => (
                      <tr key={result.id}>
                        <td>{result.id}</td>
                        <td>{result.reward.toFixed(3)}</td>
                        <td>{result.metrics.lowerBodyPositionX.toFixed(3)}</td>
                        <td>{result.metrics.lowerBodyXOscillations.toFixed(3)}</td>
                        <td>{result.metrics.lowerBodyYOscillations.toFixed(3)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
