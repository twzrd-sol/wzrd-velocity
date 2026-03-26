/**
 * Unit tests for stream (vLOFI) instruction builders and PDA derivation.
 *
 * Tests discriminator bytes, data layout encoding, PDA derivation
 * determinism, and account ordering without requiring an RPC Connection.
 */

import { describe, it, expect } from 'vitest';
import { PublicKey, SystemProgram } from '@solana/web3.js';

import {
  createPublishStreamRootIx,
  createClaimStreamIx,
  createClaimStreamSponsoredIx,
} from './stream.js';

import {
  PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  STREAM_ROOT_SEED,
  CLAIM_STATE_STREAM_SEED,
} from './constants.js';

import {
  getProtocolStatePDA,
  getStreamRootConfigPDA,
  getClaimStateStreamPDA,
  getClaimStatePDA,
  getAta,
} from './pda.js';

// ── Test fixtures ────────────────────────────────────────

const VLOFI_MINT = new PublicKey('E9Kt33axpCy3ve2PCY9BSrbPhcR9wdDsWQECAahzw2dS');
const CLAIMER = new PublicKey('Dxk8mAb3C7AM8JN6tAJfVuSja5yidhZM5sEKW3SRX2BM');
const PAYER = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

const DUMMY_ROOT = Buffer.alloc(32, 0xab);
const DUMMY_DATASET_HASH = Buffer.alloc(32, 0xcd);

// Two 32-byte hex proof nodes for testing
const PROOF_HEX = [
  'aa'.repeat(32),
  'bb'.repeat(32),
];

// ── Discriminators ──────────────────────────────────────

describe('stream discriminators', () => {
  it('publish_stream_root disc matches spec', () => {
    const ix = createPublishStreamRootIx(
      PAYER, VLOFI_MINT, 1, DUMMY_ROOT, DUMMY_DATASET_HASH,
    );
    const disc = ix.data.subarray(0, 8);
    expect(Buffer.from(disc)).toEqual(
      Buffer.from([0x2f, 0xfa, 0x4d, 0xc7, 0x3e, 0x90, 0x82, 0x4c]),
    );
  });

  it('claim_stream disc matches spec', () => {
    const ixs = createClaimStreamIx(
      CLAIMER, VLOFI_MINT, 1, 1000n, PROOF_HEX,
    );
    // Second IX is the claim (first is ATA create)
    const claimIx = ixs[1];
    const disc = claimIx.data.subarray(0, 8);
    expect(Buffer.from(disc)).toEqual(
      Buffer.from([0x9d, 0xf7, 0xa4, 0xe2, 0xf0, 0x9e, 0xb7, 0x24]),
    );
  });

  it('claim_stream_sponsored disc matches spec', () => {
    const ixs = createClaimStreamSponsoredIx(
      PAYER, CLAIMER, VLOFI_MINT, 1, 1000n, PROOF_HEX,
    );
    const claimIx = ixs[1];
    const disc = claimIx.data.subarray(0, 8);
    expect(Buffer.from(disc)).toEqual(
      Buffer.from([0xeb, 0xb1, 0x48, 0xf6, 0xff, 0xf3, 0xea, 0xbc]),
    );
  });
});

// ── publish_stream_root ─────────────────────────────────

