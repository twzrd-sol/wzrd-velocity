# Trading CCM & vLOFI with outsmart-cli

Trade WZRD tokens on Solana using [outsmart-cli](https://github.com/outsmartchad/outsmart-cli) — the 18-DEX unified CLI.

## Token Addresses

| Token | Mint | Type | Transfer Fee |
|-------|------|------|-------------|
| CCM | `Dxk8mAb3C7AM8JN6tAJfVuSja5yidhZM5sEKW3SRX2BM` | Token-2022 | 50 BPS |
| vLOFI | `E9Kt33axpCy3ve2PCY9BSrbPhcR9wdDsWQECAahzw2dS` | Standard SPL | None |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | Standard SPL | None |

## Pools

| Pool | Address | DEX | Depth |
|------|---------|-----|-------|
| CCM/USDC | `6FwqFJb345DvhNWJGdjnnKNefkxH1VaQznWwQgurssmm` | Meteora DAMM v2 | ~$1,200 |
| vLOFI/CCM | `CEt6qy87ozwmoTGeSXyx4eSD1w33LvRrGA645d67yH3M` | Meteora DLMM | ~$170 |
| vLOFI/SOL | `ArHs7u5WdbBpT7nZkYUEC3xCjcxgRWwokfFNHQCm1dmo` | Meteora DLMM | Low |
| CCM/SOL | `DNRa8GXorshkm371ezv9nmwG9q59iKuLtZFsdM6kJMAL` | Meteora DLMM | Out of range |

## Buy CCM

```bash
# Via Jupiter Ultra (auto-routes through Meteora DAMM v2)
outsmart buy --dex jupiter-ultra \
  --input-mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --output-mint Dxk8mAb3C7AM8JN6tAJfVuSja5yidhZM5sEKW3SRX2BM \
  --amount 1000000 \
  --slippage 500

# Via DFlow (finds routes Jupiter misses for Token-2022)
outsmart buy --dex dflow \
  --input-mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --output-mint Dxk8mAb3C7AM8JN6tAJfVuSja5yidhZM5sEKW3SRX2BM \
  --amount 1000000 \
  --slippage 500
```

## Sell CCM

```bash
outsmart sell --dex dflow \
  --input-mint Dxk8mAb3C7AM8JN6tAJfVuSja5yidhZM5sEKW3SRX2BM \
  --output-mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --amount 100000000000 \
  --slippage 500
```

## Swap CCM → vLOFI (stake via market)

```bash
outsmart swap --dex meteora-dlmm \
  --input-mint Dxk8mAb3C7AM8JN6tAJfVuSja5yidhZM5sEKW3SRX2BM \
  --output-mint E9Kt33axpCy3ve2PCY9BSrbPhcR9wdDsWQECAahzw2dS \
  --amount 1000000000000 \
  --slippage 500
```

## Programmatic (Node.js)

```typescript
import { getDexAdapter } from "outsmart";

const dflow = getDexAdapter("dflow");

// Buy 1 USDC worth of CCM
const quote = await dflow.getQuote({
  inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  outputMint: "Dxk8mAb3C7AM8JN6tAJfVuSja5yidhZM5sEKW3SRX2BM",
  amount: 1_000_000, // 1 USDC
  slippageBps: 500,
});

console.log(`${quote.outAmount} CCM for 1 USDC`);
```

## Pool Status (via outsmart)

```bash
# Check Meteora DAMM v2 pool
outsmart pool-info --dex meteora-damm-v2 \
  --pool 6FwqFJb345DvhNWJGdjnnKNefkxH1VaQznWwQgurssmm

# Check Meteora DLMM pool
outsmart pool-info --dex meteora-dlmm \
  --pool CEt6qy87ozwmoTGeSXyx4eSD1w33LvRrGA645d67yH3M
```

## Why Trade CCM?

CCM is the settlement token of the WZRD Liquid Attention Protocol — an on-chain velocity oracle for AI models. 50 autonomous agents score 100+ models across HuggingFace, GitHub, OpenRouter, and ArtificialAnalysis every 5 minutes.

- **Earned, not minted** — agents earn CCM by reporting model velocity
- **50 BPS transfer fee** — every movement funds protocol operations
- **Compound yield** — stake CCM → earn vLOFI (exchange rate: 0.678 CCM/vLOFI, rising)
- **9 Switchboard oracle feeds** — 7 velocity + 2 price feeds readable by any Solana program

**Price:** ~$0.001122 | **DEXScreener:** [View chart](https://dexscreener.com/solana/6fwqfjb345dvhnwjgdjnnknefkxh1vaqznwwqgurssmm)

## Links

- [WZRD Protocol](https://twzrd.xyz)
- [Signal API](https://api.twzrd.xyz/v1/signals/momentum/premium)
- [wzrd-client (PyPI)](https://pypi.org/project/wzrd-client/)
- [@wzrd_sol/sdk (npm)](https://www.npmjs.com/package/@wzrd_sol/sdk)
