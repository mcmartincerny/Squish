import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CharacterController } from "../../engine/behaviors/index.ts";
import type { PhysicsWorld } from "../../engine/index.ts";
import { NumberControl } from "../NumberControl.tsx";
import { SimulationCanvas } from "../SimulationCanvas.tsx";
import { loadNamedPpoModel, loadPpoAutosave, saveNamedPpoModel, savePpoAutosave, listStoredPpoModels, type StoredPpoCheckpoint, type StoredPpoModelSummary } from "./ppoStorage.ts";
import { PpoTrainer, type TrainerSnapshot } from "./ppoTrainer.ts";
import { LEARNED_ACTION_SIZE, decodeLearnedAction } from "./trainingActions.ts";
import { TrainingChart } from "./trainingChart.tsx";
import { buildTrainingObservation, OBSERVATION_SIZE } from "./trainingObservations.ts";
import type { PpoActivation, PolicyDecision, PpoEpisodeSummary } from "./ppoTypes.ts";
import { getTrainingRewardDefinitionById, evaluateTrainingStepReward, readTrainingMetrics, TRAINING_REWARD_DEFINITIONS } from "./trainingReward.ts";
import { getTrainingScenarioById, TRAINING_SCENARIOS } from "./trainingScenarios.ts";
import { createCameraForTrainingWorld, createTrainingWorldRuntime } from "./trainingSession.ts";
import type { TrainingEpisodeHistoryEntry, TrainingRewardWeights, TrainingUpdateHistoryEntry } from "./trainingTypes.ts";

interface TrainingViewProps {
  onBackToPlayground: () => void;
}

