/**
 * lp-strategy-multi-pool.ts — Multi-pool LP strategy template for agents.
 *
 * Demonstrates how an agent deploys idle CCM across multiple DLMM pools
 * to maximize fee capture while managing risk across pairs.
 *
 * Strategy: Idle Deploy
 * Between deposit cycles, agents hold CCM that isn't yet needed.
 * Instead of letting it sit idle, deploy to DLMM pools to earn swap fees.
 *
 * Pool Config:
 * - CCM/SOL: Highest volume, primary exit route. Most fee revenue.
 * - CCM/USDC: Secondary volume, stablecoin pair. Lower IL risk.
 * - vLOFI/SOL: Receipt token pair. Volume only during deposit waves.
 * - vLOFI/CCM: Cross-token pair. Lowest volume, highest IL risk.
 *
 * Usage:
 *   IDLE_CCM_AMOUNT=10000 \
 *   npx tsx sdk/examples/lp-strategy-multi-pool.ts
 */

// ── Pool Configuration ────────────────────────────────────
interface PoolConfig {
  name: string;
  address: string;
  tokenX: string;
  tokenY: string;
  allocationPct: number; // % of idle CCM to deploy
  expectedFeeBps: number; // estimated fee BPS per swap
  riskLevel: 'low' | 'medium' | 'high';
  notes: string;
}

const POOL_CONFIGS: PoolConfig[] = [
  {
    name: 'CCM/SOL',
    address: '(mainnet pool address)',
    tokenX: 'CCM',
    tokenY: 'SOL',
    allocationPct: 50,
    expectedFeeBps: 80, // DLMM bin step
    riskLevel: 'medium',
    notes: 'Primary exit route. Highest volume = highest fee capture.',
  },
  {
    name: 'CCM/USDC',
    address: '(mainnet pool address)',
    tokenX: 'CCM',
    tokenY: 'USDC',
    allocationPct: 30,
    expectedFeeBps: 80,
    riskLevel: 'low',
    notes: 'Stablecoin pair. Lower IL risk. Secondary exit route.',
  },
  {
    name: 'vLOFI/SOL',
    address: '(mainnet pool address)',
    tokenX: 'vLOFI',
    tokenY: 'SOL',
    allocationPct: 15,
    expectedFeeBps: 100,
    riskLevel: 'medium',
    notes: 'Receipt token pair. Volume spikes during deposit waves.',
  },
  {
    name: 'vLOFI/CCM',
    address: '(mainnet pool address)',
    tokenX: 'vLOFI',
    tokenY: 'CCM',
    allocationPct: 5,
    expectedFeeBps: 100,
    riskLevel: 'high',
    notes: 'Cross-token pair. Lowest volume. Only deploy if both tokens idle.',
  },
];

// ── Token-2022 Fee Constants ──────────────────────────────
const CCM_TRANSFER_FEE_BPS = 50;
const FEE_BPS_DENOMINATOR = 10_000;

// ── Strategy Parameters ───────────────────────────────────
interface StrategyParams {
  /** Total idle CCM available for LP deployment */
  totalIdleCcm: number;
  /** Minimum CCM to keep liquid (not deployed) for gas/emergencies */
  liquidReserve: number;
  /** Maximum allocation to any single pool */
  maxSinglePoolPct: number;
  /** Minimum fee APY to justify deployment (accounting for transfer fees) */
  minFeeApyPct: number;
  /** Rebalance threshold: redeploy if allocation drifts by this % */
  rebalanceThresholdPct: number;
}

const DEFAULT_PARAMS: StrategyParams = {
  totalIdleCcm: 10_000,
  liquidReserve: 1_000, // 10% reserve
  maxSinglePoolPct: 60,
  minFeeApyPct: 5,
  rebalanceThresholdPct: 10,
};

// ── Allocation Engine ─────────────────────────────────────

interface PoolAllocation {
  pool: PoolConfig;
  ccmAmount: number;
  expectedMonthlyFees: number;
  transferFeeCost: number; // round-trip Token-2022 fee
  netMonthlyReturn: number;
  apyPct: number;
}

