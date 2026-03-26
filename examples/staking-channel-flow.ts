/**
 * staking-channel-flow.ts — Channel staking lifecycle pattern.
 *
 * Demonstrates the staking module (programs/attention-oracle/src/instructions/staking.rs):
 * 1. Stake CCM to a channel — lock tokens to earn attention-weighted rewards
 * 2. Accrue rewards — MasterChef-style distribution based on channel velocity
 * 3. Claim staking rewards — harvest pending CCM
 * 4. Unstake — withdraw staked CCM back to wallet
 *
 * Staking is channel-specific: each channel (HuggingFace model, GitHub repo, etc.)
 * has its own staking pool. Higher-velocity channels generate more rewards,
 * incentivizing stakers to predict which channels will gain attention.
 *
 * Token-2022 Note:
 * CCM has a 50 BPS transfer fee on every transfer. Both staking and unstaking
 * incur this fee, so stakers need rewards > 2x transfer fee to break even.
 *
 * Usage:
 *   npx tsx sdk/examples/staking-channel-flow.ts
 */

import { PublicKey } from '@solana/web3.js';
import { anchorDisc, createAtaIdempotentIx } from '../src/instructions.js';
import {
  PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '../src/constants.js';
import {
  getProtocolStatePDA,
  getChannelConfigV2PDA,
  getAta,
} from '../src/pda.js';

// ── Known Addresses (mainnet) ───────────────────────────
const CCM_MINT = new PublicKey('Dxk8mAb3C7AM8JN6tAJfVuSja5yidhZM5sEKW3SRX2BM');
const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// ── Transfer Fee Constants ──────────────────────────────
const CCM_TRANSFER_FEE_BPS = 50;
const BPS_DENOMINATOR = 10_000;
const CCM_DECIMALS = 9;

// ── Staking Types ───────────────────────────────────────

interface StakeChannel {
  /** Channel name (e.g., "deepseek-ai/DeepSeek-V3") */
  name: string;
  /** Channel subject pubkey (derived from channel identity) */
  subject: PublicKey;
  /** Current attention velocity (higher = more rewards) */
  velocityEma: number;
  /** Total CCM staked across all stakers */
  totalStaked: bigint;
  /** Accumulated reward per share (MasterChef model) */
  accRewardPerShare: bigint;
}

interface StakerPosition {
  /** Staker wallet */
  wallet: PublicKey;
  /** CCM staked in this channel */
  stakedAmount: bigint;
  /** Reward debt (MasterChef accounting) */
  rewardDebt: bigint;
  /** Pending rewards (harvestable) */
  pendingRewards: bigint;
}

/**
 * Calculate pending staking rewards using MasterChef formula.
 *
 * pending = (staked * accRewardPerShare / PRECISION) - rewardDebt
 *
 * The attention oracle updates accRewardPerShare proportional to
 * each channel's velocity score, so high-velocity channels distribute
 * more CCM to their stakers.
 */
const REWARD_PRECISION = 1_000_000_000_000n; // 1e12

function calculatePendingRewards(
  staked: bigint,
  accRewardPerShare: bigint,
  rewardDebt: bigint,
): bigint {
  return (staked * accRewardPerShare / REWARD_PRECISION) - rewardDebt;
}

/**
 * Calculate the transfer fee cost for a round-trip (stake + unstake).
 * Both directions incur the 50 BPS Token-2022 transfer fee.
 */
function roundTripTransferFee(amount: bigint): { stakeFee: bigint; unstakeFee: bigint; total: bigint } {
  const stakeFee = (amount * BigInt(CCM_TRANSFER_FEE_BPS) + BigInt(BPS_DENOMINATOR - 1)) / BigInt(BPS_DENOMINATOR);
  // Unstake fee is on (amount - stakeFee) since that's what was actually staked
  const netStaked = amount - stakeFee;
  const unstakeFee = (netStaked * BigInt(CCM_TRANSFER_FEE_BPS) + BigInt(BPS_DENOMINATOR - 1)) / BigInt(BPS_DENOMINATOR);
  return { stakeFee, unstakeFee, total: stakeFee + unstakeFee };
}

function formatCcm(amount: bigint): string {
  const whole = amount / BigInt(10 ** CCM_DECIMALS);
  const frac = amount % BigInt(10 ** CCM_DECIMALS);
  return `${whole}.${frac.toString().padStart(CCM_DECIMALS, '0').slice(0, 2)}`;
}

// ── Step 1: Stake to Channel ────────────────────────────

async function stakeToChannel(
  staker: PublicKey,
  channel: StakeChannel,
  amount: bigint,
): Promise<StakerPosition> {
  console.log('\n=== STEP 1: STAKE CCM TO CHANNEL ===');
  console.log(`Channel:  ${channel.name}`);
  console.log(`Subject:  ${channel.subject.toBase58()}`);
  console.log(`Velocity: ${channel.velocityEma.toFixed(4)}`);
  console.log(`Amount:   ${formatCcm(amount)} CCM`);

  // Token-2022 transfer fee on stake deposit
  const { stakeFee } = roundTripTransferFee(amount);
  const netStaked = amount - stakeFee;
  console.log(`Transfer fee: ${formatCcm(stakeFee)} CCM`);
  console.log(`Net staked:   ${formatCcm(netStaked)} CCM`);

  // Build stake_channel instruction
  const disc = await anchorDisc('stake_channel');
  console.log(`Discriminator: ${disc.toString('hex')}`);

  // Derive staking PDAs
  const channelConfig = getChannelConfigV2PDA(CCM_MINT, channel.subject, PROGRAM_ID);
  const stakerAta = getAta(staker, CCM_MINT, TOKEN_2022_PROGRAM_ID);
  console.log(`ChannelConfig: ${channelConfig.toBase58()}`);
  console.log(`Staker ATA:    ${stakerAta.toBase58()}`);

  // In production, the staker's CCM is transferred to a staking vault PDA
  // and a StakerPosition account is initialized
  console.log('This is a DRY_RUN example -- CCM not staked.');

  // Initial reward debt = netStaked * accRewardPerShare / PRECISION
  const rewardDebt = netStaked * channel.accRewardPerShare / REWARD_PRECISION;

  return {
    wallet: staker,
    stakedAmount: netStaked,
    rewardDebt,
    pendingRewards: 0n,
  };
}

// ── Step 2: Accrue Rewards ──────────────────────────────

function accrueRewards(
  channel: StakeChannel,
  epochReward: bigint,
  slotsElapsed: number,
): StakeChannel {
  console.log('\n=== STEP 2: ACCRUE STAKING REWARDS ===');
  console.log(`Channel:       ${channel.name}`);
  console.log(`Epoch reward:  ${formatCcm(epochReward)} CCM`);
  console.log(`Slots elapsed: ${slotsElapsed}`);

  if (channel.totalStaked === 0n) {
    console.log('No stakers — rewards forfeited.');
    return channel;
  }

  // MasterChef: accRewardPerShare += epochReward * PRECISION / totalStaked
  const rewardIncrement = epochReward * REWARD_PRECISION / channel.totalStaked;
  const newAccReward = channel.accRewardPerShare + rewardIncrement;

  console.log(`Reward/share increment: ${rewardIncrement}`);
  console.log(`New accRewardPerShare:  ${newAccReward}`);
  console.log(`Velocity multiplier:   ${channel.velocityEma.toFixed(4)}x`);

  return {
    ...channel,
    accRewardPerShare: newAccReward,
  };
}

// ── Step 3: Claim Staking Rewards ───────────────────────

async function claimStakingRewards(
  channel: StakeChannel,
  position: StakerPosition,
): Promise<StakerPosition> {
  console.log('\n=== STEP 3: CLAIM STAKING REWARDS ===');

  const pending = calculatePendingRewards(
    position.stakedAmount,
    channel.accRewardPerShare,
    position.rewardDebt,
  );

  console.log(`Staked:          ${formatCcm(position.stakedAmount)} CCM`);
  console.log(`Pending rewards: ${formatCcm(pending)} CCM`);

  if (pending <= 0n) {
    console.log('No rewards to claim.');
    return position;
  }

  // Transfer fee on reward claim
  const claimFee = (pending * BigInt(CCM_TRANSFER_FEE_BPS) + BigInt(BPS_DENOMINATOR - 1)) / BigInt(BPS_DENOMINATOR);
  const netReward = pending - claimFee;
  console.log(`Transfer fee:    ${formatCcm(claimFee)} CCM`);
  console.log(`Net received:    ${formatCcm(netReward)} CCM`);

  // Build claim_staking_reward instruction
  const disc = await anchorDisc('claim_staking_reward');
  console.log(`Discriminator: ${disc.toString('hex')}`);
  console.log('This is a DRY_RUN example -- rewards not claimed.');

  return {
    ...position,
    pendingRewards: 0n,
    rewardDebt: position.stakedAmount * channel.accRewardPerShare / REWARD_PRECISION,
  };
}

// ── Step 4: Unstake ─────────────────────────────────────

async function unstakeFromChannel(
  channel: StakeChannel,
  position: StakerPosition,
): Promise<void> {
  console.log('\n=== STEP 4: UNSTAKE CCM ===');
  console.log(`Channel:  ${channel.name}`);
  console.log(`Staked:   ${formatCcm(position.stakedAmount)} CCM`);

  // Transfer fee on unstake withdrawal
  const unstakeFee = (position.stakedAmount * BigInt(CCM_TRANSFER_FEE_BPS) + BigInt(BPS_DENOMINATOR - 1)) / BigInt(BPS_DENOMINATOR);
  const netReceived = position.stakedAmount - unstakeFee;

  console.log(`Unstake fee:  ${formatCcm(unstakeFee)} CCM`);
  console.log(`Net received: ${formatCcm(netReceived)} CCM`);

  // Build unstake_channel instruction
  const disc = await anchorDisc('unstake_channel');
  console.log(`Discriminator: ${disc.toString('hex')}`);

  // The on-chain program:
  // 1. Calculates and distributes any remaining pending rewards
  // 2. Transfers staked CCM back to the staker's ATA
  // 3. Closes the StakerPosition account (rent reclaimed)
  console.log('This is a DRY_RUN example -- CCM not unstaked.');
}

// ── Main ────────────────────────────────────────────────

async function main() {
  console.log('=== CHANNEL STAKING FLOW ===');
  console.log('Lock CCM to high-velocity channels. Earn attention-weighted rewards.\n');
  console.log(`Transfer fee: ${CCM_TRANSFER_FEE_BPS} BPS per CCM transfer`);
  console.log(`Staking requires rewards > 2x transfer fee to be profitable.`);

  const staker = new PublicKey('11111111111111111111111111111111');

  // Simulated channel state
  let channel: StakeChannel = {
    name: 'deepseek-ai/DeepSeek-V3',
    subject: new PublicKey('11111111111111111111111111111111'),
    velocityEma: 2.5,
    totalStaked: 50_000_000_000_000n, // 50,000 CCM
    accRewardPerShare: 0n,
  };

  const stakeAmount = 1_000_000_000_000n; // 1,000 CCM

  // Full staking lifecycle
  let position = await stakeToChannel(staker, channel, stakeAmount);

  // Update channel total
  channel = { ...channel, totalStaked: channel.totalStaked + position.stakedAmount };

  // Simulate reward accrual (3 epochs)
  const epochReward = 100_000_000_000n; // 100 CCM per epoch
  for (let epoch = 1; epoch <= 3; epoch++) {
    channel = accrueRewards(channel, epochReward, 1500 * epoch);
  }

  // Claim accumulated rewards
  position = await claimStakingRewards(channel, position);

  // Unstake
  await unstakeFromChannel(channel, position);

  // Breakeven analysis
  console.log('\n=== BREAKEVEN ANALYSIS ===');
  const fees = roundTripTransferFee(stakeAmount);
  console.log(`Round-trip transfer fees: ${formatCcm(fees.total)} CCM`);
  console.log(`  Stake fee:   ${formatCcm(fees.stakeFee)} CCM`);
  console.log(`  Unstake fee: ${formatCcm(fees.unstakeFee)} CCM`);
  console.log(`Minimum rewards needed:  ${formatCcm(fees.total)} CCM to break even`);
  console.log('\nNote: This is a DRY_RUN template. Staking module is deployed but not wired to frontend.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
