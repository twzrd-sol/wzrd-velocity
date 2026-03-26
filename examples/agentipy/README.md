# WZRD Velocity Oracle for AgentiPy

AI model velocity signals for Solana agents. Pick the best model for any task using real-time data from HuggingFace, GitHub, OpenRouter, and ArtificialAnalysis.

## Install

```bash
pip install wzrd-client>=0.5.0
```

Copy `use_wzrd.py` to `agentipy/tools/` or import directly.

## Quick Start

```python
from agentipy.agent import SolanaAgentKit
from agentipy.tools.use_wzrd import WZRDManager

agent = SolanaAgentKit(...)

# Pick the best model for code tasks
pick = WZRDManager.pick_model(agent, task="code")
print(f"Use {pick['model_id']} (score: {pick['score']})")

# Get momentum for all models
signals = WZRDManager.get_momentum(agent, min_confidence=0.7)
for m in signals["models"][:5]:
    print(f"  {m['model_id']}: {m['score']}")

# Compare specific models
comparison = WZRDManager.compare_models(agent, ["gpt-4o", "claude-sonnet-4-20250514", "llama-3.3-70b"])
```

## Earn CCM Tokens

Agents that report which models they use earn CCM tokens:

```python
# Authenticate (Ed25519 challenge/verify)
auth = WZRDManager.authenticate(agent)

# Report a model pick
WZRDManager.report_pick(agent, model_id="gpt-4o", task="code", token=auth["token"])

# Check earnings
earned = WZRDManager.get_earned(agent, token=auth["token"])
print(f"Earned: {earned['total_earned_ccm']} CCM")
```

## Methods

| Method | Auth? | Description |
|--------|-------|-------------|
| `pick_model(task)` | No | Best model for a task |
| `get_momentum(min_confidence)` | No | All model signals |
| `compare_models(model_ids)` | No | Compare specific models |
| `shortlist(task, top_n)` | No | Top N models ranked |
| `authenticate()` | No | Get bearer token (24h) |
| `report_pick(model, task, token)` | Yes | Report usage, earn CCM |
| `get_earned(token)` | Yes | Check CCM earnings |

## Links

- [WZRD Protocol](https://twzrd.xyz)
- [wzrd-client on PyPI](https://pypi.org/project/wzrd-client/)
- [Signal API docs](https://twzrd.xyz/llms.txt)
- [CCM on DEXScreener](https://dexscreener.com/solana/6fwqfjb345dvhnwjgdjnnknefkxh1vaqznwwqgurssmm)
