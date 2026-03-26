/**
 * On-chain account deserialization for the Liquid Attention Protocol.
 *
 * Layouts must match the Anchor account structs defined in
 * programs/attention-oracle/src/state/*.rs.
 */

import { Connection, PublicKey } from '@solana/web3.js';

import { getProtocolStatePDA, getMarketVaultPDA, getUserPositionPDA } from './pda.js';

// ── Parsed Types ───────────────────────────────────────

export interface MarketVaultData {
  bump: number;
  depositMint: PublicKey;
  vlofiMint: PublicKey;
  vaultAta: PublicKey;
}

export interface MarketVaultFull extends MarketVaultData {
  marketId: number;
  totalDeposited: bigint;
  totalShares: bigint;
  navPerShareBps: bigint;
  lastNavUpdateSlot: bigint;
}

export interface ProtocolStateData {
  isInitialized: boolean;
  version: number;
  admin: PublicKey;
  publisher: PublicKey;
  treasury: PublicKey;
  oracleAuthority: PublicKey;
  /** CCM (reward) mint address */
  mint: PublicKey;
  /** USDC (or deposit token) mint address — added for market vault init discovery */
  depositMint?: PublicKey;
  paused: boolean;
  requireReceipt: boolean;
  bump: number;
}

export interface OnChainPosition {
  user: PublicKey;
  marketVault: PublicKey;
  depositedAmount: bigint;
  sharesMinted: bigint;
  attentionMultiplierBps: bigint;
  settled: boolean;
  entrySlot: bigint;
}

export type LifecyclePhase =
  | 'deposited'
  | 'accruing'
  | 'claimable'
  | 'claimed'
  | 'settled';

export interface LifecyclePhaseInput {
  settled: boolean;
  positionCreatedAt?: Date | string | null;
  latestRootCreatedAt?: Date | string | null;
  latestProofCreatedAt?: Date | string | null;
  proofCumulativeTotalBase?: bigint | number | null;
  claimedTotalBase?: bigint | number | null;
  claimableCcmBase?: bigint | number | null;
}

// ── Parsers ────────────────────────────────────────────

/** Parse a MarketVault account's core fields (skip Anchor discriminator). */
export function parseMarketVault(data: Buffer): MarketVaultData {
  const d = data.subarray(8);
  return {
    bump: d[0],
    // market_id at offset 1 (8 bytes) — skip
    depositMint: new PublicKey(d.subarray(9, 41)),
    vlofiMint: new PublicKey(d.subarray(41, 73)),
    vaultAta: new PublicKey(d.subarray(73, 105)),
  };
}

/**
 * Parse a ProtocolState account (matches `ProtocolState` struct in state/protocol.rs).
 *
 * Layout after 8-byte Anchor discriminator:
 *   is_initialized(1) + version(1) + admin(32) + publisher(32)
 *   + treasury(32) + oracle_authority(32) + mint(32) + paused(1) + require_receipt(1) + bump(1)
 */
export function parseProtocolState(data: Buffer): ProtocolStateData {
  const d = data.subarray(8);
  return {
    isInitialized: d[0] !== 0,
    version: d[1],
    admin: new PublicKey(d.subarray(2, 34)),
    publisher: new PublicKey(d.subarray(34, 66)),
    treasury: new PublicKey(d.subarray(66, 98)),
    oracleAuthority: new PublicKey(d.subarray(98, 130)),
    mint: new PublicKey(d.subarray(130, 162)),
    paused: d[162] !== 0,
    requireReceipt: d[163] !== 0,
    bump: d[164],
  };
}

/** Parse a UserMarketPosition account. Returns null if data is too short. */
export function parseUserMarketPosition(data: Buffer): OnChainPosition | null {
  if (data.length < 114) return null;
  const d = data.subarray(8); // skip Anchor discriminator
  return {
    user: new PublicKey(d.subarray(1, 33)),
    marketVault: new PublicKey(d.subarray(33, 65)),
    depositedAmount: d.readBigUInt64LE(65),
    sharesMinted: d.readBigUInt64LE(73),
    attentionMultiplierBps: d.readBigUInt64LE(81),
    settled: d[89] !== 0,
    entrySlot: d.readBigUInt64LE(90),
  };
}

