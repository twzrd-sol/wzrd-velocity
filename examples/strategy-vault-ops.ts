/**
 * strategy-vault-ops.ts — Strategy vault operations pattern.
 *
 * Demonstrates the Phase 2 yield strategy lifecycle:
 * 1. Initialize a StrategyVault — deploy treasury USDC to Kamino K-Lend
 * 2. DeployToStrategy — move idle USDC from the protocol vault into the lending pool
 * 3. Harvest yield — collect accrued lending interest
 * 4. Withdraw from strategy — pull funds back to the protocol vault
 *
 * On-chain modules used (programs/attention-oracle/src/instructions/strategy.rs):
 * - initialize_strategy_vault — creates the strategy vault PDA + reserve accounts
 * - deploy_to_strategy — deposits USDC into Kamino reserve via CPI
 * - harvest_strategy_yield — claims accrued interest
 * - withdraw_from_strategy — redeems collateral back to USDC
 *
 * The strategy vault keeps a 30% reserve (RESERVE_BPS = 3000) in the protocol
 * vault for immediate withdrawals. Only 70% of TVL is deployed to Kamino.
 *
 * Usage:
 *   npx tsx sdk/examples/strategy-vault-ops.ts
 */

import { PublicKey, SystemProgram } from '@solana/web3.js';
import { anchorDisc, createAtaIdempotentIx } from '../src/instructions.js';
import {
  PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '../src/constants.js';
import { getProtocolStatePDA, getMarketVaultPDA, getAta } from '../src/pda.js';

// ── Known Addresses (mainnet) ───────────────────────────
const CCM_MINT = new PublicKey('Dxk8mAb3C7AM8JN6tAJfVuSja5yidhZM5sEKW3SRX2BM');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const VLOFI_MINT = new PublicKey('E9Kt33axpCy3ve2PCY9BSrbPhcR9wdDsWQECAahzw2dS');

// Kamino K-Lend mainnet program + market (placeholder pubkeys for DRY_RUN)
// Replace with actual Kamino addresses when deploying to production.
const KAMINO_LENDING_PROGRAM = new PublicKey('11111111111111111111111111111112');
const KAMINO_MARKET = new PublicKey('11111111111111111111111111111112');

// ── Strategy Constants ──────────────────────────────────
const RESERVE_BPS = 3000;      // 30% kept liquid
const DEPLOY_BPS = 7000;       // 70% deployed to Kamino
const BPS_DENOMINATOR = 10_000;

interface StrategyVaultState {
  totalDeposited: bigint;
  deployedAmount: bigint;
  reserveAmount: bigint;
  lastHarvestSlot: number;
  accruedYield: bigint;
}

/**
 * Calculate how much USDC to deploy vs keep in reserve.
 * The protocol always keeps RESERVE_BPS (30%) liquid.
 */
function calculateDeployment(
  totalTvl: bigint,
  currentlyDeployed: bigint,
): { toDeploy: bigint; toReserve: bigint; delta: bigint } {
  const targetDeployed = (totalTvl * BigInt(DEPLOY_BPS)) / BigInt(BPS_DENOMINATOR);
  const targetReserve = totalTvl - targetDeployed;
  const delta = targetDeployed - currentlyDeployed;

  return {
    toDeploy: targetDeployed,
    toReserve: targetReserve,
    delta, // positive = need to deploy more, negative = need to withdraw
  };
}

/**
 * Estimate Kamino lending APY based on utilization rate.
 * Simplified model — in production, read the reserve state.
 */
function estimateKaminoApy(utilizationPct: number): number {
  // Kamino uses a kinked rate model
  if (utilizationPct < 80) {
    return utilizationPct * 0.05; // linear up to 80%
  }
  // Above 80% utilization, rate increases steeply
  return 4 + (utilizationPct - 80) * 0.5;
}

// ── Step 1: Initialize Strategy Vault ───────────────────

async function initializeStrategyVault(admin: PublicKey): Promise<void> {
  console.log('\n=== STEP 1: INITIALIZE STRATEGY VAULT ===');

  const protocolState = getProtocolStatePDA(PROGRAM_ID);
  console.log(`ProtocolState: ${protocolState.toBase58()}`);

  // The StrategyVault PDA is derived from the protocol state
  // In production this comes from strategy.rs seeds
  const disc = await anchorDisc('initialize_strategy_vault');
  console.log(`Discriminator: ${disc.toString('hex')}`);

  // The initialize instruction creates:
  // 1. StrategyVault PDA — tracks deployed amounts and yield
  // 2. Collateral ATA — holds Kamino kTokens (receipt tokens)
  // 3. Reserve ATA — holds USDC for immediate withdrawals
  console.log(`Kamino Program:   ${KAMINO_LENDING_PROGRAM.toBase58()}`);
  console.log(`Kamino Market:    ${KAMINO_MARKET.toBase58()}`);
  console.log(`Reserve ratio:    ${RESERVE_BPS / 100}%`);
  console.log(`Deploy ratio:     ${DEPLOY_BPS / 100}%`);
  console.log('This is a DRY_RUN example -- vault not created.');
}

// ── Step 2: Deploy to Strategy ──────────────────────────

async function deployToStrategy(
  admin: PublicKey,
  amount: bigint,
  state: StrategyVaultState,
): Promise<StrategyVaultState> {
  console.log('\n=== STEP 2: DEPLOY TO STRATEGY ===');

  const deployment = calculateDeployment(state.totalDeposited, state.deployedAmount);
  console.log(`Total TVL:         ${state.totalDeposited} native USDC`);
  console.log(`Currently deployed: ${state.deployedAmount}`);
  console.log(`Target deployed:   ${deployment.toDeploy}`);
  console.log(`Target reserve:    ${deployment.toReserve}`);
  console.log(`Delta to deploy:   ${deployment.delta}`);

  // Build the DeployToStrategy instruction
  // This performs a CPI into Kamino's deposit_reserve_liquidity
  const disc = await anchorDisc('deploy_to_strategy');
  console.log(`Discriminator: ${disc.toString('hex')}`);

  // Account layout for DeployToStrategy:
  // 0. admin (signer)
  // 1. protocol_state
  // 2. strategy_vault (writable)
  // 3. source_usdc_ata (writable) — protocol vault USDC
  // 4. kamino_reserve (writable)
  // 5. kamino_collateral_ata (writable) — kToken destination
  // 6. kamino_market
  // 7. kamino_program
  // 8. token_program
  console.log('Account layout: admin + protocol_state + strategy_vault + source + kamino_reserve + collateral + market + program');
  console.log('This is a DRY_RUN example -- USDC not deployed to Kamino.');

  return {
    ...state,
    deployedAmount: state.deployedAmount + amount,
    reserveAmount: state.reserveAmount - amount,
  };
}

// ── Step 3: Harvest Yield ───────────────────────────────

async function harvestStrategyYield(
  admin: PublicKey,
  state: StrategyVaultState,
  currentSlot: number,
): Promise<StrategyVaultState> {
  console.log('\n=== STEP 3: HARVEST STRATEGY YIELD ===');

  const slotsSinceHarvest = currentSlot - state.lastHarvestSlot;
  const utilizationPct = 65; // simulated
  const apy = estimateKaminoApy(utilizationPct);

  // Estimate yield based on slots elapsed (400ms per slot)
  const secondsElapsed = slotsSinceHarvest * 0.4;
  const daysElapsed = secondsElapsed / 86_400;
  const dailyRate = apy / 365;
  const estimatedYield = Number(state.deployedAmount) * (dailyRate / 100) * daysElapsed;

  console.log(`Slots since harvest: ${slotsSinceHarvest}`);
  console.log(`Days elapsed:        ${daysElapsed.toFixed(2)}`);
  console.log(`Utilization:         ${utilizationPct}%`);
  console.log(`Estimated APY:       ${apy.toFixed(2)}%`);
  console.log(`Estimated yield:     ${Math.round(estimatedYield)} native USDC`);

  // Build the harvest_strategy_yield instruction
  // This calls Kamino's redeem_reserve_collateral for the accrued interest portion
  const disc = await anchorDisc('harvest_strategy_yield');
  console.log(`Discriminator: ${disc.toString('hex')}`);

  console.log('This is a DRY_RUN example -- yield not harvested.');

  return {
    ...state,
    accruedYield: state.accruedYield + BigInt(Math.round(estimatedYield)),
    lastHarvestSlot: currentSlot,
  };
}

// ── Step 4: Withdraw from Strategy ──────────────────────

async function withdrawFromStrategy(
  admin: PublicKey,
  amount: bigint,
  state: StrategyVaultState,
): Promise<StrategyVaultState> {
  console.log('\n=== STEP 4: WITHDRAW FROM STRATEGY ===');
  console.log(`Withdraw amount: ${amount} native USDC`);
  console.log(`Currently deployed: ${state.deployedAmount}`);

  if (amount > state.deployedAmount) {
    console.log('ERROR: Cannot withdraw more than deployed amount.');
    return state;
  }

  // Build the withdraw_from_strategy instruction
  // This calls Kamino's redeem_reserve_collateral to convert kTokens back to USDC
  const disc = await anchorDisc('withdraw_from_strategy');
  console.log(`Discriminator: ${disc.toString('hex')}`);

  const newDeployed = state.deployedAmount - amount;
  const newReserve = state.reserveAmount + amount;
  console.log(`New deployed:  ${newDeployed}`);
  console.log(`New reserve:   ${newReserve}`);
  console.log('This is a DRY_RUN example -- funds not withdrawn from Kamino.');

  return {
    ...state,
    deployedAmount: newDeployed,
    reserveAmount: newReserve,
  };
}

// ── Main ────────────────────────────────────────────────

async function main() {
  console.log('=== STRATEGY VAULT OPERATIONS ===');
  console.log('Phase 2 yield: Deploy idle USDC to Kamino K-Lend for lending yield.\n');
  console.log(`Reserve ratio: ${RESERVE_BPS / 100}% liquid | ${DEPLOY_BPS / 100}% deployed`);

  const admin = new PublicKey('11111111111111111111111111111111');

  // Simulated initial state
  let state: StrategyVaultState = {
    totalDeposited: 10_000_000_000n, // 10,000 USDC
    deployedAmount: 0n,
    reserveAmount: 10_000_000_000n,
    lastHarvestSlot: 400_000_000,
    accruedYield: 0n,
  };

  // Run the full strategy lifecycle
  await initializeStrategyVault(admin);

  // Deploy 70% to Kamino
  const deployAmount = (state.totalDeposited * BigInt(DEPLOY_BPS)) / BigInt(BPS_DENOMINATOR);
  state = await deployToStrategy(admin, deployAmount, state);

  // Harvest yield after some slots
  state = await harvestStrategyYield(admin, state, 400_500_000);

  // Withdraw half
  const withdrawAmount = state.deployedAmount / 2n;
  state = await withdrawFromStrategy(admin, withdrawAmount, state);

  // Final state
  console.log('\n=== FINAL STRATEGY STATE ===');
  console.log(`Total TVL:    ${state.totalDeposited} native USDC`);
  console.log(`Deployed:     ${state.deployedAmount}`);
  console.log(`Reserve:      ${state.reserveAmount}`);
  console.log(`Accrued yield: ${state.accruedYield}`);
  console.log('\nNote: This is a DRY_RUN strategy template. All operations are simulated.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