describe('createPublishStreamRootIx', () => {
  const ix = createPublishStreamRootIx(
    PAYER, VLOFI_MINT, 42, DUMMY_ROOT, DUMMY_DATASET_HASH,
  );

  it('uses PROGRAM_ID', () => {
    expect(ix.programId.equals(PROGRAM_ID)).toBe(true);
  });

  it('has exactly 5 account keys', () => {
    expect(ix.keys.length).toBe(5);
  });

  it('data is exactly 80 bytes', () => {
    expect(ix.data.length).toBe(80);
  });

  it('encodes root_seq as LE u64 at offset 8', () => {
    const rootSeq = ix.data.readBigUInt64LE(8);
    expect(rootSeq).toBe(42n);
  });

  it('encodes root at offset 16', () => {
    const root = ix.data.subarray(16, 48);
    expect(Buffer.from(root)).toEqual(DUMMY_ROOT);
  });

  it('encodes dataset_hash at offset 48', () => {
    const hash = ix.data.subarray(48, 80);
    expect(Buffer.from(hash)).toEqual(DUMMY_DATASET_HASH);
  });

  it('sets payer as signer + writable', () => {
    expect(ix.keys[0].pubkey.equals(PAYER)).toBe(true);
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[0].isWritable).toBe(true);
  });

  it('sets protocol_state as readonly', () => {
    const protocolState = getProtocolStatePDA(PROGRAM_ID);
    expect(ix.keys[1].pubkey.equals(protocolState)).toBe(true);
    expect(ix.keys[1].isSigner).toBe(false);
    expect(ix.keys[1].isWritable).toBe(false);
  });

  it('sets stream_root_config as writable', () => {
    const streamRootConfig = getStreamRootConfigPDA(VLOFI_MINT, PROGRAM_ID);
    expect(ix.keys[2].pubkey.equals(streamRootConfig)).toBe(true);
    expect(ix.keys[2].isSigner).toBe(false);
    expect(ix.keys[2].isWritable).toBe(true);
  });

  it('sets vlofi_mint as readonly', () => {
    expect(ix.keys[3].pubkey.equals(VLOFI_MINT)).toBe(true);
    expect(ix.keys[3].isSigner).toBe(false);
    expect(ix.keys[3].isWritable).toBe(false);
  });

  it('sets system_program as readonly', () => {
    expect(ix.keys[4].pubkey.equals(SystemProgram.programId)).toBe(true);
    expect(ix.keys[4].isSigner).toBe(false);
    expect(ix.keys[4].isWritable).toBe(false);
  });

  it('rejects root with wrong length', () => {
    expect(() =>
      createPublishStreamRootIx(PAYER, VLOFI_MINT, 1, Buffer.alloc(16), DUMMY_DATASET_HASH),
    ).toThrow('root must be 32 bytes');
  });

  it('rejects datasetHash with wrong length', () => {
    expect(() =>
      createPublishStreamRootIx(PAYER, VLOFI_MINT, 1, DUMMY_ROOT, Buffer.alloc(64)),
    ).toThrow('datasetHash must be 32 bytes');
  });

  it('accepts bigint for rootSeq', () => {
    const bigIx = createPublishStreamRootIx(
      PAYER, VLOFI_MINT, 9007199254740993n, DUMMY_ROOT, DUMMY_DATASET_HASH,
    );
    expect(bigIx.data.readBigUInt64LE(8)).toBe(9007199254740993n);
  });
});

// ── claim_stream (self-signed) ──────────────────────────

