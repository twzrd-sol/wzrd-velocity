# Portkey + WZRD Router

Route to rising models using WZRD momentum + Portkey AI Gateway.

WZRD provides the demand signal. Portkey provides the gateway (retries, fallbacks,
caching, observability). This recipe connects them.

## Layout

```text
portkey-wzrd-router/
├── README.md
├── requirements.txt
├── wzrd_portkey.py
```

## Quick start

```bash
pip install requests portkey-ai
export PORTKEY_API_KEY=...
python wzrd_portkey.py qwen-9b qwen-35b llama-70b
```

Output:

```json
{
  "wzrd_preferred": "qwen-35b",
  "wzrd_trend": "accelerating",
  "wzrd_delta_pct": 11.9,
  "wzrd_routing": "pre_warm",
  "wzrd_history_depth": 3,
  "wzrd_history_confidence": "normal",
  "wzrd_ranking": [
    {"alias": "qwen-35b", "trend": "accelerating", "history_confidence": "normal", "priority": 4},
    {"alias": "qwen-9b", "trend": "insufficient_history", "history_confidence": "low", "priority": 3},
    {"alias": "llama-70b", "trend": "cooling", "history_confidence": "normal", "priority": 1}
  ]
}
```

## Two usage modes

### 1. Metadata-only (pass to your existing Portkey config)

```python
from wzrd_portkey import get_wzrd_metadata

meta = get_wzrd_metadata(candidates=["qwen-9b", "qwen-35b", "llama-70b"])
# meta["wzrd_preferred"] → best alias based on momentum
# meta["wzrd_trend"] → "accelerating", "stable", "insufficient_history", etc.
# meta["wzrd_routing"] → "pre_warm", "maintain", "observe", "consider_deprovision"
# meta["wzrd_history_confidence"] → "insufficient" | "low" | "normal"

# Pass to Portkey as request metadata for conditional routing rules
portkey.chat.completions.create(
    model=meta["wzrd_preferred"],
    messages=[...],
    metadata=meta,
)
```

### 2. One-liner (WZRD picks model, Portkey handles the call)

```python
from wzrd_portkey import wzrd_completion

response = wzrd_completion(
    messages=[{"role": "user", "content": "Hello"}],
    candidates=["qwen-9b", "qwen-35b", "llama-70b"],
)
```

## How it works

1. Fetch `GET api.twzrd.xyz/v1/signals/momentum` (cached 5 min)
2. Match your Portkey model aliases to WZRD model identifiers
3. Score by trend: surging > accelerating > stable/insufficient_history > decelerating > cooling
4. Return metadata dict with preferred model + full ranking
5. Portkey handles retries, fallbacks, and observability

## Confidence policy

For automatic routing actions:

- `normal`: eligible for proactive actions (`pre_warm`, `consider_deprovision`)
- `low` / `insufficient`: keep in `observe` posture unless explicitly overridden

## Alias mapping

Edit `DEFAULT_ALIASES` in `wzrd_portkey.py` to map your Portkey virtual keys
or model aliases to WZRD model names:

```python
DEFAULT_ALIASES = {
    "qwen-9b": ["Qwen/Qwen3.5-9B"],
    "qwen-35b": ["Qwen/Qwen3.5-35B-A3B"],
    "llama-70b": ["meta-llama/Llama-3.3-70B-Instruct"],
}
```

## Graceful degradation

If WZRD is unreachable, `get_wzrd_metadata` returns the first candidate
as preferred with trend="stable" and history_confidence="insufficient".
Your inference pipeline never breaks
because of a third-party signal feed.
