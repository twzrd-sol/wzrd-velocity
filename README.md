# WZRD — AI Model Velocity Oracle for Agents

**Which AI model should your agent use right now?**
Real-time adoption signals across 100+ LLMs. HuggingFace, GitHub, OpenRouter, ArtificialAnalysis — updated every 5 minutes. Dynamic model routing for autonomous agents. Agents earn CCM tokens on Solana.

[![PyPI version](https://img.shields.io/pypi/v/wzrd-client.svg)](https://pypi.org/project/wzrd-client/)
[![npm version](https://img.shields.io/npm/v/@wzrd_sol/sdk.svg)](https://www.npmjs.com/package/@wzrd_sol/sdk)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## Quickstart (Python)

```bash
pip install wzrd-client
```

```python
import wzrd

model = wzrd.pick("code")           # → "Qwen/Qwen3.5-35B-A3B"
details = wzrd.pick_details("code") # score, trend, confidence
top_5 = wzrd.shortlist("code", 5)   # ranked list
```

No API key. No account. Works immediately.

**Task types**: `code`, `chat`, `reasoning`, `math`, `multilingual` — or any string.

## Quickstart (TypeScript)

```bash
npm install @wzrd_sol/sdk
```

```typescript
import { bestModel } from '@wzrd_sol/sdk';

const picks = await bestModel({ task: 'code', budget: 'micro' });
console.log(picks[0].model_id);
```

**Framework plugins** on npm:
- [`@wzrd_sol/eliza-plugin`](https://www.npmjs.com/package/@wzrd_sol/eliza-plugin) — ElizaOS
- [`@wzrd_sol/solana-agent-plugin`](https://www.npmjs.com/package/@wzrd_sol/solana-agent-plugin) — Solana Agent Kit
- [`@wzrd_sol/goat-plugin`](https://www.npmjs.com/package/@wzrd_sol/goat-plugin) — GOAT SDK

---

## Why WZRD

- **Save money** — models change weekly. The one you hardcoded is probably 10x more expensive than the trending alternative.
- **Better results** — momentum is a leading indicator. Models gaining adoption fast are usually improving fast.
- **Trustless on-chain oracles** — 9 Switchboard feeds on Solana mainnet. Verify any signal independently.
- **Get paid** — agents that report inference results earn CCM tokens through a gasless relay.

## Use Cases

- **Autonomous agents** that always pick the fastest/cheapest/best model
- **Multi-agent orchestration** (CrewAI, LangGraph, AutoGen, Eliza)
- **MCP clients** (Claude Code, Cursor) — 26 tools via MCP server
- **On-chain protocols** that need verifiable model selection data

---

## Earn CCM Tokens (optional)

Agents that report which model they picked — and what happened — earn CCM on Solana. The usage data improves the oracle, so WZRD pays for it.

```python
wzrd.run_loop()
# authenticates → picks models → runs inference → reports → claims CCM
```

Or with auto-staking:

```python
wzrd.run_loop(stake=True)
# authenticates → reports → claims → auto-stakes (7-day lock, 1.25x boost)
```

**What you need**: Nothing. The client auto-generates a Solana keypair at `~/.config/solana/wzrd-agent.json` on first run. Claims are gasless — no SOL needed.

CLI equivalent:

```bash
wzrd run --stake                 # earn loop with auto-stake
wzrd stake all --lock=30         # stake full balance, 30-day lock (~7% APR)
wzrd rewards --claim             # claim staking rewards
```

---

## Full Python API

| Function | Description |
|----------|-------------|
| `wzrd.pick(task)` | Best model name for the task |
| `wzrd.pick_details(task)` | Structured result: score, trend, confidence |
| `wzrd.shortlist(task, limit)` | Top-N ranked models |
| `wzrd.compare(model_a, model_b)` | Head-to-head signal comparison |
| `wzrd.pick_onchain(task)` | Reads Switchboard feeds directly (trustless) |
| `wzrd.run_loop(...)` | Complete earn loop: pick → infer → report → claim |

## Candidate-Aware Routing

Constrain picks to models you actually have access to:

```python
model = wzrd.pick(
    "code",
    candidates=[
        "openrouter/qwen/qwen3.5-9b",
        "openrouter/qwen/qwen3.5-35b-a3b",
        "anthropic/claude-sonnet-4.6",
    ],
)
```

## Agent Auth

```python
agent = wzrd.WZRDAgent.from_env()
session = agent.authenticate()
receipt = agent.report_pick(choice, quality_score=0.9, latency_ms=1200)
status = agent.earned()
```

Keypair loading: `~/.config/solana/id.json`, `WZRD_AGENT_KEYPAIR_PATH`, `WZRD_AGENT_KEYPAIR` (base58 or JSON byte array).

---

## Public REST API

```
GET https://api.twzrd.xyz/v1/signals/momentum
```

Full OpenAPI spec: [api.twzrd.xyz/openapi.json](https://api.twzrd.xyz/openapi.json)

## On-Chain Oracles

9 Switchboard pull feeds on Solana mainnet (7 velocity + 2 price):

| Feed | Address |
|------|---------|
| Qwen 3.5 9B | `AepiFwnbfCvXwA5gtAysMaxoqdwsGiYCN6gFBLGqZf1S` |
| Llama 3.3 70B | `6EgRwhE6db1Aqsxzmp9wj6QH2y5ZEji1xe1YdovwmD9g` |
| Kimi K2.5 | `5xmwRtTgcCz6R2KapxpEXVjCNcZCpe24DnCC295S769w` |
| Qwen3-Coder-Next | `g3RRSmg4PJjDNCq3jkTutMB8431UMMtRTNBRpc7UfVV` |

Full registry: `wzrd.oracle.list_feeds()`

## On-Chain Identifiers

| Item | Address |
|------|---------|
| AO Program | `GnGzNdsQMxMpJfMeqnkGPsvHm8kwaDidiKjNU2dCVZop` |
| CCM Mint | `Dxk8mAb3C7AM8JN6tAJfVuSja5yidhZM5sEKW3SRX2BM` |
| vLOFI Mint | `E9Kt33axpCy3ve2PCY9BSrbPhcR9wdDsWQECAahzw2dS` |

---

## Links

- [twzrd.xyz/start](https://twzrd.xyz/start) — onboarding
- [twzrd.xyz/feed](https://twzrd.xyz/feed) — live velocity feed
- [MCP guide](https://twzrd.xyz/mcp-guide.md) — connect to Claude Code / Cursor
- [PyPI](https://pypi.org/project/wzrd-client/) — Python package
- [npm](https://www.npmjs.com/package/@wzrd_sol/sdk) — TypeScript SDK

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `WZRD_API_URL` | Signal endpoint override |
| `WZRD_AGENT_KEYPAIR_PATH` | Path to Solana JSON keypair |
| `WZRD_AGENT_KEYPAIR` | Base58 secret or JSON byte array |
| `WZRD_TIMEOUT_SECONDS` | Request timeout |
| `WZRD_CACHE_TTL_SECONDS` | Cache TTL for fetched signals |

## License

MIT
