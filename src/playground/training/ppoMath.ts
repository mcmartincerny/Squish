import * as tf from "@tensorflow/tfjs";

const LOG_TWO_PI = Math.log(2 * Math.PI);

export function sampleGaussian(mean: readonly number[], std: readonly number[]): number[] {
  return mean.map((value, index) => clamp(value + randomNormal() * std[index], -1, 1));
}

export function gaussianLogProb(mean: readonly number[], action: readonly number[], logStd: readonly number[]): number {
  let total = 0;

  for (let index = 0; index < action.length; index += 1) {
    const diff = action[index] - mean[index];
    const variance = Math.exp(logStd[index] * 2);
    total += -0.5 * ((diff * diff) / variance + 2 * logStd[index] + LOG_TWO_PI);
  }

  return total;
}

export function gaussianLogProbTensor(mean: tf.Tensor2D, action: tf.Tensor2D, logStd: tf.Tensor1D): tf.Tensor1D {
  return tf.tidy(() => {
    const broadcastLogStd = tf.expandDims(logStd, 0);
    const variance = tf.exp(tf.mul(broadcastLogStd, 2));
    const squaredError = tf.square(tf.sub(action, mean));
    const scaled = tf.div(squaredError, variance);
    const logStdTerm = tf.mul(broadcastLogStd, 2);
    const perDim = tf.mul(-0.5, tf.add(tf.add(scaled, logStdTerm), LOG_TWO_PI));
    return tf.sum(perDim, 1) as tf.Tensor1D;
  });
}

export function gaussianEntropyTensor(logStd: tf.Tensor1D): tf.Scalar {
  return tf.tidy(() => {
    const perDim = tf.add(logStd, 0.5 * Math.log(2 * Math.PI * Math.E));
    return tf.sum(perDim) as tf.Scalar;
  });
}

export function discountAdvantages(
  rewards: readonly number[],
  values: readonly number[],
  dones: readonly boolean[],
  lastValue: number,
  gamma: number,
  gaeLambda: number,
): { advantages: number[]; returns: number[] } {
  const advantages = new Array<number>(rewards.length).fill(0);
  const returns = new Array<number>(rewards.length).fill(0);
  let nextValue = lastValue;
  let gae = 0;

  for (let index = rewards.length - 1; index >= 0; index -= 1) {
    const nonTerminal = dones[index] ? 0 : 1;
    const delta = rewards[index] + gamma * nextValue * nonTerminal - values[index];
    gae = delta + gamma * gaeLambda * nonTerminal * gae;
    advantages[index] = gae;
    returns[index] = gae + values[index];
    nextValue = values[index];
  }

  return { advantages, returns };
}

export function normalizeVector(values: readonly number[]): number[] {
  if (values.length === 0) {
    return [];
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / values.length;
  const std = Math.sqrt(variance) + 1e-8;
  return values.map((value) => (value - mean) / std);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomNormal(): number {
  let u = 0;
  let v = 0;
  while (u === 0) {
    u = Math.random();
  }
  while (v === 0) {
    v = Math.random();
  }
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
