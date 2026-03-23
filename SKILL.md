---
name: wzrd-velocity
description: Real-time signal feed for AI model routing decisions. Use when the user asks which model is moving, what to prewarm, what belongs in a shortlist, or wants to compare model signals.
license: MIT
compatibility: Requires internet access. No API key needed.
metadata:
  author: twzrd-sol
  version: "2.0.0"
  category: ai
---

# WZRD Signal Feed

Which AI models are moving and what the feed says to do next.

**Free. No auth. One HTTP call.**

## Usage

```bash
curl -s https://api.twzrd.xyz/v1/signals/momentum?limit=5
```

Returns:

```json
{
  "count": 5,
  "models": [
    {
      "model": "meta-llama/Llama-3.3-70B-Instruct",
      "trend": "surging",
      "score": 0.153,
      "action": "pre_warm_urgent",
      "confidence": "normal",
      "platform": "huggingface",
      "capabilities": ["code", "reasoning"]
    }
  ]
}
```

## Fields

| Field | Meaning |
|-------|---------|
| `model` | Model identifier (HuggingFace, GitHub, OpenRouter, or ArtificialAnalysis name) |
| `trend` | Direction: surging, accelerating, stable, decelerating, cooling |
| `score` | Normalized velocity score (0-1) |
| `action` | Routing recommendation: pre_warm_urgent, pre_warm, maintain, watch, consider_deprovision |
| `confidence` | Data depth: normal, low, insufficient |
| `platform` | Source platform |
| `capabilities` | Model capabilities: code, chat, reasoning, vision, image, audio, video |

## Filters

- `?limit=N` — max results
- `?platform=huggingface` — filter by source
- `?capability=code` — filter by model capability
- `?trending=true` — only rising/surging

## Python SDK

```bash
pip install wzrd-client
```

```python
import wzrd

model = wzrd.pick("code")           # best model for code tasks
details = wzrd.pick_details("chat")  # full signal with trend, score, capabilities
ranked = wzrd.shortlist("reasoning") # top 5 for reasoning
```

## Verification

A working response has a `models` array with `model`, `trend`, `score`, `action`, `confidence`, `platform`, and `capabilities`. If the API is down, check `https://api.twzrd.xyz/health`.