function toMillis(value?: Date | string | null): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

function toBigIntOrZero(value?: bigint | number | null): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  return 0n;
}

export function deriveLifecyclePhase(input: LifecyclePhaseInput): LifecyclePhase {
  if (input.settled) return 'settled';

  const positionCreatedAtMs = toMillis(input.positionCreatedAt);
  const latestRootCreatedAtMs = toMillis(input.latestRootCreatedAt);
  if (
    positionCreatedAtMs !== null &&
    (latestRootCreatedAtMs === null || latestRootCreatedAtMs < positionCreatedAtMs)
  ) {
    return 'deposited';
  }

  const latestProofCreatedAtMs = toMillis(input.latestProofCreatedAt);
  const proofAppliesToPosition =
    positionCreatedAtMs === null ||
    (latestProofCreatedAtMs !== null && latestProofCreatedAtMs >= positionCreatedAtMs);
  const claimableCcmBase = toBigIntOrZero(input.claimableCcmBase);
  if (proofAppliesToPosition && claimableCcmBase > 0n) {
    return 'claimable';
  }

  const proofCumulativeTotalBase = toBigIntOrZero(input.proofCumulativeTotalBase);
  const claimedTotalBase = toBigIntOrZero(input.claimedTotalBase);
  if (
    proofAppliesToPosition &&
    proofCumulativeTotalBase > 0n &&
    claimedTotalBase >= proofCumulativeTotalBase
  ) {
    return 'claimed';
  }

  return 'accruing';
}

// ── Fetch Helpers ──────────────────────────────────────

/** Fetch a user's position for a specific market directly from chain. */
export async function fetchOnChainPosition(
  connection: Connection,
  user: PublicKey,
  marketId: number,
  programId?: PublicKey,
): Promise<OnChainPosition | null> {
  const protocolState = getProtocolStatePDA(programId);
  const marketVault = getMarketVaultPDA(protocolState, marketId, programId);
  const positionPda = getUserPositionPDA(marketVault, user, programId);

  const info = await connection.getAccountInfo(positionPda);
  if (!info) return null;
  return parseUserMarketPosition(Buffer.from(info.data));
}

/** Fetch the full MarketVault data from chain. */
export async function fetchMarketVault(
  connection: Connection,
  marketId: number,
  programId?: PublicKey,
): Promise<MarketVaultFull | null> {
  const protocolState = getProtocolStatePDA(programId);
  const marketVault = getMarketVaultPDA(protocolState, marketId, programId);

  const info = await connection.getAccountInfo(marketVault);
  if (!info) return null;
  const d = Buffer.from(info.data).subarray(8);
  return {
    bump: d[0],
    depositMint: new PublicKey(d.subarray(9, 41)),
    vlofiMint: new PublicKey(d.subarray(41, 73)),
    vaultAta: new PublicKey(d.subarray(73, 105)),
    marketId,
    totalDeposited: d.readBigUInt64LE(105),
    totalShares: d.readBigUInt64LE(113),
    navPerShareBps: d.length >= 137 ? d.readBigUInt64LE(129) : 0n,
    lastNavUpdateSlot: d.length >= 145 ? d.readBigUInt64LE(137) : 0n,
  };
}

/** Read a token account balance from chain. */
export async function fetchTokenBalance(
  connection: Connection,
  tokenAccount: PublicKey,
): Promise<bigint> {
  const info = await connection.getAccountInfo(tokenAccount);
  if (!info || info.data.length < 72) return 0n;
  return Buffer.from(info.data.subarray(64, 72)).readBigUInt64LE(0);
}
