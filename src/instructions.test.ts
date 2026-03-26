/**
 * Unit tests for SDK instruction builders and helpers.
 *
 * Tests the sync / pure parts of instructions.ts, pda.ts, accounts.ts, and constants.ts
 * without requiring an RPC Connection.
 */

import { describe, it, expect } from 'vitest';
import { PublicKey, SystemProgram } from '@solana/web3.js';

import {
  anchorDisc,
  createAtaIdempotentIx,
  createAddLiquidityIx,
  createRemoveLiquidityIx,
  DLMM_PROGRAM_ID,
} from './instructions.js';

import {
  PROGRAM_ID,
  MAINNET_PROGRAM_ID,
  DEVNET_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  PROTOCOL_STATE_SEED,
  MARKET_VAULT_SEED,
  MARKET_POSITION_SEED,
  GLOBAL_ROOT_SEED,
  CLAIM_STATE_GLOBAL_SEED,
  CHANNEL_CONFIG_V2_SEED,
} from './constants.js';

import {
  getProtocolStatePDA,
  getMarketVaultPDA,
  getUserPositionPDA,
  getGlobalRootConfigPDA,
  getClaimStatePDA,
  getChannelConfigV2PDA,
  getAta,
} from './pda.js';

import {
  parseMarketVault,
  parseProtocolState,
  parseUserMarketPosition,
} from './accounts.js';

// ── Test fixtures ────────────────────────────────────────

const DUMMY_KEY_A = new PublicKey('11111111111111111111111111111111');
const DUMMY_KEY_B = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const CCM_MINT = new PublicKey('Dxk8mAb3C7AM8JN6tAJfVuSja5yidhZM5sEKW3SRX2BM');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// ── anchorDisc ──────────────────────────────────────────

describe('anchorDisc', () => {
  it('produces an 8-byte Buffer', async () => {
    const disc = await anchorDisc('deposit_market');
    expect(disc).toBeInstanceOf(Buffer);
    expect(disc.length).toBe(8);
  });

  it('is deterministic — same name gives same bytes', async () => {
    const a = await anchorDisc('deposit_market');
    const b = await anchorDisc('deposit_market');
    expect(a.equals(b)).toBe(true);
  });

  it('different names produce different discriminators', async () => {
    const deposit = await anchorDisc('deposit_market');
    const settle = await anchorDisc('settle_market');
    expect(deposit.equals(settle)).toBe(false);
  });

  it('matches SHA-256("global:<name>")[0..8]', async () => {
    // We manually verify deposit_market against the Node.js crypto module
    const { createHash } = await import('crypto');
    const hash = createHash('sha256').update('global:deposit_market').digest();
    const expected = hash.subarray(0, 8);
    const disc = await anchorDisc('deposit_market');
    expect(disc.equals(expected)).toBe(true);
  });

  it('produces correct disc for claim_global', async () => {
    const { createHash } = await import('crypto');
    const hash = createHash('sha256').update('global:claim_global').digest();
    const expected = hash.subarray(0, 8);
    const disc = await anchorDisc('claim_global');
    expect(disc.equals(expected)).toBe(true);
  });

  it('handles empty name gracefully', async () => {
    const disc = await anchorDisc('');
    expect(disc.length).toBe(8);
  });

  it('handles snake_case names', async () => {
    const disc = await anchorDisc('initialize_market_vault');
    expect(disc.length).toBe(8);
  });
});

// ── createAtaIdempotentIx ───────────────────────────────

