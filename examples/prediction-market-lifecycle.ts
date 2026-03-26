/**
 * prediction-market-lifecycle.ts — Prediction market lifecycle pattern.
 *
 * Demonstrates the full prediction market flow:
 * 1. Create a channel config (create_channel_config_v2) for the prediction subject
 * 2. Initialize market tokens (YES/NO mints for the prediction)
 * 3. Users take positions (buy YES or NO tokens)
 * 4. Oracle resolves the market with a merkle proof
 * 5. Winners redeem tokens for USDC
 *
 * On-chain modules used:
 * - create_channel_config_v2 (admin.rs) — registers the prediction channel
 * - initialize_market_vault (vault.rs) — creates the market vault
 * - deposit_market (vault.rs) — users deposit USDC to take positions
 * - settle_market (vault.rs) — resolves and distributes
 *
 * Usage:
 *   npx tsx sdk/examples/prediction-market-lifecycle.ts
 */

import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { anchorDisc, createChannelConfigV2Ix, createAtaIdempotentIx } from '../src/instructions.js';
import {
  PROGRAM_ID,
  MAINNET_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '../src/constants.js';
import {
  getProtocolStatePDA,
  getMarketVaultPDA,
  getChannelConfigV2PDA,
} from '../src/pda.js';

// ── Known Mint Addresses (mainnet) ──────────────────────
const CCM_MINT = new PublicKey('Dxk8mAb3C7AM8JN6tAJfVuSja5yidhZM5sEKW3SRX2BM');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const VLOFI_MINT = new PublicKey('E9Kt33axpCy3ve2PCY9BSrbPhcR9wdDsWQECAahzw2dS');

// ── Prediction Market Types ─────────────────────────────
interface PredictionMarketConfig {
  /** Human-readable question (e.g., "Will GPT-5 launch by Q2 2026?") */
  question: string;
  /** Subject pubkey — derived from the question hash */
  subject: PublicKey;
  /** Resolution deadline (unix timestamp) */
  resolutionDeadline: number;
  /** Creator fee in BPS (e.g., 100 = 1%) */
  creatorFeeBps: number;
  /** Market ID for the on-chain vault */
  marketId: number;
}

interface PredictionPosition {
  side: 'YES' | 'NO';
  amountUsdc: number;
  /** Implied probability at time of entry */
  entryProbability: number;
}

/**
 * Calculate implied probability from YES/NO pool sizes.
 * Simple constant-product AMM model for illustration.
 */
function impliedProbability(yesPool: number, noPool: number): { yes: number; no: number } {
  const total = yesPool + noPool;
  if (total === 0) return { yes: 0.5, no: 0.5 };
  return {
    yes: noPool / total, // price of YES = NO_pool / total
    no: yesPool / total,  // price of NO = YES_pool / total
  };
}

/**
 * Calculate expected payout for a prediction position.
 * Winner receives proportional share of the total pool.
 */
function expectedPayout(
  position: PredictionPosition,
  totalPool: number,
  sidePool: number,
): { payout: number; profit: number; returnPct: number } {
  // If this side wins, holder gets (amount / sidePool) * totalPool
  const share = position.amountUsdc / sidePool;
  const payout = share * totalPool;
  const profit = payout - position.amountUsdc;
  const returnPct = (profit / position.amountUsdc) * 100;
  return { payout, profit, returnPct };
}

// ── Step 1: Create Channel Config ───────────────────────

async function createPredictionChannel(
  admin: PublicKey,
  config: PredictionMarketConfig,
): Promise<void> {
  console.log('\n=== STEP 1: CREATE PREDICTION CHANNEL ===');
  console.log(`Question:  "${config.question}"`);
  console.log(`Subject:   ${config.subject.toBase58()}`);
  console.log(`Deadline:  ${new Date(config.resolutionDeadline * 1000).toISOString()}`);
  console.log(`Creator fee: ${config.creatorFeeBps} BPS (${config.creatorFeeBps / 100}%)`);

  // Build the create_channel_config_v2 instruction
  // In production, submit this via Squads multisig or admin wallet
  const channelConfig = getChannelConfigV2PDA(CCM_MINT, config.subject, PROGRAM_ID);
  console.log(`ChannelConfig PDA: ${channelConfig.toBase58()}`);

  // The create_channel instruction registers this prediction subject on-chain
  const ix = await createChannelConfigV2Ix(
    admin,
    CCM_MINT,
    config.subject,
    admin, // authority
    admin, // creator wallet (receives fees)
    config.creatorFeeBps,
  );

  console.log(`Instruction programId: ${ix.programId.toBase58()}`);
  console.log(`Accounts: ${ix.keys.length}`);
  console.log('This is a DRY_RUN example -- not submitting transactions.');
}

// ── Step 2: Initialize Market Tokens ────────────────────

async function initializeMarketTokens(
  admin: PublicKey,
  config: PredictionMarketConfig,
): Promise<void> {
  console.log('\n=== STEP 2: INITIALIZE MARKET TOKENS ===');

  const protocolState = getProtocolStatePDA(PROGRAM_ID);
  const marketVault = getMarketVaultPDA(protocolState, config.marketId, PROGRAM_ID);

  console.log(`Market ID:     ${config.marketId}`);
  console.log(`MarketVault:   ${marketVault.toBase58()}`);
  console.log(`ProtocolState: ${protocolState.toBase58()}`);

  // In production, derive YES/NO token mints from the prediction market PDA
  // The prediction market module creates SPL mints for YES and NO outcome tokens
  const yesMintSeed = `pred_yes_${config.marketId}`;
  const noMintSeed = `pred_no_${config.marketId}`;
  console.log(`YES token seed: "${yesMintSeed}"`);
  console.log(`NO token seed:  "${noMintSeed}"`);

  // Build the initialize_market_vault instruction via anchorDisc
  const disc = await anchorDisc('initialize_market_vault');
  console.log(`Discriminator: ${disc.toString('hex')}`);
  console.log('This is a DRY_RUN example -- tokens not created.');
}

// ── Step 3: Simulate Trading ────────────────────────────

function simulateTrading(config: PredictionMarketConfig): void {
  console.log('\n=== STEP 3: SIMULATE PREDICTION TRADING ===');

  // Simulated market state
  let yesPool = 500;  // USDC in YES pool
  let noPool = 500;   // USDC in NO pool

  const trades: PredictionPosition[] = [
    { side: 'YES', amountUsdc: 100, entryProbability: 0 },
    { side: 'NO',  amountUsdc: 50,  entryProbability: 0 },
    { side: 'YES', amountUsdc: 200, entryProbability: 0 },
    { side: 'NO',  amountUsdc: 75,  entryProbability: 0 },
    { side: 'YES', amountUsdc: 150, entryProbability: 0 },
  ];

  console.log('\n  Trade | Side | Amount | YES prob | NO prob');
  console.log('  ----- | ---- | ------ | -------- | -------');

  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i];
    // Update pools
    if (trade.side === 'YES') yesPool += trade.amountUsdc;
    else noPool += trade.amountUsdc;

    const prob = impliedProbability(yesPool, noPool);
    trade.entryProbability = trade.side === 'YES' ? prob.yes : prob.no;

    console.log(
      `  ${(i + 1).toString().padEnd(5)} | ${trade.side.padEnd(4)} | $${trade.amountUsdc.toString().padEnd(4)} | ${(prob.yes * 100).toFixed(1)}%    | ${(prob.no * 100).toFixed(1)}%`,
    );
  }

  const totalPool = yesPool + noPool;
  console.log(`\n  Total pool: $${totalPool} USDC`);
  console.log(`  YES pool: $${yesPool} | NO pool: $${noPool}`);

  // Show payouts if YES wins
  console.log('\n  --- If YES wins ---');
  const yesPayout = expectedPayout(
    { side: 'YES', amountUsdc: 100, entryProbability: 0.5 },
    totalPool,
    yesPool,
  );
  console.log(`  $100 YES position → $${yesPayout.payout.toFixed(2)} payout (${yesPayout.returnPct.toFixed(1)}% return)`);
}