export function TrainingView({ onBackToPlayground }: TrainingViewProps) {
  const [scenarioId, setScenarioId] = useState(TRAINING_SCENARIOS[0]?.id ?? "");
  const [rewardId, setRewardId] = useState(TRAINING_REWARD_DEFINITIONS[0]?.id ?? "");
  const [distanceWeight, setDistanceWeight] = useState(1);
  const [xOscillationPenalty, setXOscillationPenalty] = useState(0.05);
  const [yOscillationPenalty, setYOscillationPenalty] = useState(0.15);
  const [uprightWeight, setUprightWeight] = useState(0.25);
  const [heightPenalty, setHeightPenalty] = useState(1);
  const [actionChangePenalty, setActionChangePenalty] = useState(0.04);
  const [learningRate, setLearningRate] = useState(0.0003);
  const [rolloutHorizon, setRolloutHorizon] = useState(1024);
  const [ppoEpochs, setPpoEpochs] = useState(4);
  const [minibatchSize, setMinibatchSize] = useState(128);
  const [clipEpsilon, setClipEpsilon] = useState(0.2);
  const [gamma, setGamma] = useState(0.99);
  const [gaeLambda, setGaeLambda] = useState(0.95);
  const [entropyCoefficient, setEntropyCoefficient] = useState(0.001);
  const [valueLossCoefficient, setValueLossCoefficient] = useState(0.5);
  const [maxGradNorm, setMaxGradNorm] = useState(0.5);
  const [maxEpisodeSteps, setMaxEpisodeSteps] = useState(1800);
  const [hiddenLayerCount, setHiddenLayerCount] = useState(2);
  const [hiddenLayerWidth, setHiddenLayerWidth] = useState(64);
  const [activation, setActivation] = useState<PpoActivation>("tanh");
  const [initialActionStd, setInitialActionStd] = useState(0.35);
  const [modelName, setModelName] = useState("walker");
  const [selectedStoredModelName, setSelectedStoredModelName] = useState("");
  const [storedModels, setStoredModels] = useState<StoredPpoModelSummary[]>([]);
  const [ultraSpeed, setUltraSpeed] = useState(true);
  const [running, setRunning] = useState(false);
  const [camera, setCamera] = useState({ zoom: 1, offsetX: 0, offsetY: 0 });
  const [statusText, setStatusText] = useState("Configure PPO training and click Start.");
  const [trainerSnapshot, setTrainerSnapshot] = useState<TrainerSnapshot | null>(null);
  const [episodeHistory, setEpisodeHistory] = useState<TrainingEpisodeHistoryEntry[]>([]);
  const [updateHistory, setUpdateHistory] = useState<TrainingUpdateHistoryEntry[]>([]);
  const [currentMetrics, setCurrentMetrics] = useState(() => ({
    lowerBodyPositionX: 0,
    lowerBodyXOscillations: 0,
    lowerBodyYOscillations: 0,
  }));

  const worldRef = useRef<PhysicsWorld | null>(null);
  const currentControllerRef = useRef<CharacterController | null>(null);
  const trainerRef = useRef<PpoTrainer | null>(null);
  const previousObservationRef = useRef<number[] | null>(null);
  const previousDecisionRef = useRef<PolicyDecision | null>(null);
  const previousActionRef = useRef<number[] | null>(null);
  const canvasSizeRef = useRef({ width: 0, height: 0 });
  const pendingFitRef = useRef(false);

  const selectedScenario = useMemo(() => getTrainingScenarioById(scenarioId), [scenarioId]);
  const selectedReward = useMemo(() => getTrainingRewardDefinitionById(rewardId), [rewardId]);
  const rewardWeights = useMemo<TrainingRewardWeights>(
    () => ({
      distanceWeight,
      xOscillationPenalty,
      yOscillationPenalty,
      uprightWeight,
      heightPenalty,
      actionChangePenalty,
    }),
    [actionChangePenalty, distanceWeight, heightPenalty, uprightWeight, xOscillationPenalty, yOscillationPenalty],
  );
  const movingAverageReward = useMemo(() => {
    const recent = episodeHistory.slice(-10);
    if (recent.length === 0) {
      return 0;
    }
    return recent.reduce((sum, entry) => sum + entry.totalReward, 0) / recent.length;
  }, [episodeHistory]);
  const currentTrainingConfig = useMemo(
    () => ({
      learningRate,
      rolloutHorizon,
      ppoEpochs,
      minibatchSize,
      clipEpsilon,
      gamma,
      gaeLambda,
      entropyCoefficient,
      valueLossCoefficient,
      maxGradNorm,
      maxEpisodeSteps,
    }),
    [
      clipEpsilon,
      entropyCoefficient,
      gaeLambda,
      gamma,
      learningRate,
      maxEpisodeSteps,
      maxGradNorm,
      minibatchSize,
      ppoEpochs,
      rolloutHorizon,
      valueLossCoefficient,
    ],
  );
  const currentNetworkConfig = useMemo(
    () => ({
      hiddenLayerCount,
      hiddenLayerWidth,
      activation,
      initialActionStd,
    }),
    [activation, hiddenLayerCount, hiddenLayerWidth, initialActionStd],
  );

  const fitCameraIfPossible = useCallback(() => {
    if (canvasSizeRef.current.width <= 0 || canvasSizeRef.current.height <= 0) {
      pendingFitRef.current = true;
      return;
    }

    pendingFitRef.current = false;
    setCamera(createCameraForTrainingWorld(canvasSizeRef.current, selectedScenario));
  }, [selectedScenario]);

  const loadPreviewWorld = useCallback(() => {
    const runtime = createTrainingWorldRuntime(selectedScenario);
    runtime.controller.setLearnedAction(null);
    worldRef.current = runtime.world;
    currentControllerRef.current = runtime.controller;
    setStatusText("Previewing the selected training scenario.");
    fitCameraIfPossible();
  }, [fitCameraIfPossible, selectedScenario]);

  const loadFreshTrainingRuntime = useCallback(() => {
    const runtime = createTrainingWorldRuntime(selectedScenario);
    worldRef.current = runtime.world;
    currentControllerRef.current = runtime.controller;
    fitCameraIfPossible();
  }, [fitCameraIfPossible, selectedScenario]);

  const refreshStoredModels = useCallback(() => {
    const nextModels = listStoredPpoModels();
    setStoredModels(nextModels);
    setSelectedStoredModelName((current) => current || nextModels[0]?.name || "");
  }, []);

  const disposeCurrentTrainer = useCallback(() => {
    trainerRef.current?.dispose();
    trainerRef.current = null;
  }, []);

  const resetTraining = useCallback(() => {
    setRunning(false);
    disposeCurrentTrainer();
    previousObservationRef.current = null;
    previousDecisionRef.current = null;
    previousActionRef.current = null;
    setTrainerSnapshot(null);
    setEpisodeHistory([]);
    setUpdateHistory([]);
    setCurrentMetrics({
      lowerBodyPositionX: 0,
      lowerBodyXOscillations: 0,
      lowerBodyYOscillations: 0,
    });
    loadPreviewWorld();
  }, [disposeCurrentTrainer, loadPreviewWorld]);

  const startNewRun = useCallback(() => {
    disposeCurrentTrainer();
    trainerRef.current = new PpoTrainer(
      OBSERVATION_SIZE,
      LEARNED_ACTION_SIZE,
      currentNetworkConfig,
      currentTrainingConfig,
    );
    previousObservationRef.current = null;
    previousDecisionRef.current = null;
    previousActionRef.current = null;
    setEpisodeHistory([]);
    setUpdateHistory([]);
    setRunning(true);
    setTrainerSnapshot(trainerRef.current.getSnapshot());
    loadFreshTrainingRuntime();
    setStatusText("Collecting PPO rollouts.");
  }, [
    currentNetworkConfig,
    currentTrainingConfig,
    disposeCurrentTrainer,
    loadFreshTrainingRuntime,
  ]);

  const pauseRun = useCallback(() => {
    setRunning(false);
    setStatusText("Training paused.");
  }, []);

  const resumeRun = useCallback(() => {
    if (!trainerRef.current || !currentControllerRef.current) {
      startNewRun();
      return;
    }

    setRunning(true);
    setStatusText("PPO training resumed.");
  }, [startNewRun]);

  const handleSaveModel = useCallback(() => {
    const trainer = trainerRef.current;

    if (!trainer) {
      setStatusText("No PPO model is loaded to save.");
      return;
    }

    const checkpoint = trainer.policy.exportCheckpoint(currentTrainingConfig, rewardWeights, modelName.trim());
    saveNamedPpoModel(checkpoint);
    refreshStoredModels();
    setSelectedStoredModelName(checkpoint.name);
    setStatusText(`Saved PPO model "${checkpoint.name}".`);
  }, [currentTrainingConfig, modelName, refreshStoredModels, rewardWeights]);

  const loadCheckpointIntoTrainer = useCallback((checkpoint: StoredPpoCheckpoint, sourceLabel: string) => {
    setRunning(false);
    disposeCurrentTrainer();

    setHiddenLayerCount(checkpoint.networkConfig.hiddenLayerCount);
    setHiddenLayerWidth(checkpoint.networkConfig.hiddenLayerWidth);
    setActivation(checkpoint.networkConfig.activation);
    setInitialActionStd(checkpoint.networkConfig.initialActionStd);

    setLearningRate(checkpoint.trainingConfig.learningRate);
    setRolloutHorizon(checkpoint.trainingConfig.rolloutHorizon);
    setPpoEpochs(checkpoint.trainingConfig.ppoEpochs);
    setMinibatchSize(checkpoint.trainingConfig.minibatchSize);
    setClipEpsilon(checkpoint.trainingConfig.clipEpsilon);
    setGamma(checkpoint.trainingConfig.gamma);
    setGaeLambda(checkpoint.trainingConfig.gaeLambda);
    setEntropyCoefficient(checkpoint.trainingConfig.entropyCoefficient);
    setValueLossCoefficient(checkpoint.trainingConfig.valueLossCoefficient);
    setMaxGradNorm(checkpoint.trainingConfig.maxGradNorm);
    setMaxEpisodeSteps(checkpoint.trainingConfig.maxEpisodeSteps);

    setDistanceWeight(checkpoint.rewardWeights.distanceWeight);
    setXOscillationPenalty(checkpoint.rewardWeights.xOscillationPenalty);
    setYOscillationPenalty(checkpoint.rewardWeights.yOscillationPenalty);
    setUprightWeight(checkpoint.rewardWeights.uprightWeight);
    setHeightPenalty(checkpoint.rewardWeights.heightPenalty);
    setActionChangePenalty(checkpoint.rewardWeights.actionChangePenalty);

    const trainer = new PpoTrainer(
      checkpoint.observationSize,
      checkpoint.actionSize,
      checkpoint.networkConfig,
      checkpoint.trainingConfig,
    );
    trainer.policy.importCheckpoint(checkpoint);
    trainerRef.current = trainer;
    previousObservationRef.current = null;
    previousDecisionRef.current = null;
    previousActionRef.current = null;
    setTrainerSnapshot(trainer.getSnapshot());
    setEpisodeHistory([]);
    setUpdateHistory([]);
    loadPreviewWorld();
    setModelName(checkpoint.name);
    setStatusText(`Loaded PPO model from ${sourceLabel}: "${checkpoint.name}".`);
  }, [disposeCurrentTrainer, loadPreviewWorld]);

  const handleLoadSelectedModel = useCallback(() => {
    if (!selectedStoredModelName) {
      setStatusText("Pick a saved PPO model first.");
      return;
    }

    const checkpoint = loadNamedPpoModel(selectedStoredModelName);

    if (!checkpoint) {
      setStatusText(`Could not load saved PPO model "${selectedStoredModelName}".`);
      refreshStoredModels();
      return;
    }

    loadCheckpointIntoTrainer(checkpoint, "saved models");
  }, [loadCheckpointIntoTrainer, refreshStoredModels, selectedStoredModelName]);

  const handleLoadAutosave = useCallback(() => {
    const checkpoint = loadPpoAutosave(selectedScenario.id);

    if (!checkpoint) {
      setStatusText(`No autosave exists for scenario "${selectedScenario.name}".`);
      return;
    }

    loadCheckpointIntoTrainer(checkpoint, `autosave for ${selectedScenario.name}`);
  }, [loadCheckpointIntoTrainer, selectedScenario.id, selectedScenario.name]);

  useEffect(() => {
    setDistanceWeight(selectedReward.defaultWeights.distanceWeight);
    setXOscillationPenalty(selectedReward.defaultWeights.xOscillationPenalty);
    setYOscillationPenalty(selectedReward.defaultWeights.yOscillationPenalty);
    setUprightWeight(selectedReward.defaultWeights.uprightWeight);
    setHeightPenalty(selectedReward.defaultWeights.heightPenalty);
    setActionChangePenalty(selectedReward.defaultWeights.actionChangePenalty);
  }, [selectedReward]);

  useEffect(() => {
    refreshStoredModels();
  }, [refreshStoredModels]);

  useEffect(() => {
    if (running) {
      return;
    }

    loadPreviewWorld();
  }, [loadPreviewWorld, running]);

  useEffect(() => {
    return () => {
      disposeCurrentTrainer();
    };
  }, [disposeCurrentTrainer]);

  const handleBeforeStep = useCallback((world: PhysicsWorld, deltaTime: number) => {
    const trainer = trainerRef.current;
    let controller = currentControllerRef.current;

    if (!running || !trainer || !controller) {
      return;
    }

    const moveIntent = Number(selectedScenario.input.right) - Number(selectedScenario.input.left);
    let activeWorld = worldRef.current ?? world;

    if (previousObservationRef.current && previousDecisionRef.current) {
      const stepResult = evaluateTrainingStepReward(
        activeWorld,
        controller,
        previousActionRef.current,
        previousDecisionRef.current.action,
        rewardWeights,
      );

      trainer.recordTransition({
        observation: previousObservationRef.current,
        action: previousDecisionRef.current.action,
        reward: stepResult.reward,
        done: stepResult.done,
        value: previousDecisionRef.current.value,
        logProb: previousDecisionRef.current.logProb,
        rewardBreakdown: stepResult.rewardBreakdown,
      });

      const reachedEpisodeLimit = trainer.getSnapshot().currentEpisodeSteps >= maxEpisodeSteps || stepResult.done;

      if (reachedEpisodeLimit) {
        const metrics = readTrainingMetrics(activeWorld, controller);
        const summary = trainer.finishEpisode(metrics.lowerBodyPositionX);
        savePpoAutosave(
          selectedScenario.id,
          trainer.policy.exportCheckpoint(currentTrainingConfig, rewardWeights, `${selectedScenario.name} autosave`),
        );
        setEpisodeHistory((current) => {
          const next = [...current, buildEpisodeHistoryEntry(summary, current)];
          return next.slice(-250);
        });
        setStatusText(`Episode ${summary.episodeIndex} finished with reward ${summary.totalReward.toFixed(2)}.`);
        loadFreshTrainingRuntime();
        activeWorld = worldRef.current ?? activeWorld;
        controller = currentControllerRef.current;
        previousObservationRef.current = null;
        previousDecisionRef.current = null;
        previousActionRef.current = null;

        if (!controller) {
          return;
        }
      }

      const updateObservation = buildTrainingObservation(activeWorld, controller, deltaTime, moveIntent);
      const updateMetrics = trainer.maybeUpdate(updateObservation);
      if (updateMetrics) {
        setUpdateHistory((current) => {
          const next = [
            ...current,
            {
              updateIndex: current.length + 1,
              policyLoss: updateMetrics.policyLoss,
              valueLoss: updateMetrics.valueLoss,
              entropy: updateMetrics.entropy,
              approxKl: updateMetrics.approxKl,
            },
          ];
          return next.slice(-250);
        });
      }
    }

    const observation = buildTrainingObservation(activeWorld, controller, deltaTime, moveIntent);
    const decision = trainer.act(observation, true);
    controller.setLearnedAction(decodeLearnedAction(decision.action));
    const previousAppliedAction = previousDecisionRef.current?.action ?? null;
    previousObservationRef.current = observation;
    previousDecisionRef.current = decision;
    previousActionRef.current = previousAppliedAction;
  }, [
    currentTrainingConfig,
    loadFreshTrainingRuntime,
    maxEpisodeSteps,
    rewardWeights,
    running,
    selectedScenario.id,
    selectedScenario.input.left,
    selectedScenario.input.right,
    selectedScenario.name,
  ]);

  const handleFrameRendered = useCallback(() => {
    const trainer = trainerRef.current;
    const world = worldRef.current;
    const controller = currentControllerRef.current;

    if (trainer) {
      setTrainerSnapshot(trainer.getSnapshot());
    }

    if (world && controller) {
      setCurrentMetrics(readTrainingMetrics(world, controller));
    }
  }, []);

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
          <button className="toolbar__button" disabled={running} onClick={resumeRun}>
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
          <input
            className="toolbar__input"
            type="text"
            value={modelName}
            onChange={(event) => setModelName(event.target.value)}
            placeholder="Model name"
          />
          <button className="toolbar__button" disabled={!trainerSnapshot} onClick={handleSaveModel}>
            Save Model
          </button>
          <select
            className="toolbar__select"
            value={selectedStoredModelName}
            disabled={running || storedModels.length === 0}
            onChange={(event) => setSelectedStoredModelName(event.target.value)}
          >
            <option value="">{storedModels.length === 0 ? "No saved models" : "Pick saved model"}</option>
            {storedModels.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.name}
              </option>
            ))}
          </select>
          <button className="toolbar__button" disabled={running || !selectedStoredModelName} onClick={handleLoadSelectedModel}>
            Load Model
          </button>
          <button className="toolbar__button" disabled={running} onClick={handleLoadAutosave}>
            Load Autosave
          </button>
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
            <NumberControl label="Learning rate" min={0.00001} max={0.01} step={0.00001} value={learningRate} onChange={setLearningRate} />
            <NumberControl label="Rollout horizon" min={64} max={4096} step={32} value={rolloutHorizon} onChange={(value) => setRolloutHorizon(Math.round(value))} />
            <NumberControl label="PPO epochs" min={1} max={20} step={1} value={ppoEpochs} onChange={(value) => setPpoEpochs(Math.round(value))} />
            <NumberControl label="Minibatch size" min={16} max={1024} step={16} value={minibatchSize} onChange={(value) => setMinibatchSize(Math.round(value))} />
            <NumberControl label="Clip epsilon" min={0.01} max={0.5} step={0.01} value={clipEpsilon} onChange={setClipEpsilon} />
            <NumberControl label="Gamma" min={0.8} max={0.9999} step={0.001} value={gamma} onChange={setGamma} />
            <NumberControl label="GAE lambda" min={0.5} max={0.999} step={0.001} value={gaeLambda} onChange={setGaeLambda} />
            <NumberControl label="Entropy coef" min={0} max={0.1} step={0.0005} value={entropyCoefficient} onChange={setEntropyCoefficient} />
            <NumberControl label="Value loss coef" min={0.1} max={5} step={0.05} value={valueLossCoefficient} onChange={setValueLossCoefficient} />
            <NumberControl label="Max grad norm" min={0.05} max={5} step={0.05} value={maxGradNorm} onChange={setMaxGradNorm} />
            <NumberControl label="Max episode steps" min={120} max={10000} step={10} value={maxEpisodeSteps} onChange={(value) => setMaxEpisodeSteps(Math.round(value))} />
            <NumberControl label="Hidden layers" min={1} max={4} step={1} value={hiddenLayerCount} onChange={(value) => setHiddenLayerCount(Math.round(value))} />
            <NumberControl label="Hidden width" min={16} max={256} step={16} value={hiddenLayerWidth} onChange={(value) => setHiddenLayerWidth(Math.round(value))} />
            <NumberControl label="Initial action std" min={0.05} max={1} step={0.01} value={initialActionStd} onChange={setInitialActionStd} />
            <label className="charts-control">
              <span className="control__label">Activation</span>
              <select className="toolbar__select" value={activation} disabled={running} onChange={(event) => setActivation(event.target.value as PpoActivation)}>
                <option value="tanh">tanh</option>
                <option value="relu">relu</option>
              </select>
            </label>
            <NumberControl label="Distance weight" min={0} max={5} step={0.05} value={distanceWeight} onChange={setDistanceWeight} />
            <NumberControl label="X oscillation penalty" min={0} max={2} step={0.01} value={xOscillationPenalty} onChange={setXOscillationPenalty} />
            <NumberControl label="Y oscillation penalty" min={0} max={2} step={0.01} value={yOscillationPenalty} onChange={setYOscillationPenalty} />
            <NumberControl label="Upright weight" min={0} max={2} step={0.01} value={uprightWeight} onChange={setUprightWeight} />
            <NumberControl label="Height penalty" min={0} max={5} step={0.05} value={heightPenalty} onChange={setHeightPenalty} />
            <NumberControl label="Action change penalty" min={0} max={1} step={0.01} value={actionChangePenalty} onChange={setActionChangePenalty} />
          </div>

          <div className="charts-run-card training-summary">
            <div className="charts-run-card__title">Live Summary</div>
            <div className="charts-run-card__meta">Obs {OBSERVATION_SIZE} | Actions {LEARNED_ACTION_SIZE}</div>
            <div className="training-summary__grid">
              <span>Episodes</span>
              <strong>{trainerSnapshot?.episodesCompleted ?? 0}</strong>
              <span>Updates</span>
              <strong>{trainerSnapshot?.updatesCompleted ?? 0}</strong>
              <span>Env steps</span>
              <strong>{trainerSnapshot?.totalEnvironmentSteps ?? 0}</strong>
              <span>Current reward</span>
              <strong>{trainerSnapshot?.currentEpisodeReward.toFixed(2) ?? "0.00"}</strong>
              <span>Best episode</span>
              <strong>{trainerSnapshot?.bestEpisode?.totalReward.toFixed(2) ?? "n/a"}</strong>
              <span>Moving avg</span>
              <strong>{movingAverageReward.toFixed(2)}</strong>
              <span>Policy loss</span>
              <strong>{trainerSnapshot?.lastUpdateMetrics?.policyLoss.toFixed(4) ?? "n/a"}</strong>
              <span>Value loss</span>
              <strong>{trainerSnapshot?.lastUpdateMetrics?.valueLoss.toFixed(4) ?? "n/a"}</strong>
              <span>Entropy</span>
              <strong>{trainerSnapshot?.lastUpdateMetrics?.entropy.toFixed(4) ?? "n/a"}</strong>
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
              onBeforeStep={handleBeforeStep}
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
                  <h2 className="charts-panel__title">PPO History</h2>
                  <div className="charts-panel__subtitle">Episode reward trends and optimizer losses.</div>
                </div>
              </div>
              <TrainingChart episodeHistory={episodeHistory} updateHistory={updateHistory} />
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
                  {trainerSnapshot?.bestEpisode ? (
                    <>
                      <tr>
                        <td>Best reward</td>
                        <td>{trainerSnapshot.bestEpisode.totalReward.toFixed(3)}</td>
                      </tr>
                      <tr>
                        <td>Episode</td>
                        <td>{trainerSnapshot.bestEpisode.episodeIndex}</td>
                      </tr>
                      <tr>
                        <td>Steps</td>
                        <td>{trainerSnapshot.bestEpisode.steps}</td>
                      </tr>
                      <tr>
                        <td>Final lowerBody X</td>
                        <td>{trainerSnapshot.bestEpisode.finalLowerBodyX.toFixed(3)}</td>
                      </tr>
                      <tr>
                        <td>Distance part</td>
                        <td>{trainerSnapshot.bestEpisode.breakdown.distanceContribution.toFixed(3)}</td>
                      </tr>
                      <tr>
                        <td>X oscillation part</td>
                        <td>{trainerSnapshot.bestEpisode.breakdown.xOscillationContribution.toFixed(3)}</td>
                      </tr>
                      <tr>
                        <td>Y oscillation part</td>
                        <td>{trainerSnapshot.bestEpisode.breakdown.yOscillationContribution.toFixed(3)}</td>
                      </tr>
                      <tr>
                        <td>Upright part</td>
                        <td>{trainerSnapshot.bestEpisode.breakdown.uprightContribution.toFixed(3)}</td>
                      </tr>
                      <tr>
                        <td>Height part</td>
                        <td>{trainerSnapshot.bestEpisode.breakdown.heightContribution.toFixed(3)}</td>
                      </tr>
                      <tr>
                        <td>Action change part</td>
                        <td>{trainerSnapshot.bestEpisode.breakdown.actionChangeContribution.toFixed(3)}</td>
                      </tr>
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
                    <th>Metric</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Current lowerBody X</td>
                    <td>{currentMetrics.lowerBodyPositionX.toFixed(3)}</td>
                  </tr>
                  <tr>
                    <td>Current X oscillation</td>
                    <td>{currentMetrics.lowerBodyXOscillations.toFixed(3)}</td>
                  </tr>
                  <tr>
                    <td>Current Y oscillation</td>
                    <td>{currentMetrics.lowerBodyYOscillations.toFixed(3)}</td>
                  </tr>
                  <tr>
                    <td>Current episode steps</td>
                    <td>{trainerSnapshot?.currentEpisodeSteps ?? 0}</td>
                  </tr>
                  <tr>
                    <td>Distance contribution</td>
                    <td>{trainerSnapshot?.currentEpisodeBreakdown.distanceContribution.toFixed(3) ?? "0.000"}</td>
                  </tr>
                  <tr>
                    <td>X oscillation contribution</td>
                    <td>{trainerSnapshot?.currentEpisodeBreakdown.xOscillationContribution.toFixed(3) ?? "0.000"}</td>
                  </tr>
                  <tr>
                    <td>Y oscillation contribution</td>
                    <td>{trainerSnapshot?.currentEpisodeBreakdown.yOscillationContribution.toFixed(3) ?? "0.000"}</td>
                  </tr>
                  <tr>
                    <td>Upright contribution</td>
                    <td>{trainerSnapshot?.currentEpisodeBreakdown.uprightContribution.toFixed(3) ?? "0.000"}</td>
                  </tr>
                  <tr>
                    <td>Height contribution</td>
                    <td>{trainerSnapshot?.currentEpisodeBreakdown.heightContribution.toFixed(3) ?? "0.000"}</td>
                  </tr>
                  <tr>
                    <td>Action change contribution</td>
                    <td>{trainerSnapshot?.currentEpisodeBreakdown.actionChangeContribution.toFixed(3) ?? "0.000"}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}

function buildEpisodeHistoryEntry(summary: PpoEpisodeSummary, history: readonly TrainingEpisodeHistoryEntry[]): TrainingEpisodeHistoryEntry {
  const recentRewards = [...history.slice(-9).map((entry) => entry.totalReward), summary.totalReward];
  const movingAverageReward = recentRewards.reduce((sum, reward) => sum + reward, 0) / recentRewards.length;

  return {
    episodeIndex: summary.episodeIndex,
    totalReward: summary.totalReward,
    movingAverageReward,
    distanceContribution: summary.breakdown.distanceContribution,
    xOscillationContribution: summary.breakdown.xOscillationContribution,
    yOscillationContribution: summary.breakdown.yOscillationContribution,
    uprightContribution: summary.breakdown.uprightContribution,
    heightContribution: summary.breakdown.heightContribution,
    actionChangeContribution: summary.breakdown.actionChangeContribution,
    finalLowerBodyX: summary.finalLowerBodyX,
    steps: summary.steps,
  };
}
