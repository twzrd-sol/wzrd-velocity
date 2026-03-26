# SDK Examples

Minimal, production-grade agent patterns for the WZRD Liquid Attention Protocol.

## Deposit Pattern

**File**: `deposit.ts`

Deposit USDC into a market to mint vLOFI and accrue attention-weighted yield.

```bash
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com \
WZRD_KEYPAIR_PATH=~/.config/solana/id.json \
WZRD_MARKET_ID=6 \
WZRD_DEPOSIT_USDC=1 \
npx tsx sdk/examples/deposit.ts
```

## Claim Pattern

**Files**: `claim.ts`, `claim-v2.ts`

Claim CCM yield via merkle proof (self-signed or relay-sponsored).

```bash
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com \
WZRD_KEYPAIR_PATH=~/.config/solana/id.json \
npx tsx sdk/examples/claim.ts
```

## Exit Quote Pattern

**File**: `quote-ccm-exit.ts`

Query the market price for CCM -> USDC exit. Used by agents to decide whether to hold or sell.

```bash
CCM_AMOUNT_CLAIMABLE=10 \
npx tsx sdk/examples/quote-ccm-exit.ts
```

### What It Does

1. **Input**: amount of claimable CCM in whole-token UI units (for example `10` = 10 CCM)
2. **Query**: calls the repo-standard Jupiter quote surface for `CCM -> USDC`
3. **Output**: quote with:
   - `routeFound`: boolean
   - `quotedUsdcAmountUi`: quoted USDC output
   - `pricePerCcmUsd`: current quoted price
   - `priceImpactPct`: route impact
   - `routeLabels`: venue path labels
   - `recommendation`: `hold` | `exit_marginal` | `exit_viable`

### Important Note

- CCM is `9` decimals on-chain.
- USDC is `6` decimals on-chain.
- The example treats Jupiter quote output as the canonical read-only route estimate.
- It does **not** manually subtract an extra Token-2022 transfer fee from quoted USDC output, to avoid double-counting execution-path handling.

### Agent Decision Logic

```typescript
const quote = await quoteExitValue(claimableAmountUi);

if (!quote.routeFound) {
  await holdPosition();
} else if (quote.recommendation === 'exit_viable') {
  await executeExit();
} else if (quote.recommendation === 'exit_marginal') {
  await evaluateStrategy();
} else {
  await holdPosition();
}
```

## Common Patterns

All examples share:
- `_shared.ts` for utilities
- environment variable validation
- clear error messages
- fail-closed behavior

## Running Locally

```bash
npm install

CCM_AMOUNT_CLAIMABLE=1 \
  npx tsx sdk/examples/quote-ccm-exit.ts
```

## Related Docs

- [CCM Liquidity Plan](../../docs/ccm-liquidity-plan.md)
- [SDK README](../README.md)
- Operator Scripts: `scripts/check-ccm-liquidity.mjs`
