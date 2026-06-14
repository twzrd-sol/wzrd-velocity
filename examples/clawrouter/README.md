# @wzrd_sol/clawrouter-velocity

A model-momentum scoring signal for [ClawRouter](https://github.com/BlockRunAI/ClawRouter) and any agent-native LLM router. It surfaces which models are gaining adoption across HuggingFace, GitHub, OpenRouter, and ArtificialAnalysis, and converts that into a `[-1, 1]` term you fold into your router's model-selection sum.

## Install

```bash
npm install @wzrd_sol/clawrouter-velocity
```

## Quick start

```typescript
import { startCache, scoreModelVelocity, rankByVelocity } from "@wzrd_sol/clawrouter-velocity";

// Start the background cache (refreshes every 5 min; lookups are synchronous, in-memory)
await startCache();

// Score a single model for your router's weighted sum.
const dim = scoreModelVelocity("Qwen/Qwen3.6-27B");
// e.g. a surging model -> { name: "modelVelocity", score: 0.72, weight: 0.06, signal: "surging", wzrd: {...} }
// Values are live — the exact score and signal track the model's current momentum.

// Rank a batch of models by velocity
const ranked = rankByVelocity([
  "meta-llama/Llama-3.3-70B-Instruct",
  "Qwen/Qwen3.5-9B",
  "deepseek-ai/DeepSeek-V3",
]);
// Sorted by velocity score (highest first)
```

### CommonJS

The package ships both ESM and CommonJS builds. The scoring functions are fully
synchronous in both — safe to call inside ClawRouter's `<1ms` scoring loop.

```javascript
const { startCache, scoreModelVelocity } = require("@wzrd_sol/clawrouter-velocity");

await startCache();
const dim = scoreModelVelocity("Qwen/Qwen3.5-9B"); // returns the dimension object, not a Promise
```

## How it works

1. Background cache polls the [WZRD signal feed](https://api.twzrd.xyz/v1/signals/momentum/premium) every 5 minutes
2. `scoreModelVelocity()` converts WZRD's signal to ClawRouter's [-1, 1] dimension format
3. Trend direction dominates (70%), raw velocity refines (30%), confidence dampens low-data models
4. Quality index from ArtificialAnalysis benchmarks boosts by up to 15%
5. Untracked models return neutral (0) — never breaks existing routing

ClawRouter is open-source (MIT). It scores each request across its own classifier
dimensions (complexity, context, cost) to pick a tier; this signal is a separate,
**model-side** term — it nudges selection toward models that are gaining adoption.
Fold `score * weight` (suggested weight `0.06`) into your model-selection sum, or
wire it into a ClawRouter fork. It never reorders on its own — untracked models
score `0`, so existing routing is unchanged.

## Scoring

The final `score` is a blend, not a fixed value per trend:

```
score = trendWeight * 0.7 + (rawVelocity - 0.5) * 0.6 * 0.3   // trend dominates, velocity refines
score *= confidenceWeight                                      // low-data signals dampen toward 0
score *= 1 + (qualityIndex / 100) * 0.15                       // AA benchmark boost, up to +15%
score  = clamp(score, -1, 1)
```

`trendWeight` is the per-trend input coefficient below. A `surging` model does not
score `+1.0` — after the velocity/confidence blend it typically lands around
`+0.6` to `+0.8`; a `cooling` model lands around `-0.4` to `-0.6`.

| WZRD Trend | Trend weight (input) | Typical final score | Meaning |
|---|---|---|---|
| surging | +1.0 | +0.6 to +0.8 | Downloads/stars growing >30% |
| accelerating | +0.6 | +0.3 to +0.5 | Growing 8-30% |
| stable | 0.0 | ~0.0 | Flat |
| decelerating | -0.5 | -0.2 to -0.4 | Slowing |
| cooling | -0.8 | -0.4 to -0.6 | Dropping >50% |
| insufficient_history | -0.1 | ~0.0 | Not enough snapshots yet |

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
| `refreshCache(url?)` | `Promise<void>` | Force a one-off refresh now |
| `getVelocityScore(model)` | `number` | 0.0-1.0 score (0.5 = neutral/untracked) |
| `getVelocitySignal(model)` | `VelocitySignal \| null` | Full signal data |
| `scoreModelVelocity(model)` | `VelocityDimensionScore` | ClawRouter dimension format |
| `rankByVelocity(models)` | `Array<...>` | Sorted by velocity (highest first) |
| `getCacheSize()` | `number` | Models in cache |
| `getCacheAge()` | `number` | Cache age in ms |

## Signal source

Data comes from the public, free, no-auth WZRD momentum API. It surfaces the top
~100 models by momentum (of 200+ tracked) across HuggingFace, GitHub, OpenRouter,
and ArtificialAnalysis. The cache merges
the [`/premium`](https://api.twzrd.xyz/v1/signals/momentum/premium) feed (richer
fields: velocity EMA, acceleration, quality index) with the
[base](https://api.twzrd.xyz/v1/signals/momentum) feed (broader coverage), so you
get the full tracked set with extra fields where available. If the API is
unreachable, the cache keeps serving the last good data (stale-while-revalidate).

## License

MIT