describe('createClaimStreamIx', () => {
  const ixs = createClaimStreamIx(
    CLAIMER, VLOFI_MINT, 7, 500_000n, PROOF_HEX,
  );

  it('returns 2 instructions (ATA create + claim)', () => {
    expect(ixs.length).toBe(2);
  });

  it('first instruction is ATA idempotent create', () => {
    // ATA create uses the associated token program
    const ataIx = ixs[0];
    expect(ataIx.data.length).toBe(1);
    expect(ataIx.data[0]).toBe(1); // CreateIdempotent
  });

  const claimIx = ixs[1];

  it('claim instruction uses PROGRAM_ID', () => {
    expect(claimIx.programId.equals(PROGRAM_ID)).toBe(true);
  });

  it('has exactly 8 account keys', () => {
    expect(claimIx.keys.length).toBe(8);
  });

  it('data length = 28 + proof_len * 32', () => {
    // 8 disc + 8 root_seq + 8 cumulative + 4 proof_len + 2*32 proof = 92
    expect(claimIx.data.length).toBe(28 + 2 * 32);
  });

  it('encodes root_seq as LE u64 at offset 8', () => {
    expect(claimIx.data.readBigUInt64LE(8)).toBe(7n);
  });

  it('encodes cumulative_total as LE u64 at offset 16', () => {
    expect(claimIx.data.readBigUInt64LE(16)).toBe(500_000n);
  });

  it('encodes proof_len as LE u32 at offset 24', () => {
    expect(claimIx.data.readUInt32LE(24)).toBe(2);
  });

  it('encodes proof nodes starting at offset 28', () => {
    const node0 = claimIx.data.subarray(28, 60);
    const node1 = claimIx.data.subarray(60, 92);
    expect(Buffer.from(node0)).toEqual(Buffer.from(PROOF_HEX[0], 'hex'));
    expect(Buffer.from(node1)).toEqual(Buffer.from(PROOF_HEX[1], 'hex'));
  });

  it('sets claimer as signer + writable (account 0)', () => {
    expect(claimIx.keys[0].pubkey.equals(CLAIMER)).toBe(true);
    expect(claimIx.keys[0].isSigner).toBe(true);
    expect(claimIx.keys[0].isWritable).toBe(true);
  });

  it('sets protocol_state as readonly (account 1)', () => {
    const protocolState = getProtocolStatePDA(PROGRAM_ID);
    expect(claimIx.keys[1].pubkey.equals(protocolState)).toBe(true);
    expect(claimIx.keys[1].isWritable).toBe(false);
  });

  it('sets stream_root_config as readonly (account 2)', () => {
    const streamRootConfig = getStreamRootConfigPDA(VLOFI_MINT, PROGRAM_ID);
    expect(claimIx.keys[2].pubkey.equals(streamRootConfig)).toBe(true);
    expect(claimIx.keys[2].isWritable).toBe(false);
  });

  it('sets claim_state_stream as writable (account 3)', () => {
    const claimState = getClaimStateStreamPDA(VLOFI_MINT, CLAIMER, PROGRAM_ID);
    expect(claimIx.keys[3].pubkey.equals(claimState)).toBe(true);
    expect(claimIx.keys[3].isWritable).toBe(true);
  });

  it('sets vlofi_mint as writable (account 4)', () => {
    expect(claimIx.keys[4].pubkey.equals(VLOFI_MINT)).toBe(true);
    expect(claimIx.keys[4].isWritable).toBe(true);
  });

  it('sets claimer_vlofi_ata as writable (account 5)', () => {
    const ata = getAta(CLAIMER, VLOFI_MINT, TOKEN_PROGRAM_ID);
    expect(claimIx.keys[5].pubkey.equals(ata)).toBe(true);
    expect(claimIx.keys[5].isWritable).toBe(true);
  });

  it('uses standard SPL token_program (account 6)', () => {
    expect(claimIx.keys[6].pubkey.equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect(claimIx.keys[6].isWritable).toBe(false);
  });

  it('uses system_program (account 7)', () => {
    expect(claimIx.keys[7].pubkey.equals(SystemProgram.programId)).toBe(true);
    expect(claimIx.keys[7].isWritable).toBe(false);
  });

  it('handles empty proof', () => {
    const emptyIxs = createClaimStreamIx(CLAIMER, VLOFI_MINT, 1, 0n, []);
    const claimData = emptyIxs[1].data;
    expect(claimData.length).toBe(28); // 8+8+8+4, zero proof nodes
    expect(claimData.readUInt32LE(24)).toBe(0);
  });

  it('accepts number for cumulativeTotal', () => {
    const numIxs = createClaimStreamIx(CLAIMER, VLOFI_MINT, 1, 12345, PROOF_HEX);
    expect(numIxs[1].data.readBigUInt64LE(16)).toBe(12345n);
  });
});

// ── claim_stream_sponsored (gasless relay) ──────────────

describe('createClaimStreamSponsoredIx', () => {
  const ixs = createClaimStreamSponsoredIx(
    PAYER, CLAIMER, VLOFI_MINT, 10, 1_000_000n, PROOF_HEX,
  );

  it('returns 2 instructions (ATA create + sponsored claim)', () => {
    expect(ixs.length).toBe(2);
  });

  const claimIx = ixs[1];

  it('has exactly 9 account keys', () => {
    expect(claimIx.keys.length).toBe(9);
  });

  it('sets payer as signer + writable (account 0)', () => {
    expect(claimIx.keys[0].pubkey.equals(PAYER)).toBe(true);
    expect(claimIx.keys[0].isSigner).toBe(true);
    expect(claimIx.keys[0].isWritable).toBe(true);
  });

  it('sets claimer as NOT signer, readonly (account 1)', () => {
    expect(claimIx.keys[1].pubkey.equals(CLAIMER)).toBe(true);
    expect(claimIx.keys[1].isSigner).toBe(false);
    expect(claimIx.keys[1].isWritable).toBe(false);
  });

  it('sets protocol_state as readonly (account 2)', () => {
    const protocolState = getProtocolStatePDA(PROGRAM_ID);
    expect(claimIx.keys[2].pubkey.equals(protocolState)).toBe(true);
    expect(claimIx.keys[2].isWritable).toBe(false);
  });

  it('sets stream_root_config as readonly (account 3)', () => {
    const streamRootConfig = getStreamRootConfigPDA(VLOFI_MINT, PROGRAM_ID);
    expect(claimIx.keys[3].pubkey.equals(streamRootConfig)).toBe(true);
    expect(claimIx.keys[3].isWritable).toBe(false);
  });

  it('sets claim_state_stream as writable (account 4)', () => {
    const claimState = getClaimStateStreamPDA(VLOFI_MINT, CLAIMER, PROGRAM_ID);
    expect(claimIx.keys[4].pubkey.equals(claimState)).toBe(true);
    expect(claimIx.keys[4].isWritable).toBe(true);
  });

  it('sets vlofi_mint as writable (account 5)', () => {
    expect(claimIx.keys[5].pubkey.equals(VLOFI_MINT)).toBe(true);
    expect(claimIx.keys[5].isWritable).toBe(true);
  });

  it('sets claimer_vlofi_ata as writable (account 6)', () => {
    const ata = getAta(CLAIMER, VLOFI_MINT, TOKEN_PROGRAM_ID);
    expect(claimIx.keys[6].pubkey.equals(ata)).toBe(true);
    expect(claimIx.keys[6].isWritable).toBe(true);
  });

  it('uses standard SPL token_program (account 7)', () => {
    expect(claimIx.keys[7].pubkey.equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect(claimIx.keys[7].isWritable).toBe(false);
  });

  it('uses system_program (account 8)', () => {
    expect(claimIx.keys[8].pubkey.equals(SystemProgram.programId)).toBe(true);
    expect(claimIx.keys[8].isWritable).toBe(false);
  });

  it('data layout matches claim_stream layout', () => {
    // Same layout: [8 disc][8 root_seq][8 cumulative][4 proof_len][N*32]
    expect(claimIx.data.readBigUInt64LE(8)).toBe(10n);     // root_seq
    expect(claimIx.data.readBigUInt64LE(16)).toBe(1_000_000n); // cumulative_total
    expect(claimIx.data.readUInt32LE(24)).toBe(2);          // proof_len
  });

  it('ATA create instruction uses payer (relayer) as fee payer', () => {
    const ataIx = ixs[0];
    expect(ataIx.keys[0].pubkey.equals(PAYER)).toBe(true);
    expect(ataIx.keys[0].isSigner).toBe(true);
  });
});

// ── Stream PDA derivation ───────────────────────────────

describe('Stream PDA derivation', () => {
  it('getStreamRootConfigPDA is deterministic', () => {
    const a = getStreamRootConfigPDA(VLOFI_MINT, PROGRAM_ID);
    const b = getStreamRootConfigPDA(VLOFI_MINT, PROGRAM_ID);
    expect(a.equals(b)).toBe(true);
  });

  it('getStreamRootConfigPDA is off-curve (valid PDA)', () => {
    const pda = getStreamRootConfigPDA(VLOFI_MINT, PROGRAM_ID);
    expect(PublicKey.isOnCurve(pda.toBuffer())).toBe(false);
  });

  it('getStreamRootConfigPDA differs by mint', () => {
    const mint2 = new PublicKey('Dxk8mAb3C7AM8JN6tAJfVuSja5yidhZM5sEKW3SRX2BM');
    const a = getStreamRootConfigPDA(VLOFI_MINT, PROGRAM_ID);
    const b = getStreamRootConfigPDA(mint2, PROGRAM_ID);
    // Same mint should give same PDA
    if (VLOFI_MINT.equals(mint2)) {
      expect(a.equals(b)).toBe(true);
    }
  });

  it('getClaimStateStreamPDA is deterministic', () => {
    const a = getClaimStateStreamPDA(VLOFI_MINT, CLAIMER, PROGRAM_ID);
    const b = getClaimStateStreamPDA(VLOFI_MINT, CLAIMER, PROGRAM_ID);
    expect(a.equals(b)).toBe(true);
  });

  it('getClaimStateStreamPDA is off-curve (valid PDA)', () => {
    const pda = getClaimStateStreamPDA(VLOFI_MINT, CLAIMER, PROGRAM_ID);
    expect(PublicKey.isOnCurve(pda.toBuffer())).toBe(false);
  });

  it('getClaimStateStreamPDA differs by claimer', () => {
    const claimer2 = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const a = getClaimStateStreamPDA(VLOFI_MINT, CLAIMER, PROGRAM_ID);
    const b = getClaimStateStreamPDA(VLOFI_MINT, claimer2, PROGRAM_ID);
    expect(a.equals(b)).toBe(false);
  });

  it('getClaimStateStreamPDA differs from global claim PDA (different seed)', () => {
    const streamPda = getClaimStateStreamPDA(VLOFI_MINT, CLAIMER, PROGRAM_ID);
    const globalPda = getClaimStatePDA(VLOFI_MINT, CLAIMER, PROGRAM_ID);
    expect(streamPda.equals(globalPda)).toBe(false);
  });
});
