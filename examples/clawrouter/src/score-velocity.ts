/**
 * WZRD Velocity Scoring Dimension for ClawRouter.
 *
 * Mirrors ClawRouter's DimensionScore shape. Returns a [-1, 1] score
 * based on the model's velocity in the WZRD signal feed.
 *
 * Designed to be dimension #15 in ClawRouter's 14-dimension scorer,
 * filling the 0.06 weight gap.
 *
 * Usage:
 *   const dim = scoreModelVelocity("qwen/qwen3.5-9b");
 *   // { name: "modelVelocity", score: 0.8, weight: 0.06, signal: "accelerating", ... }
 */

import { getVelocityScore, getVelocitySignal, type VelocitySignal } from "./velocity-cache.js";

export interface VelocityDimensionScore {
  name: "modelVelocity";
  /** Score in [-1, 1]. >0 = trending up, <0 = trending down, 0 = neutral. */
  score: number;
  /** Suggested weight in ClawRouter's weighted sum. */
  weight: number;
  /** Human-readable signal label. */
  signal: string;
  /** Full WZRD signal data, if available. */
  wzrd: VelocitySignal | null;
}

/**
 * Score a model's velocity for use as a ClawRouter dimension.
 *
 * Converts WZRD's 0–1 score to ClawRouter's [-1, 1] range:
 *   0.0 (WZRD) → -1.0 (cooling hard)
 *   0.5 (WZRD) →  0.0 (neutral/unknown)
 *   1.0 (WZRD) → +1.0 (surging)
 *
 * Quality index (AA benchmark) boosts the score by up to 15%
 * for models with strong structural quality.
 */
// Trend direction is the primary routing signal.
// A model with high absolute velocity but "cooling" trend should score lower
// than a model with moderate velocity but "surging" trend.
const TREND_SCORES: Record<string, number> = {
  surging: 1.0,
  accelerating: 0.6,
  stable: 0.0,
  insufficient_history: -0.1,
  decelerating: -0.5,
  cooling: -0.8,
};

const CONFIDENCE_WEIGHTS: Record<string, number> = {
  normal: 1.0,
  high: 1.0,
  low: 0.5,
  insufficient: 0.2,
};

export function scoreModelVelocity(modelId: string): VelocityDimensionScore {
  const signal = getVelocitySignal(modelId);

  if (!signal) {
    return {
      name: "modelVelocity",
      score: 0,
      weight: 0.06,
      signal: "untracked",
      wzrd: null,
    };
  }

  // Primary signal: trend direction
  const trendScore = TREND_SCORES[signal.trend] ?? 0;

  // Secondary signal: raw velocity rank (0–1), mapped to [-0.3, 0.3]
  const velocityBonus = (signal.score - 0.5) * 0.6;

  // Combine: trend dominates, velocity refines
  let score = trendScore * 0.7 + velocityBonus * 0.3;

  // Confidence dampens low-confidence signals toward neutral
  const confWeight = CONFIDENCE_WEIGHTS[signal.confidence] ?? 0.5;
  score *= confWeight;

  // Quality index boost for AA-benchmarked models
  if (signal.quality_index != null && signal.quality_index > 0) {
    score *= 1 + (signal.quality_index / 100) * 0.15;
  }

  // Clamp to [-1, 1]
  score = Math.max(-1, Math.min(1, score));

  const signalLabel = signal.trend === "insufficient_history" && signal.confidence === "insufficient"
    ? "insufficient_data"
    : signal.trend;

  return {
    name: "modelVelocity",
    score: Math.round(score * 1000) / 1000,
    weight: 0.06,
    signal: signalLabel,
    wzrd: signal,
  };
}

/**
 * Score multiple models and return sorted by velocity (highest first).
 */
export function rankByVelocity(
  modelIds: string[]
): Array<{ modelId: string } & VelocityDimensionScore> {
  return modelIds
    .map((modelId) => ({
      modelId,
      ...scoreModelVelocity(modelId),
    }))
    .sort((a, b) => b.score - a.score);
}
