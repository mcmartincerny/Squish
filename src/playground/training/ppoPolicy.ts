import * as tf from "@tensorflow/tfjs";
import { gaussianEntropyTensor, gaussianLogProb, gaussianLogProbTensor, sampleGaussian } from "./ppoMath.ts";
import type { PpoNetworkConfig, PpoUpdateMetrics, PolicyDecision } from "./ppoTypes.ts";
import type { RolloutBatch } from "./ppoBuffer.ts";
import { deserializeTensor, serializeTensor, type StoredPpoCheckpoint } from "./ppoStorage.ts";

export class PpoPolicy {
  readonly observationSize: number;
  readonly actionSize: number;

  private readonly model: tf.LayersModel;
  private readonly logStd: tf.Variable;
  private optimizer: tf.Optimizer;
  private readonly networkConfig: PpoNetworkConfig;
  private learningRate: number;

  constructor(observationSize: number, actionSize: number, networkConfig: PpoNetworkConfig, learningRate: number) {
    this.observationSize = observationSize;
    this.actionSize = actionSize;
    this.networkConfig = { ...networkConfig };
    this.learningRate = learningRate;
    this.model = createActorCriticModel(observationSize, actionSize, networkConfig);
    this.logStd = tf.variable(tf.fill([actionSize], Math.log(networkConfig.initialActionStd)));
    this.optimizer = tf.train.adam(learningRate);
  }

  setLearningRate(nextLearningRate: number): void {
    if (Math.abs(this.learningRate - nextLearningRate) <= Number.EPSILON) {
      return;
    }

    this.learningRate = nextLearningRate;
    this.optimizer.dispose();
    this.optimizer = tf.train.adam(nextLearningRate);
  }

  exportCheckpoint(trainingConfig: StoredPpoCheckpoint["trainingConfig"], rewardWeights: StoredPpoCheckpoint["rewardWeights"], name: string): StoredPpoCheckpoint {
    const modelWeights = this.model.getWeights();
    const checkpoint: StoredPpoCheckpoint = {
      name,
      savedAt: Date.now(),
      observationSize: this.observationSize,
      actionSize: this.actionSize,
      networkConfig: { ...this.networkConfig },
      trainingConfig,
      rewardWeights,
      modelWeights: modelWeights.map(serializeTensor),
      logStd: Array.from(this.logStd.dataSync()),
    };
    modelWeights.forEach((tensor) => tensor.dispose());
    return checkpoint;
  }

  importCheckpoint(checkpoint: StoredPpoCheckpoint): void {
    if (checkpoint.observationSize !== this.observationSize || checkpoint.actionSize !== this.actionSize) {
      throw new Error("Checkpoint shape does not match the current PPO policy.");
    }

    const weightTensors = checkpoint.modelWeights.map(deserializeTensor);

    try {
      this.model.setWeights(weightTensors);
      const logStdTensor = tf.tensor1d(checkpoint.logStd);
      this.logStd.assign(logStdTensor);
      logStdTensor.dispose();
    } finally {
      weightTensors.forEach((tensor) => tensor.dispose());
    }
  }

  dispose(): void {
    this.optimizer.dispose();
    this.logStd.dispose();
    this.model.dispose();
  }

  act(observation: readonly number[], stochastic = true): PolicyDecision {
    return tf.tidy(() => {
      const observationTensor = tf.tensor2d([Array.from(observation)], [1, this.observationSize]);
      const [meanTensor, valueTensor] = this.model.predict(observationTensor) as tf.Tensor[];
      const mean = Array.from((meanTensor as tf.Tensor2D).dataSync());
      const value = valueTensor.dataSync()[0] ?? 0;
      const logStd = Array.from(this.logStd.dataSync());
      const std = logStd.map((entry) => Math.exp(entry));
      const action = stochastic ? sampleGaussian(mean, std) : mean.map((entry) => Math.max(-1, Math.min(1, entry)));
      const logProb = gaussianLogProb(mean, action, logStd);
      return {
        action,
        logProb,
        value,
        mean,
      };
    });
  }

  predictValue(observation: readonly number[]): number {
    return tf.tidy(() => {
      const observationTensor = tf.tensor2d([Array.from(observation)], [1, this.observationSize]);
      const [, valueTensor] = this.model.predict(observationTensor) as tf.Tensor[];
      return valueTensor.dataSync()[0] ?? 0;
    });
  }

  update(
    batch: RolloutBatch,
    options: {
      clipEpsilon: number;
      entropyCoefficient: number;
      valueLossCoefficient: number;
      maxGradNorm: number;
      epochs: number;
      minibatchSize: number;
    },
  ): PpoUpdateMetrics {
    if (batch.observations.length === 0) {
      return {
        policyLoss: 0,
        valueLoss: 0,
        entropy: 0,
        approxKl: 0,
      };
    }

    const indices = [...Array(batch.observations.length).keys()];
    let policyLossTotal = 0;
    let valueLossTotal = 0;
    let entropyTotal = 0;
    let approxKlTotal = 0;
    let updateCount = 0;

    for (let epoch = 0; epoch < options.epochs; epoch += 1) {
      shuffleInPlace(indices);

      for (let start = 0; start < indices.length; start += options.minibatchSize) {
        const minibatchIndices = indices.slice(start, start + options.minibatchSize);
        const metrics = this.trainMinibatch(batch, minibatchIndices, options);
        policyLossTotal += metrics.policyLoss;
        valueLossTotal += metrics.valueLoss;
        entropyTotal += metrics.entropy;
        approxKlTotal += metrics.approxKl;
        updateCount += 1;
      }
    }

    return {
      policyLoss: policyLossTotal / Math.max(updateCount, 1),
      valueLoss: valueLossTotal / Math.max(updateCount, 1),
      entropy: entropyTotal / Math.max(updateCount, 1),
      approxKl: approxKlTotal / Math.max(updateCount, 1),
    };
  }

