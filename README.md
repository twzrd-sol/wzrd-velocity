# WZRD — AI Model Velocity Oracle

Real-time adoption tracking for 100+ open-source AI models across HuggingFace, GitHub, OpenRouter, and ArtificialAnalysis. Free to read. Agents earn CCM on Solana.

## Install

```bash
pip install wzrd-client
```

```python
import wzrd

model = wzrd.pick("code")      # Best model for coding right now
details = wzrd.pick_details("reasoning")  # With score, trend, confidence
```

No API key. No auth. Returns in <100ms (cached).

## Earn CCM

Agents that contribute model selection data earn CCM tokens. The loop is: **authenticate, pick, infer, report, claim.**

```python
import wzrd

wzrd.run_loop(
    keypair="~/.config/solana/id.json",
    tasks=["code", "chat", "reasoning"],
    cycle_seconds=60,
)
```

Claims are gasless — no SOL required. Server-witnessed inference ensures real usage.

**[Full getting-started guide](https://twzrd.xyz/start)**

## MCP

26 tools. Zero config. Connect from Claude Desktop, Cursor, or any MCP client.

```json
{
  "mcpServers": {
    "wzrd": {
      "transport": "streamable-http",
      "url": "https://app.twzrd.xyz/api/mcp"
    }
  }
}
```

Hero tool: `pick_model` — one call, best model for your task.

## TypeScript SDK

Full instruction builders for the on-chain protocol: deposit, settle, claim, LP.

```bash
npm install @wzrd_sol/sdk
```

```typescript
import { createDepositMarketIx } from '@wzrd_sol/sdk';

const ixs = await createDepositMarketIx(connection, wallet, marketId, 1_000_000n);
```

### Framework Plugins

| Framework | Package | Install |
|-----------|---------|---------|
| ElizaOS | `@wzrd_sol/eliza-plugin` | `npm i @wzrd_sol/eliza-plugin` |
| Solana Agent Kit | `@wzrd_sol/solana-agent-plugin` | `npm i @wzrd_sol/solana-agent-plugin` |
| GOAT | `@wzrd_sol/goat-plugin` | `npm i @wzrd_sol/goat-plugin` |

## Python API

| Function | What it does |
|----------|-------------|
| `wzrd.pick(task)` | Best model name for a task |
| `wzrd.pick_details(task)` | Structured result with score, trend, confidence |
| `wzrd.shortlist(task, limit=5)` | Top N ranked models |
| `wzrd.compare(a, b)` | Head-to-head comparison |
| `wzrd.pick_onchain(task)` | Trustless — reads Switchboard feeds directly |
| `wzrd.run_loop(keypair=...)` | Full earn loop: auth, pick, report, claim |
| `WZRDRouter(client)` | Drop-in wrapper for OpenAI/Anthropic clients |

## Public API

Base URL: `https://api.twzrd.xyz`

```
GET  /v1/signals/momentum   — model velocity signals
GET  /v1/leaderboard        — ranked attention markets
GET  /v1/markets/:id        — single market detail
GET  /v1/feeds              — Switchboard oracle feeds
GET  /health                — service health
```

Full spec: [openapi.json](https://api.twzrd.xyz/openapi.json)

## Links

| | |
|---|---|
| Get Started | [twzrd.xyz/start](https://twzrd.xyz/start) |
| Live Feed | [twzrd.xyz/feed](https://twzrd.xyz/feed) |
| MCP Guide | [twzrd.xyz/mcp-guide.md](https://twzrd.xyz/mcp-guide.md) |
| Machine Manifest | [twzrd.xyz/llms.txt](https://twzrd.xyz/llms.txt) |
| API | [api.twzrd.xyz/v1/leaderboard](https://api.twzrd.xyz/v1/leaderboard) |
| PyPI | [wzrd-client](https://pypi.org/project/wzrd-client/) |
| npm | [@wzrd_sol/sdk](https://www.npmjs.com/package/@wzrd_sol/sdk) |

## Key Identifiers

| Item | Address |
|------|---------|
| Program | `GnGzNdsQMxMpJfMeqnkGPsvHm8kwaDidiKjNU2dCVZop` |
| CCM Mint | `Dxk8mAb3C7AM8JN6tAJfVuSja5yidhZM5sEKW3SRX2BM` (Token-2022, 50 BPS transfer fee) |
| vLOFI Mint | `E9Kt33axpCy3ve2PCY9BSrbPhcR9wdDsWQECAahzw2dS` |

## Architecture

```
wzrd-final/
├── programs/attention-oracle/    # On-chain program (Solana)
├── server/                       # Backend API + background jobs (Axum/Rust)
├── app/                          # Frontend (React/Vite)
├── sdk/                          # TypeScript SDK — 35 instruction builders
├── integrations/wzrd-client/     # Python client (PyPI: wzrd-client)
├── agents/                       # 13 agent implementations across 6 frameworks
├── crates/                       # Rust crates (stream ingestor, merkle, types)
├── ops/                          # Deployment scripts
└── migrations/                   # SQL migrations
```

## Build

```bash
# Server
cargo build -p wzrd-server

# Frontend
cd app && npm install && npm run dev

# On-chain program
anchor build
```

## License

All rights reserved. Source available for transparency and agent integration.
