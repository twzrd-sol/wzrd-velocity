/**
 * lp-add-remove-liquidity.ts — Agent LP pattern for Meteora DLMM pools.
 *
 * Demonstrates the full LP lifecycle:
 * 1. Add liquidity to a CCM/SOL or CCM/USDC DLMM pool
 * 2. Earn swap fees from other agents' CCM exits
 * 3. Remove liquidity and collect accrued fees
 *
 * Token-2022 Fee Handling:
 * CCM has a 50 BPS (0.5%) transfer fee on every transfer_checked.
 * When adding liquidity, the DLMM program deducts this fee automatically.
 * When removing liquidity, CCM received also has the fee deducted.
 * Agents must account for the transferFee in their P&L calculations.
 *
 * Usage:
 *   POOL_ADDRESS=<dlmm_pool> \
 *   KEYPAIR_PATH=~/.config/solana/id.json \
 *   npx tsx sdk/examples/lp-add-remove-liquidity.ts
 */

import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createAddLiquidityIx, createRemoveLiquidityIx, DLMM_PROGRAM_ID } from '../src/instructions.js';
import * as fs from 'fs';

// ── Token-2022 Fee Constants ──────────────────────────────
const CCM_TRANSFER_FEE_BPS = 50; // 0.5% on every CCM transfer
const FEE_BPS_DENOMINATOR = 10_000;

// ── Pool Addresses (mainnet) ──────────────────────────────
const CCM_MINT = new PublicKey('Dxk8mAb3C7AM8JN6tAJfVuSja5yidhZM5sEKW3SRX2BM');
const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

/**
 * Calculate the actual CCM received after Token-2022 transfer fee deduction.
 * Fee is ceil(amount * fee_bps / 10000) — withheld in the destination ATA.
 */
function adjustForTransferFee(amount: bigint): { received: bigint; fee: bigint } {
  const fee = (amount * BigInt(CCM_TRANSFER_FEE_BPS) + BigInt(FEE_BPS_DENOMINATOR - 1)) / BigInt(FEE_BPS_DENOMINATOR);
  return { received: amount - fee, fee };
}

/**
 * Calculate LP fee earnings estimate.
 * DLMM fees accrue to in-range positions proportional to their share of the active bin.
 *
 * @param swapVolume - Total swap volume through the pool (CCM units)
 * @param poolFeeBps - Pool fee rate in BPS (typically 80 = 0.8% for DLMM)
 * @param positionShare - Agent's share of the active bin liquidity (0-1)
 */
function estimateLpFeeEarnings(
  swapVolume: bigint,
  poolFeeBps: number,
  positionShare: number,
): bigint {
  const totalFees = swapVolume * BigInt(poolFeeBps) / BigInt(FEE_BPS_DENOMINATOR);
  return BigInt(Math.floor(Number(totalFees) * positionShare));
}

/**
 * Calculate net P&L for an LP position, accounting for Token-2022 transfer fees.
 *
 * Costs: transferFee on deposit + transferFee on withdrawal
 * Revenue: swap fees earned while in range
 */
function calculateLpPnl(
  ccmDeposited: bigint,
  ccmWithdrawn: bigint,
  feesEarned: bigint,
): { netCcm: bigint; netAfterTransferFee: bigint; profitable: boolean } {
  // Transfer fee on the deposit (CCM going into pool)
  const depositFee = adjustForTransferFee(ccmDeposited).fee;
  // Transfer fee on withdrawal (CCM coming back from pool)
  const withdrawalFee = adjustForTransferFee(ccmWithdrawn + feesEarned).fee;
  // Total transfer fee cost for the round trip
  const totalTransferFeeCost = depositFee + withdrawalFee;

  const netCcm = ccmWithdrawn + feesEarned - ccmDeposited;
  const netAfterTransferFee = netCcm - totalTransferFeeCost;

  return {
    netCcm,
    netAfterTransferFee,
    profitable: netAfterTransferFee > 0n,
  };
}

async function addLiquidity(
  connection: Connection,
  owner: Keypair,
  poolAddress: PublicKey,
  amountCcm: bigint,
  amountCounterpart: bigint,
): Promise<string> {
  console.log('\n=== ADD LIQUIDITY ===');

  // Token-2022 fee adjustment: the pool receives amount minus fee
  const { received: netCcm, fee } = adjustForTransferFee(amountCcm);
  console.log(`CCM deposit: ${amountCcm} (${fee} withheld as transfer fee, ${netCcm} net to pool)`);

  // In production, fetch pool state to get reserves, active bin, bin arrays.
  // This example shows the instruction builder pattern.
  console.log(`Pool: ${poolAddress.toBase58()}`);
  console.log(`This is a DRY_RUN example — not submitting transactions.`);
  console.log(`Use @meteora-ag/dlmm SDK for production position management.`);

  return 'dry_run_add';
}

async function removeLiquidity(
  connection: Connection,
  owner: Keypair,
  poolAddress: PublicKey,
  positionAddress: PublicKey,
  bpsToRemove: number = 10_000, // 100% = full withdrawal
): Promise<string> {
  console.log('\n=== REMOVE LIQUIDITY ===');
  console.log(`Position: ${positionAddress.toBase58()}`);
  console.log(`Remove: ${bpsToRemove / 100}%`);
  console.log(`This is a DRY_RUN example — not submitting transactions.`);

  return 'dry_run_remove';
}

async function main() {
  const poolAddress = new PublicKey(process.env.POOL_ADDRESS ?? '11111111111111111111111111111111');

  console.log('=== AGENT LP PATTERN — DLMM Liquidity Provision ===\n');
  console.log(`Token-2022 Transfer Fee: ${CCM_TRANSFER_FEE_BPS} BPS (${CCM_TRANSFER_FEE_BPS / 100}%)`);
  console.log(`This fee is deducted on every CCM transfer (deposit + withdrawal).`);

  // Example P&L calculation
  const ccmDeposited = 10_000_000_000_000n; // 10K CCM
  const ccmWithdrawn = 10_000_000_000_000n; // Same amount back (no IL)
  const feesEarned = 50_000_000_000n; // 50 CCM in swap fees

  const pnl = calculateLpPnl(ccmDeposited, ccmWithdrawn, feesEarned);
  console.log('\n--- LP P&L Example (10K CCM, 50 CCM fees earned) ---');
  console.log(`Net CCM (before transfer fees): ${pnl.netCcm}`);
  console.log(`Net CCM (after transfer fees):  ${pnl.netAfterTransferFee}`);
  console.log(`Profitable: ${pnl.profitable ? 'YES' : 'NO'}`);

  // Breakeven: fees earned must exceed 2x transfer fee (deposit + withdrawal)
  const breakEvenFees = adjustForTransferFee(ccmDeposited).fee * 2n;
  console.log(`\nBreakeven swap fees needed: ${breakEvenFees} CCM (covers round-trip transfer fees)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