  private trainMinibatch(
    batch: RolloutBatch,
    minibatchIndices: readonly number[],
    options: {
      clipEpsilon: number;
      entropyCoefficient: number;
      valueLossCoefficient: number;
      maxGradNorm: number;
    },
  ): PpoUpdateMetrics {
    const observationTensor = tf.tensor2d(minibatchIndices.map((index) => batch.observations[index]));
    const actionTensor = tf.tensor2d(minibatchIndices.map((index) => batch.actions[index]));
    const oldLogProbTensor = tf.tensor1d(minibatchIndices.map((index) => batch.oldLogProbs[index]));
    const advantageTensor = tf.tensor1d(minibatchIndices.map((index) => batch.advantages[index]));
    const returnTensor = tf.tensor1d(minibatchIndices.map((index) => batch.returns[index]));

    let policyLossValue = 0;
    let valueLossValue = 0;
    let entropyValue = 0;
    let approxKlValue = 0;

    const variables = [...this.model.trainableWeights.map((weight) => weight["val"] as unknown as tf.Variable), this.logStd];
    const { value: lossTensor, grads } = tf.variableGrads(() => {
      const [meanTensor, valueTensor] = this.model.apply(observationTensor, { training: true }) as tf.Tensor[];
      const mean = meanTensor as tf.Tensor2D;
      const predictedValue = tf.squeeze(valueTensor, [1]) as tf.Tensor1D;
      const newLogProb = gaussianLogProbTensor(mean, actionTensor, this.logStd as unknown as tf.Tensor1D);
      const ratio = tf.exp(tf.sub(newLogProb, oldLogProbTensor));
      const unclipped = tf.mul(ratio, advantageTensor);
      const clippedRatio = tf.clipByValue(ratio, 1 - options.clipEpsilon, 1 + options.clipEpsilon);
      const clipped = tf.mul(clippedRatio, advantageTensor);
      const policyLoss = tf.neg(tf.mean(tf.minimum(unclipped, clipped)));
      const valueLoss = tf.mean(tf.square(tf.sub(returnTensor, predictedValue)));
      const entropy = gaussianEntropyTensor(this.logStd as unknown as tf.Tensor1D);
      const approxKl = tf.mean(tf.sub(oldLogProbTensor, newLogProb));

      policyLossValue = policyLoss.dataSync()[0] ?? 0;
      valueLossValue = valueLoss.dataSync()[0] ?? 0;
      entropyValue = entropy.dataSync()[0] ?? 0;
      approxKlValue = approxKl.dataSync()[0] ?? 0;

      return tf.addN([
        policyLoss,
        tf.mul(valueLoss, options.valueLossCoefficient),
        tf.mul(entropy, -options.entropyCoefficient),
      ]) as tf.Scalar;
    }, variables);

    const gradList = variables.map((variable) => grads[variable.name] ?? tf.zerosLike(variable));
    const globalNorm = tf.tidy(() => {
      const squared = gradList.map((gradient) => tf.sum(tf.square(gradient)));
      const sum = tf.addN(squared);
      squared.forEach((tensor) => tensor.dispose());
      return tf.sqrt(sum);
    });
    const clipScale = tf.tidy(() => tf.minimum(1, tf.div(options.maxGradNorm, tf.add(globalNorm, 1e-6))));
    const clippedGrads = gradList.map((gradient) => tf.mul(gradient, clipScale));
    const gradMap: Record<string, tf.Tensor> = {};
    variables.forEach((variable, index) => {
      gradMap[variable.name] = clippedGrads[index];
    });
    this.optimizer.applyGradients(gradMap);

    lossTensor.dispose();
    observationTensor.dispose();
    actionTensor.dispose();
    oldLogProbTensor.dispose();
    advantageTensor.dispose();
    returnTensor.dispose();
    globalNorm.dispose();
    clipScale.dispose();
    clippedGrads.forEach((gradient) => gradient.dispose());
    gradList.forEach((gradient) => gradient.dispose());
    Object.values(grads).forEach((gradient: tf.Tensor) => gradient.dispose());

    return {
      policyLoss: policyLossValue,
      valueLoss: valueLossValue,
      entropy: entropyValue,
      approxKl: approxKlValue,
    };
  }
}

function createActorCriticModel(
  observationSize: number,
  actionSize: number,
  networkConfig: PpoNetworkConfig,
): tf.LayersModel {
  const input = tf.input({ shape: [observationSize] });
  let current: tf.SymbolicTensor = input;

  for (let layerIndex = 0; layerIndex < networkConfig.hiddenLayerCount; layerIndex += 1) {
    current = tf.layers.dense({
      units: networkConfig.hiddenLayerWidth,
      activation: networkConfig.activation,
      kernelInitializer: "glorotUniform",
    }).apply(current) as tf.SymbolicTensor;
  }

  const mean = tf.layers.dense({
    units: actionSize,
    activation: "tanh",
    kernelInitializer: "glorotUniform",
  }).apply(current) as tf.SymbolicTensor;

  const value = tf.layers.dense({
    units: 1,
    kernelInitializer: "glorotUniform",
  }).apply(current) as tf.SymbolicTensor;

  return tf.model({
    inputs: input,
    outputs: [mean, value],
  });
}

function shuffleInPlace(values: number[]): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const next = values[index];
    values[index] = values[swapIndex];
    values[swapIndex] = next;
  }
}
