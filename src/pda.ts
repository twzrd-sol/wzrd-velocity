/**
 * PDA derivation helpers for the Liquid Attention Protocol.
 *
 * Seeds must match programs/attention-oracle/src/constants.rs.
 */

import { PublicKey } from '@solana/web3.js';

import {
  PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  PROTOCOL_STATE_SEED,
  MARKET_VAULT_SEED,
  MARKET_POSITION_SEED,
  GLOBAL_ROOT_SEED,
  CLAIM_STATE_GLOBAL_SEED,
  CHANNEL_CONFIG_V2_SEED,
  STREAM_ROOT_SEED,
  CLAIM_STATE_STREAM_SEED,
} from './constants.js';

/** Derive the singleton ProtocolState PDA. */
export function getProtocolStatePDA(programId: PublicKey = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PROTOCOL_STATE_SEED)],
    programId,
  )[0];
}

/** Derive a MarketVault PDA for a given market ID. */
export function getMarketVaultPDA(
  protocolState: PublicKey,
  marketId: number,
  programId: PublicKey = PROGRAM_ID,
): PublicKey {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(marketId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from(MARKET_VAULT_SEED), protocolState.toBuffer(), idBuf],
    programId,
  )[0];
}

/** Derive a UserMarketPosition PDA. */
export function getUserPositionPDA(
  marketVault: PublicKey,
  user: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(MARKET_POSITION_SEED), marketVault.toBuffer(), user.toBuffer()],
    programId,
  )[0];
}

/** Derive the GlobalRootConfig PDA for a given CCM mint. */
export function getGlobalRootConfigPDA(
  ccmMint: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(GLOBAL_ROOT_SEED), ccmMint.toBuffer()],
    programId,
  )[0];
}

/** Derive the per-user ClaimStateGlobal PDA. */
export function getClaimStatePDA(
  ccmMint: PublicKey,
  claimer: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(CLAIM_STATE_GLOBAL_SEED), ccmMint.toBuffer(), claimer.toBuffer()],
    programId,
  )[0];
}

/** Derive a ChannelConfigV2 PDA for a given mint and subject. */
export function getChannelConfigV2PDA(
  mint: PublicKey,
  subject: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(CHANNEL_CONFIG_V2_SEED), mint.toBuffer(), subject.toBuffer()],
    programId,
  )[0];
}

// ── Stream (vLOFI distribution) PDA Derivation ──────────

/** Derive the StreamRootConfig PDA for a given vLOFI mint. */
export function getStreamRootConfigPDA(
  vlofiMint: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(STREAM_ROOT_SEED), vlofiMint.toBuffer()],
    programId,
  )[0];
}

/** Derive the per-user ClaimStateStream PDA. */
export function getClaimStateStreamPDA(
  vlofiMint: PublicKey,
  claimer: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(CLAIM_STATE_STREAM_SEED), vlofiMint.toBuffer(), claimer.toBuffer()],
    programId,
  )[0];
}

/** Derive an Associated Token Account address (works for both SPL and Token-2022). */
export function getAta(
  owner: PublicKey,
  mint: PublicKey,
  tokenProgramId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}