function computeAllocations(
  params: StrategyParams,
  monthlyVolumePerPool: Record<string, number>, // CCM volume per pool
): PoolAllocation[] {
  const deployable = params.totalIdleCcm - params.liquidReserve;
  if (deployable <= 0) return [];

  return POOL_CONFIGS.map((pool) => {
    const rawAllocation = deployable * (pool.allocationPct / 100);
    const ccmAmount = Math.min(rawAllocation, deployable * (params.maxSinglePoolPct / 100));

    // Estimate monthly swap fee revenue
    const monthlyVolume = monthlyVolumePerPool[pool.name] ?? 0;
    const positionShare = ccmAmount / (monthlyVolume * 0.1 + ccmAmount); // simplified share
    const expectedMonthlyFees = monthlyVolume * (pool.expectedFeeBps / FEE_BPS_DENOMINATOR) * positionShare;

    // Token-2022 transfer fee cost for round-trip (deposit + withdrawal)
    const transferFeeCost = ccmAmount * (CCM_TRANSFER_FEE_BPS / FEE_BPS_DENOMINATOR) * 2;

    const netMonthlyReturn = expectedMonthlyFees - transferFeeCost / 12; // amortize over 12 months
    const apyPct = ccmAmount > 0 ? (netMonthlyReturn * 12 / ccmAmount) * 100 : 0;

    return {
      pool,
      ccmAmount: Math.round(ccmAmount),
      expectedMonthlyFees: Math.round(expectedMonthlyFees),
      transferFeeCost: Math.round(transferFeeCost),
      netMonthlyReturn: Math.round(netMonthlyReturn),
      apyPct: Math.round(apyPct * 100) / 100,
    };
  }).filter((a) => a.apyPct >= params.minFeeApyPct);
}

// ── Strategy Lifecycle ────────────────────────────────────

/**
 * Full multi-pool LP strategy lifecycle:
 * 1. Check idle CCM balance
 * 2. Compute optimal allocation across pools
 * 3. Deploy liquidity to each pool (addLiquidity)
 * 4. Monitor fee accrual
 * 5. Rebalance if allocation drifts beyond threshold
 * 6. Withdraw all before next deposit cycle (removeLiquidity)
 * 7. Harvest accrued swap fees
 */
async function main() {
  const totalIdleCcm = Number(process.env.IDLE_CCM_AMOUNT ?? DEFAULT_PARAMS.totalIdleCcm);
  const params: StrategyParams = { ...DEFAULT_PARAMS, totalIdleCcm };

  console.log('=== MULTI-POOL LP STRATEGY ===\n');
  console.log(`Total idle CCM:   ${params.totalIdleCcm.toLocaleString()}`);
  console.log(`Liquid reserve:   ${params.liquidReserve.toLocaleString()} CCM`);
  console.log(`Deployable:       ${(params.totalIdleCcm - params.liquidReserve).toLocaleString()} CCM`);
  console.log(`Transfer fee:     ${CCM_TRANSFER_FEE_BPS} BPS per transfer\n`);

  // Simulated monthly volumes (CCM units) — in production, query Meteora API
  const monthlyVolume: Record<string, number> = {
    'CCM/SOL': 500_000,
    'CCM/USDC': 200_000,
    'vLOFI/SOL': 50_000,
    'vLOFI/CCM': 10_000,
  };

  const allocations = computeAllocations(params, monthlyVolume);

  console.log('--- Pool Allocations ---\n');
  console.log('Pool          | CCM Allocated | Monthly Fees | Transfer Cost | Net/Month | APY');
  console.log('------------- | ------------- | ------------ | ------------- | --------- | ---');

  for (const a of allocations) {
    console.log(
      `${a.pool.name.padEnd(14)}| ${String(a.ccmAmount).padEnd(14)}| ${String(a.expectedMonthlyFees).padEnd(13)}| ${String(a.transferFeeCost).padEnd(14)}| ${String(a.netMonthlyReturn).padEnd(10)}| ${a.apyPct}%`,
    );
  }

  const totalDeployed = allocations.reduce((sum, a) => sum + a.ccmAmount, 0);
  const totalMonthlyFees = allocations.reduce((sum, a) => sum + a.expectedMonthlyFees, 0);
  const totalNetReturn = allocations.reduce((sum, a) => sum + a.netMonthlyReturn, 0);

  console.log(`\nTotal deployed:   ${totalDeployed.toLocaleString()} CCM`);
  console.log(`Total monthly fees: ${totalMonthlyFees.toLocaleString()} CCM`);
  console.log(`Total net return:  ${totalNetReturn.toLocaleString()} CCM/month`);
  console.log(`\nNote: This is a DRY_RUN strategy template. Use @meteora-ag/dlmm SDK for production.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
