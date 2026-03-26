/**
 * quote-ccm-exit.ts — agent-facing CCM exit quote example.
 *
 * Demonstrates the smallest agent pattern:
 * 1. Know your claimable CCM amount
 * 2. Query Jupiter for CCM -> USDC price
 * 3. Treat Jupiter output as the canonical read-only route estimate
 * 4. Make an exit decision (hold vs sell)
 *
 * Usage:
 *   CCM_AMOUNT_CLAIMABLE=10 \
 *   npx tsx sdk/examples/quote-ccm-exit.ts
 */

const CCM_MINT = 'Dxk8mAb3C7AM8JN6tAJfVuSja5yidhZM5sEKW3SRX2BM';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const CCM_DECIMALS = 9;
const USDC_DECIMALS = 6;
const DEFAULT_SLIPPAGE_BPS = 50;
const DEFAULT_MIN_EXIT_USDC = 0.01;
const JUPITER_QUOTE_URL = 'https://lite-api.jup.ag/swap/v1/quote';

// CCM is Token-2022 with 50 BPS transfer fee on every transfer_checked.
// Jupiter already accounts for this in quoted output, but agents should
// know the fee exists for manual transfer calculations.
const CCM_TRANSFER_FEE_BPS = 50;

export interface ExitQuote {
  routeFound: boolean;
  ccmAmountUi: string;
  ccmAmountNative: string;
  quotedUsdcAmountUi: string;
  quotedUsdcAmountNative: string;
  pricePerCcmUsd: number;
  priceImpactPct: number;
  routeLabels: string[];
  recommendation: 'hold' | 'exit_viable' | 'exit_marginal';
  note: string;
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function formatUnits(amount: bigint, decimals: number, fractionDigits = 6): string {
  return (Number(amount) / 10 ** decimals).toFixed(fractionDigits);
}

function uiToNative(uiAmount: string, decimals: number): bigint {
  const parsed = Number.parseFloat(uiAmount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive token amount: ${uiAmount}`);
  }
  return BigInt(Math.round(parsed * 10 ** decimals));
}

function uniqueLabels(routePlan: Array<{ swapInfo?: { label?: string } }> = []): string[] {
  return [...new Set(routePlan.map((hop) => hop.swapInfo?.label).filter(Boolean) as string[])];
}

async function fetchJupiterQuote(ccmAmountNative: string): Promise<{
  ok: true;
  quote: {
    outAmount: string;
    priceImpactPct: string;
    routePlan?: Array<{ swapInfo?: { label?: string } }>;
  };
} | {
  ok: false;
}> {
  try {
    const params = new URLSearchParams({
      inputMint: CCM_MINT,
      outputMint: USDC_MINT,
      amount: ccmAmountNative,
      slippageBps: String(DEFAULT_SLIPPAGE_BPS),
    });

    const response = await fetch(`${JUPITER_QUOTE_URL}?${params}`, {
      headers: { 'User-Agent': 'wzrd-sdk-example/1.0' },
    });

    if (!response.ok) {
      return { ok: false };
    }

    return {
      ok: true,
      quote: (await response.json()) as {
        outAmount: string;
        priceImpactPct: string;
        routePlan?: Array<{ swapInfo?: { label?: string } }>;
      },
    };
  } catch {
    return { ok: false };
  }
}

export async function quoteExitValue(ccmAmountUi: string): Promise<ExitQuote> {
  const amountNative = uiToNative(ccmAmountUi, CCM_DECIMALS);
  const result = await fetchJupiterQuote(amountNative.toString());

  if (!result.ok) {
    return {
      routeFound: false,
      ccmAmountUi,
      ccmAmountNative: amountNative.toString(),
      quotedUsdcAmountUi: '0.000000',
      quotedUsdcAmountNative: '0',
      pricePerCcmUsd: 0,
      priceImpactPct: 100,
      routeLabels: [],
      recommendation: 'hold',
      note: 'No Jupiter route found for CCM -> USDC.',
    };
  }

  const outAmount = BigInt(result.quote.outAmount);
  const quotedUsdcAmountUi = formatUnits(outAmount, USDC_DECIMALS);
  const pricePerCcmUsd = Number(quotedUsdcAmountUi) / Number.parseFloat(ccmAmountUi);
  const priceImpactPct = Number(result.quote.priceImpactPct);
  const routeLabels = uniqueLabels(result.quote.routePlan);

  let recommendation: ExitQuote['recommendation'] = 'hold';
  if (Number(quotedUsdcAmountUi) >= DEFAULT_MIN_EXIT_USDC && priceImpactPct < 2) {
    recommendation = 'exit_viable';
  } else if (Number(quotedUsdcAmountUi) >= DEFAULT_MIN_EXIT_USDC && priceImpactPct < 5) {
    recommendation = 'exit_marginal';
  }

  return {
    routeFound: true,
    ccmAmountUi,
    ccmAmountNative: amountNative.toString(),
    quotedUsdcAmountUi,
    quotedUsdcAmountNative: outAmount.toString(),
    pricePerCcmUsd,
    priceImpactPct,
    routeLabels,
    recommendation,
    note: `Jupiter quote is canonical. CCM transfer fee: ${CCM_TRANSFER_FEE_BPS} BPS (deducted automatically by Token-2022).`,
  };
}

async function main() {
  const ccmAmountUi = requireEnv('CCM_AMOUNT_CLAIMABLE');
  const minExitGate = Number.parseFloat(process.env.MIN_EXIT_USDC ?? String(DEFAULT_MIN_EXIT_USDC));

  console.log('=== CCM EXIT QUOTE (Agent Pattern) ===\n');
  console.log(`CCM Available: ${ccmAmountUi}`);
  console.log(`Min exit gate: ${minExitGate.toFixed(6)} USDC`);

  const quote = await quoteExitValue(ccmAmountUi);

  console.log(`\nRoute Found: ${quote.routeFound ? '✅ Yes' : '❌ No'}`);

  if (quote.routeFound) {
    console.log(`Quoted Output:   ${quote.quotedUsdcAmountUi} USDC`);
    console.log(`Price per CCM:   ${quote.pricePerCcmUsd.toFixed(6)} USDC`);
    console.log(`Price Impact:    ${quote.priceImpactPct.toFixed(6)}%`);
    console.log(`Route Labels:    ${quote.routeLabels.join(', ') || 'unknown'}`);
    console.log(`\n→ Recommendation: ${quote.recommendation.toUpperCase()}`);
    console.log(`\nNote: ${quote.note}`);
  } else {
    console.log('\n❌ No route available. Agent should hold CCM and try again later.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