// ── Step 4: Resolve Market ──────────────────────────────

async function resolveMarket(
  config: PredictionMarketConfig,
  outcome: 'YES' | 'NO',
): Promise<void> {
  console.log('\n=== STEP 4: RESOLVE PREDICTION MARKET ===');
  console.log(`Question: "${config.question}"`);
  console.log(`Outcome:  ${outcome}`);
  console.log(`Resolved at: ${new Date().toISOString()}`);

  // In production, the oracle calls resolve_prediction with a merkle proof
  // The on-chain program verifies the proof and unlocks redemptions
  const resolveDisc = await anchorDisc('settle_market');
  console.log(`Settle discriminator: ${resolveDisc.toString('hex')}`);

  // After resolution, winning token holders can redeem for their share of the pool
  console.log('Winners can now call settle_market to redeem positions.');
  console.log('This is a DRY_RUN example -- market not resolved on-chain.');
}

// ── Main ────────────────────────────────────────────────

async function main() {
  console.log('=== PREDICTION MARKET LIFECYCLE ===');
  console.log('Demonstrates the full lifecycle of a prediction market on WZRD.\n');
  console.log('Modules: create_channel_config_v2, initialize_market_vault, deposit, settle');

  // Simulated admin keypair (DRY_RUN only)
  const adminPubkey = new PublicKey('11111111111111111111111111111111');

  // Example prediction market config
  const config: PredictionMarketConfig = {
    question: 'Will HuggingFace model downloads exceed 10B in March 2026?',
    subject: Keypair.generate().publicKey,
    resolutionDeadline: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
    creatorFeeBps: 100, // 1%
    marketId: 42,
  };

  // Run the full lifecycle
  await createPredictionChannel(adminPubkey, config);
  await initializeMarketTokens(adminPubkey, config);
  simulateTrading(config);
  await resolveMarket(config, 'YES');

  console.log('\n=== LIFECYCLE COMPLETE ===');
  console.log('In production, each step submits real transactions via @wzrd_sol/sdk.');
  console.log('Agents can automate this loop: create → trade → resolve → collect.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
