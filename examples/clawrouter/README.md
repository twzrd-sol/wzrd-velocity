# @wzrd_sol/clawrouter-velocity

Real-time model velocity signals for ClawRouter. Adds a 15th scoring dimension based on which models are gaining adoption across HuggingFace, GitHub, OpenRouter, and ArtificialAnalysis.

## Install

```bash
npm install @wzrd_sol/clawrouter-velocity
```

## Quick start

```typescript
import { startCache, scoreModelVelocity, rankByVelocity } from "@wzrd_sol/clawrouter-velocity";

// Start the background cache (fetches every 5 min, <1us lookups)
await startCache();

// Score a single model for ClawRouter's weighted sum
const dim = scoreModelVelocity("Qwen/Qwen3.5-9B");
// { name: "modelVelocity", score: -0.085, weight: 0.06, signal: "stable", wzrd: {...} }

// Rank a batch of models by velocity
const ranked = rankByVelocity([
  "meta-llama/Llama-3.3-70B-Instruct",
  "Qwen/Qwen3.5-9B",
  "deepseek-ai/DeepSeek-V3",
]);
// Sorted by velocity score (highest first)
```

## How it works

1. Background cache polls the [WZRD signal feed](https://api.twzrd.xyz/v1/signals/momentum/premium) every 5 minutes
2. `scoreModelVelocity()` converts WZRD's signal to ClawRouter's [-1, 1] dimension format
3. Trend direction dominates (70%), raw velocity refines (30%), confidence dampens low-data models
4. Quality index from ArtificialAnalysis benchmarks boosts by up to 15%
5. Untracked models return neutral (0) — never breaks existing routing

The dimension is designed as **#15** in ClawRouter's 14-dimension scorer, using the 0.06 weight gap.

## Scoring

| WZRD Trend | ClawRouter Score | Meaning |
|---|---|---|
| surging | +1.0 | Downloads/stars growing >30% |
| accelerating | +0.6 | Growing 8-30% |
| stable | 0.0 | Flat |
| decelerating | -0.5 | Slowing |
| cooling | -0.8 | Dropping >50% |

## Fuzzy matching

Model IDs are matched case-insensitively with slug fallback:

- `"Qwen/Qwen3.5-9B"` — exact match
- `"qwen/qwen3.5-9b"` — normalized match
- `"qwen3.5-9b"` — slug match

## API

| Function | Returns | Description |
|---|---|---|
| `startCache(url?, ms?)` | `Promise<void>` | Start background refresh (default: 5 min) |
| `stopCache()` | `void` | Stop background refresh |
| `getVelocityScore(model)` | `number` | 0.0-1.0 score (0.5 = neutral/untracked) |
| `getVelocitySignal(model)` | `VelocitySignal \| null` | Full signal data |
| `scoreModelVelocity(model)` | `VelocityDimensionScore` | ClawRouter dimension format |
| `rankByVelocity(models)` | `Array<...>` | Sorted by velocity (highest first) |
| `getCacheSize()` | `number` | Models in cache |
| `getCacheAge()` | `number` | Cache age in ms |

## Signal source

Data comes from the public, free, no-auth [WZRD API](https://api.twzrd.xyz/v1/signals/momentum/premium) tracking 96+ models across 4 platforms. If the API is unreachable, the cache keeps serving stale data (stale-while-revalidate).

## License

MIT
