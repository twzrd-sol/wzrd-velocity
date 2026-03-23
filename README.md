# wzrd-velocity

**Which AI model should I use?** WZRD tells you — in real time.

```python
pip install wzrd-client
```

```python
import wzrd

model = wzrd.pick("code")  # returns the fastest-growing model right now
```

WZRD tracks adoption velocity of 100+ open-source AI models across HuggingFace downloads, GitHub stars, OpenRouter routing volume, and ArtificialAnalysis benchmarks. Updated every 5 minutes.

## What it does

- **Trend classification**: surging, accelerating, stable, decelerating, cooling
- **Capability filtering**: `pick("code")`, `pick("vision")`, `pick("reasoning")`
- **Shortlist ranking**: top N models for any task, scored by momentum
- **On-chain oracle**: 17 Switchboard feeds on Solana mainnet — any program can read velocity

## Install

### Python (recommended)

```bash
pip install wzrd-client
```

```python
import wzrd

# Pick the best model for a task
model = wzrd.pick("code")

# Get full details
choice = wzrd.pick_details("code")
print(choice.model, choice.trend, choice.score, choice.capabilities)

# Rank your candidates
ranked = wzrd.shortlist("chat", 5)

# Compare two models
wzrd.compare("meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen3.5-9B")
```

### TypeScript

```bash
npm install @wzrd_sol/sdk
```

### LiteLLM (routing plugin)

```bash
pip install litellm-wzrd-momentum
```

```python
from litellm import Router
from wzrd_momentum_strategy import register

router = Router(model_list=[...])
register(router)  # every call now routes via momentum
```

### ClawRouter (scoring dimension)

```bash
npm install @wzrd_sol/clawrouter-velocity
```

## Earn CCM while routing

Agents that report their model picks earn CCM tokens on Solana. No SOL required for claims (gasless relay).

```python
import wzrd

wzrd.run_loop()  # picks, reports, earns CCM, claims — runs forever
```

Or with manual control:

```python
agent = wzrd.WZRDAgent.from_env()
agent.authenticate()
agent.report_pick(choice, quality_score=0.9)
agent.earned()
agent.claim()
```

## Signal API (free, no auth)

```bash
# All models
curl https://api.twzrd.xyz/v1/signals/momentum

# Filter by capability
curl https://api.twzrd.xyz/v1/signals/momentum?capability=code

# Premium fields (velocity_ema, accel, quality_index)
curl https://api.twzrd.xyz/v1/signals/momentum/premium
```

Returns:

```json
{
  "count": 100,
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

## Switchboard Oracle (on-chain)

17 feeds on Solana mainnet. Any program can read model velocity permissionlessly:

```rust
let feed = PullFeedAccountData::parse(account_data)?;
let velocity = feed.get_value(&Clock::get()?, 100, 1, false)?;
```

2 price feeds: CCM/USD, vLOFI/USD.

## MCP Server

20 tools via streamable HTTP:

```
POST https://app.twzrd.xyz/api/mcp
```

Manifest: [.well-known/mcp-server.json](https://twzrd.xyz/.well-known/mcp-server.json)

## Links

- **Feed**: [twzrd.xyz/feed](https://twzrd.xyz/feed)
- **API**: [api.twzrd.xyz/v1/signals/momentum](https://api.twzrd.xyz/v1/signals/momentum)
- **OpenAPI**: [twzrd.xyz/openapi.json](https://twzrd.xyz/openapi.json)
- **llms.txt**: [api.twzrd.xyz/llms.txt](https://api.twzrd.xyz/llms.txt)
- **PyPI**: [pypi.org/project/wzrd-client](https://pypi.org/project/wzrd-client/)
- **npm**: [npmjs.com/package/@wzrd_sol/sdk](https://www.npmjs.com/package/@wzrd_sol/sdk)
- **MCP Guide**: [twzrd.xyz/mcp-guide.md](https://twzrd.xyz/mcp-guide.md)

## License

MIT