describe('createAtaIdempotentIx', () => {
  it('uses ASSOCIATED_TOKEN_PROGRAM_ID as programId', () => {
    const ix = createAtaIdempotentIx(
      DUMMY_KEY_A, DUMMY_KEY_B, DUMMY_KEY_A, USDC_MINT,
    );
    expect(ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
  });

  it('has exactly 6 account keys', () => {
    const ix = createAtaIdempotentIx(
      DUMMY_KEY_A, DUMMY_KEY_B, DUMMY_KEY_A, USDC_MINT,
    );
    expect(ix.keys.length).toBe(6);
  });

  it('sets payer as signer + writable', () => {
    const payer = CCM_MINT;
    const ix = createAtaIdempotentIx(
      payer, DUMMY_KEY_B, DUMMY_KEY_A, USDC_MINT,
    );
    expect(ix.keys[0].pubkey.equals(payer)).toBe(true);
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[0].isWritable).toBe(true);
  });

  it('sets ata as writable, not signer', () => {
    const ata = DUMMY_KEY_B;
    const ix = createAtaIdempotentIx(
      DUMMY_KEY_A, ata, DUMMY_KEY_A, USDC_MINT,
    );
    expect(ix.keys[1].pubkey.equals(ata)).toBe(true);
    expect(ix.keys[1].isSigner).toBe(false);
    expect(ix.keys[1].isWritable).toBe(true);
  });

  it('data is single byte [1] (CreateIdempotent)', () => {
    const ix = createAtaIdempotentIx(
      DUMMY_KEY_A, DUMMY_KEY_B, DUMMY_KEY_A, USDC_MINT,
    );
    expect(ix.data.length).toBe(1);
    expect(ix.data[0]).toBe(1);
  });

  it('defaults to TOKEN_PROGRAM_ID when no tokenProgramId provided', () => {
    const ix = createAtaIdempotentIx(
      DUMMY_KEY_A, DUMMY_KEY_B, DUMMY_KEY_A, USDC_MINT,
    );
    // 5th account is tokenProgramId
    expect(ix.keys[5].pubkey.equals(TOKEN_PROGRAM_ID)).toBe(true);
  });

  it('uses Token-2022 when specified', () => {
    const ix = createAtaIdempotentIx(
      DUMMY_KEY_A, DUMMY_KEY_B, DUMMY_KEY_A, CCM_MINT, TOKEN_2022_PROGRAM_ID,
    );
    expect(ix.keys[5].pubkey.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
  });

  it('includes SystemProgram in account keys', () => {
    const ix = createAtaIdempotentIx(
      DUMMY_KEY_A, DUMMY_KEY_B, DUMMY_KEY_A, USDC_MINT,
    );
    expect(ix.keys[4].pubkey.equals(SystemProgram.programId)).toBe(true);
  });
});

// ── createAddLiquidityIx ────────────────────────────────

describe('createAddLiquidityIx', () => {
  const pool = PublicKey.unique();
  const position = PublicKey.unique();
  const owner = PublicKey.unique();
  const tokenXMint = PublicKey.unique();
  const tokenYMint = PublicKey.unique();
  const userTokenX = PublicKey.unique();
  const userTokenY = PublicKey.unique();
  const reserveX = PublicKey.unique();
  const reserveY = PublicKey.unique();
  const binArrayLower = PublicKey.unique();
  const binArrayUpper = PublicKey.unique();

  const ix = createAddLiquidityIx(
    pool, position, owner,
    tokenXMint, tokenYMint,
    userTokenX, userTokenY,
    reserveX, reserveY,
    binArrayLower, binArrayUpper,
    1000n, 2000n, 100, 5,
  );

  it('uses DLMM_PROGRAM_ID', () => {
    expect(ix.programId.equals(DLMM_PROGRAM_ID)).toBe(true);
  });

  it('has 14 account keys', () => {
    expect(ix.keys.length).toBe(14);
  });

  it('data is 33 bytes (8 disc + 8 amountX + 8 amountY + 4 activeBinId + 4 binCount + 1 strategyType)', () => {
    expect(ix.data.length).toBe(33);
  });

  it('encodes amountX correctly as LE u64', () => {
    const amountX = ix.data.readBigUInt64LE(8);
    expect(amountX).toBe(1000n);
  });

  it('encodes amountY correctly as LE u64', () => {
    const amountY = ix.data.readBigUInt64LE(16);
    expect(amountY).toBe(2000n);
  });

  it('encodes activeBinId as LE i32', () => {
    const activeBinId = ix.data.readInt32LE(24);
    expect(activeBinId).toBe(100);
  });

  it('encodes binCount as LE i32', () => {
    const binCount = ix.data.readInt32LE(28);
    expect(binCount).toBe(5);
  });

  it('sets strategy type to 0 (Spot)', () => {
    expect(ix.data.readUInt8(32)).toBe(0);
  });

  it('marks owner as signer', () => {
    const ownerKey = ix.keys.find(k => k.pubkey.equals(owner));
    expect(ownerKey?.isSigner).toBe(true);
  });
});

// ── createRemoveLiquidityIx ─────────────────────────────

describe('createRemoveLiquidityIx', () => {
  const pool = PublicKey.unique();
  const position = PublicKey.unique();
  const owner = PublicKey.unique();
  const reserveX = PublicKey.unique();
  const reserveY = PublicKey.unique();
  const userTokenX = PublicKey.unique();
  const userTokenY = PublicKey.unique();
  const tokenXMint = PublicKey.unique();
  const tokenYMint = PublicKey.unique();
  const binArrayLower = PublicKey.unique();
  const binArrayUpper = PublicKey.unique();

  const ix = createRemoveLiquidityIx(
    pool, position, owner,
    reserveX, reserveY,
    userTokenX, userTokenY,
    tokenXMint, tokenYMint,
    binArrayLower, binArrayUpper,
    10_000, // 100%
  );

  it('uses DLMM_PROGRAM_ID', () => {
    expect(ix.programId.equals(DLMM_PROGRAM_ID)).toBe(true);
  });

  it('has 13 account keys', () => {
    expect(ix.keys.length).toBe(13);
  });

  it('data is 10 bytes (8 disc + 2 bps)', () => {
    expect(ix.data.length).toBe(10);
  });

  it('encodes bpsBasisPointsToRemove as LE u16', () => {
    const bps = ix.data.readUInt16LE(8);
    expect(bps).toBe(10_000);
  });

  it('marks owner as signer', () => {
    const ownerKey = ix.keys.find(k => k.pubkey.equals(owner));
    expect(ownerKey?.isSigner).toBe(true);
  });

  it('encodes partial removal correctly', () => {
    const partialIx = createRemoveLiquidityIx(
      pool, position, owner,
      reserveX, reserveY,
      userTokenX, userTokenY,
      tokenXMint, tokenYMint,
      binArrayLower, binArrayUpper,
      5_000, // 50%
    );
    expect(partialIx.data.readUInt16LE(8)).toBe(5_000);
  });
});

// ── PDA derivation ──────────────────────────────────────

describe('PDA derivation', () => {
  it('getProtocolStatePDA is deterministic', () => {
    const a = getProtocolStatePDA(PROGRAM_ID);
    const b = getProtocolStatePDA(PROGRAM_ID);
    expect(a.equals(b)).toBe(true);
  });

  it('getProtocolStatePDA differs by program', () => {
    const mainnet = getProtocolStatePDA(MAINNET_PROGRAM_ID);
    const devnet = getProtocolStatePDA(DEVNET_PROGRAM_ID);
    expect(mainnet.equals(devnet)).toBe(false);
  });

  it('getMarketVaultPDA differs by market ID', () => {
    const ps = getProtocolStatePDA(PROGRAM_ID);
    const vault1 = getMarketVaultPDA(ps, 1, PROGRAM_ID);
    const vault2 = getMarketVaultPDA(ps, 2, PROGRAM_ID);
    expect(vault1.equals(vault2)).toBe(false);
  });

  it('getUserPositionPDA differs by user', () => {
    const ps = getProtocolStatePDA(PROGRAM_ID);
    const vault = getMarketVaultPDA(ps, 1, PROGRAM_ID);
    const pos1 = getUserPositionPDA(vault, CCM_MINT, PROGRAM_ID);
    const pos2 = getUserPositionPDA(vault, USDC_MINT, PROGRAM_ID);
    expect(pos1.equals(pos2)).toBe(false);
  });

  it('getGlobalRootConfigPDA derives from CCM mint', () => {
    const root = getGlobalRootConfigPDA(CCM_MINT, PROGRAM_ID);
    expect(PublicKey.isOnCurve(root.toBuffer())).toBe(false); // PDAs are off-curve
  });

  it('getClaimStatePDA is unique per claimer', () => {
    const claim1 = getClaimStatePDA(CCM_MINT, USDC_MINT, PROGRAM_ID);
    const claim2 = getClaimStatePDA(CCM_MINT, CCM_MINT, PROGRAM_ID);
    expect(claim1.equals(claim2)).toBe(false);
  });

  it('getChannelConfigV2PDA is unique per subject', () => {
    const ch1 = getChannelConfigV2PDA(CCM_MINT, USDC_MINT, PROGRAM_ID);
    const ch2 = getChannelConfigV2PDA(CCM_MINT, CCM_MINT, PROGRAM_ID);
    expect(ch1.equals(ch2)).toBe(false);
  });

  it('getAta derives a valid off-curve address', () => {
    const ata = getAta(CCM_MINT, USDC_MINT, TOKEN_PROGRAM_ID);
    expect(PublicKey.isOnCurve(ata.toBuffer())).toBe(false);
  });
});

// ── Constants ───────────────────────────────────────────

describe('constants', () => {
  it('PROGRAM_ID equals MAINNET_PROGRAM_ID', () => {
    expect(PROGRAM_ID.equals(MAINNET_PROGRAM_ID)).toBe(true);
  });

  it('DEVNET_PROGRAM_ID is different from mainnet', () => {
    expect(DEVNET_PROGRAM_ID.equals(MAINNET_PROGRAM_ID)).toBe(false);
  });

  it('TOKEN_PROGRAM_ID is the legacy SPL token program', () => {
    expect(TOKEN_PROGRAM_ID.toBase58()).toBe('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  });

  it('TOKEN_2022_PROGRAM_ID is the Token-2022 program', () => {
    expect(TOKEN_2022_PROGRAM_ID.toBase58()).toBe('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
  });

  it('DLMM_PROGRAM_ID matches Meteora mainnet', () => {
    expect(DLMM_PROGRAM_ID.toBase58()).toBe('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');
  });

  it('seed strings match expected values', () => {
    expect(PROTOCOL_STATE_SEED).toBe('protocol_state');
    expect(MARKET_VAULT_SEED).toBe('market_vault');
    expect(MARKET_POSITION_SEED).toBe('market_position');
    expect(GLOBAL_ROOT_SEED).toBe('global_root');
    expect(CLAIM_STATE_GLOBAL_SEED).toBe('claim_global');
    expect(CHANNEL_CONFIG_V2_SEED).toBe('channel_cfg_v2');
  });
});

// ── Account parsers ─────────────────────────────────────

describe('parseMarketVault', () => {
  it('extracts depositMint at correct offset', () => {
    // Build a fake MarketVault buffer: 8 disc + 1 bump + 8 marketId + 32 depositMint + ...
    const buf = Buffer.alloc(8 + 1 + 8 + 32 + 32 + 32 + 16);
    USDC_MINT.toBuffer().copy(buf, 8 + 1 + 8); // depositMint at offset 17
    CCM_MINT.toBuffer().copy(buf, 8 + 1 + 8 + 32); // vlofiMint at offset 49

    const vault = parseMarketVault(buf);
    expect(vault.depositMint.equals(USDC_MINT)).toBe(true);
  });

  it('extracts vlofiMint at correct offset', () => {
    const buf = Buffer.alloc(8 + 1 + 8 + 32 + 32 + 32 + 16);
    USDC_MINT.toBuffer().copy(buf, 8 + 1 + 8);
    CCM_MINT.toBuffer().copy(buf, 8 + 1 + 8 + 32);

    const vault = parseMarketVault(buf);
    expect(vault.vlofiMint.equals(CCM_MINT)).toBe(true);
  });

  it('reads bump from first byte after discriminator', () => {
    const buf = Buffer.alloc(8 + 1 + 8 + 32 + 32 + 32 + 16);
    buf[8] = 254; // bump

    const vault = parseMarketVault(buf);
    expect(vault.bump).toBe(254);
  });
});

describe('parseProtocolState', () => {
  it('reads isInitialized correctly', () => {
    const buf = Buffer.alloc(8 + 165);
    buf[8] = 1; // isInitialized

    const state = parseProtocolState(buf);
    expect(state.isInitialized).toBe(true);
  });

  it('reads paused flag correctly', () => {
    const buf = Buffer.alloc(8 + 165);
    buf[8 + 162] = 1; // paused

    const state = parseProtocolState(buf);
    expect(state.paused).toBe(true);
  });

  it('reads version byte', () => {
    const buf = Buffer.alloc(8 + 165);
    buf[8 + 1] = 3; // version

    const state = parseProtocolState(buf);
    expect(state.version).toBe(3);
  });
});

describe('parseUserMarketPosition', () => {
  it('returns null for data too short', () => {
    const buf = Buffer.alloc(50);
    expect(parseUserMarketPosition(buf)).toBeNull();
  });

  it('reads settled flag correctly', () => {
    const buf = Buffer.alloc(114);
    buf[8 + 89] = 1; // settled

    const pos = parseUserMarketPosition(buf);
    expect(pos).not.toBeNull();
    expect(pos!.settled).toBe(true);
  });

  it('reads depositedAmount as u64 LE', () => {
    const buf = Buffer.alloc(114);
    buf.writeBigUInt64LE(1_000_000n, 8 + 1 + 32 + 32); // depositedAmount at offset 73 from disc

    const pos = parseUserMarketPosition(buf);
    expect(pos).not.toBeNull();
    expect(pos!.depositedAmount).toBe(1_000_000n);
  });
});
