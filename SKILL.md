---
name: wzrd-velocity
description: Real-time AI model velocity signal + earn loop. Use when the user asks which model is moving, wants to prewarm/shortlist, compare signals, or earn CCM by reporting picks.
license: MIT
compatibility: Requires internet access. No API key needed for signals. Solana keypair needed for earning.
metadata:
  author: twzrd-sol
  version: "3.0.0"
  category: ai
---

# WZRD Velocity Signal + Earn Loop

Two capabilities: **read signals** (free, no auth) and **earn CCM** (requires Solana keypair).

## 1. Signal Feed (Free, No Auth)

```bash
curl -s https://api.twzrd.xyz/v1/signals/momentum?limit=5
```

```json
{
  "contract_version": "wzrd.momentum.v1",
  "count": 5,
  "models": [
    {
      "model": "Qwen/Qwen3.5-9B",
      "trend": "stable",
      "score": 0.718,
      "action": "maintain",
      "confidence": "normal",
      "platform": "huggingface",
      "reason": "Stable velocity, normal confidence"
    }
  ]
}
```

### Fields

| Field | Values |
|-------|--------|
| `trend` | `surging` (>30% delta), `accelerating` (>8%), `stable` (>-15%), `decelerating` (>-50%), `cooling` |
| `action` | `pre_warm_urgent`, `pre_warm`, `candidate`, `recommend`, `route`, `maintain`, `watch`, `consider_deprovision`, `observe` |
| `confidence` | `high`, `normal`, `low`, `insufficient`, `unknown` |
| `platform` | `huggingface`, `github`, `openrouter`, `artificial_analysis` |

### Filters

- `?limit=N` (max 100) — number of results
- `?platform=huggingface` — filter by source
- `?trending=true` — only `surging` or `accelerating`
- `?capability=code` — filter by: `code`, `chat`, `reasoning`, `vision`, `audio`
- `?window=7d` — TWAA window: `1d`, `3d`, `7d`, `14d`, `30d`

### Premium Endpoint

`/v1/signals/momentum/premium` — same response plus `velocity_ema`, `accel`, `delta_pct`, `quality_index`, `agent_quality`, `agent_reports`, `value_score`. Also free, no auth.

## 2. Earn Loop (Requires Keypair)

Agents earn CCM by picking trending models and reporting verified inference results.

### Flow

```
authenticate (Ed25519) → pick_details(task) → infer(model) → report(execution_id) → claim (gasless relay)
```

### How It Works

1. **Auth**: Ed25519 challenge/verify → 24h Bearer token
2. **Pick**: Call `/v1/signals/momentum`, score by trend + task affinity
3. **Infer**: `POST /v1/agent/infer` — server calls the LLM, grades the response, returns `execution_id` + `quality_score`
4. **Report**: `POST /v1/agent/report` with `execution_id` for verified reward eligibility
5. **Claim**: When `pipeline.state == "claimable"`, claim via gasless relay (no SOL needed)

Reports WITHOUT `execution_id` are "unverified" — still eligible but lower reward tier. Server-witnessed inference via `/infer` is the highest tier.

### CLI (wzrd-client)

```bash
pip install wzrd-client

wzrd run                              # start earn loop (5min cycles, all tasks)
wzrd run --tasks=code,reasoning       # specific tasks
wzrd pick code                        # best model for task (no auth)
wzrd shortlist reasoning --limit=5    # ranked models (no auth)
wzrd earned                           # check earnings
wzrd status                           # full agent dashboard
wzrd stake 1000 --lock=30            # stake CCM (30-day lock = 1.5x boost)
wzrd unstake                          # unstake (lock must be expired)
wzrd rewards --claim                  # claim staking rewards
```

### Key Technical Details

- **EMA is time-adaptive**: `α = 1 - exp(-dt / 21600)`, halflife 6 hours. NOT a fixed 0.1.
- **Quality is server-graded**: server picks eval prompts, calls the LLM, validates responses. Quality (0.0-1.0) is independent of report count.
- **No timing-based acceptance bonus**: all reports within a scoring window are treated equally.
- **Scoring cycle**: 300s default. Swarm cohorts run at 600s/900s/1800s.
- **CCM amounts**: 9 decimals (1 CCM = 1,000,000,000 native units).

## Verification

Working response: `models` array with `model`, `trend`, `score`, `action`, `confidence`, `platform`. Health: `GET /health`. Full API reference: `references/api-endpoints.md`.
