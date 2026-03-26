/**
 * Instruction builders for the wzrd-stream vLOFI claim system.
 *
 * Builds publish_stream_root, claim_stream, and claim_stream_sponsored
 * TransactionInstructions for the vLOFI streaming distribution pipeline.
 *
 * Unlike CCM global claims (Token-2022), stream claims use standard SPL
 * token program for vLOFI minting.
 */

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';

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
  getAta,
} from './pda.js';

import { createAtaIdempotentIx } from './instructions.js';

// ── Discriminators (pre-computed, matching on-chain program) ─────────

/** publish_stream_root discriminator: SHA-256("global:publish_stream_root")[0..8] */
const PUBLISH_STREAM_ROOT_DISC = Buffer.from([
  0x2f, 0xfa, 0x4d, 0xc7, 0x3e, 0x90, 0x82, 0x4c,
]);

/** claim_stream discriminator: SHA-256("global:claim_stream")[0..8] */
const CLAIM_STREAM_DISC = Buffer.from([
  0x9d, 0xf7, 0xa4, 0xe2, 0xf0, 0x9e, 0xb7, 0x24,
]);

/** claim_stream_sponsored discriminator: SHA-256("global:claim_stream_sponsored")[0..8] */
const CLAIM_STREAM_SPONSORED_DISC = Buffer.from([
  0xeb, 0xb1, 0x48, 0xf6, 0xff, 0xf3, 0xea, 0xbc,
]);

// ── publish_stream_root ─────────────────────────────────────────────

/**
 * Build a `publish_stream_root` TransactionInstruction.
 *
 * Publishes a new merkle root for vLOFI stream distribution.
 *
 * Accounts (order must match PublishStreamRoot struct):
 *   0. payer              (signer, writable) - admin or publisher
 *   1. protocol_state     (readonly)
 *   2. stream_root_config (writable) - PDA: seeds=[b"stream_root", vlofiMint]
 *   3. vlofi_mint         (readonly)
 *   4. system_program     (readonly)
 *
 * Data layout: [8 disc][8 root_seq LE][32 root][32 dataset_hash] = 80 bytes
 *
 * @param payer       - Admin or authorized publisher (signer)
 * @param vlofiMint   - vLOFI mint address
 * @param rootSeq     - Monotonically increasing root sequence number
 * @param root        - 32-byte merkle root hash
 * @param datasetHash - 32-byte dataset hash for auditability
 * @param programId   - Program ID (defaults to mainnet)
 */
export function createPublishStreamRootIx(
  payer: PublicKey,
  vlofiMint: PublicKey,
  rootSeq: number | bigint,
  root: Uint8Array | Buffer,
  datasetHash: Uint8Array | Buffer,
  programId: PublicKey = PROGRAM_ID,
): TransactionInstruction {
  if (root.length !== 32) {
    throw new Error(`root must be 32 bytes, got ${root.length}`);
  }
  if (datasetHash.length !== 32) {
    throw new Error(`datasetHash must be 32 bytes, got ${datasetHash.length}`);
  }

  const protocolState = getProtocolStatePDA(programId);
  const streamRootConfig = getStreamRootConfigPDA(vlofiMint, programId);

  // Data: [8 disc][8 root_seq LE][32 root][32 dataset_hash] = 80 bytes
  const data = Buffer.alloc(80);
  let offset = 0;

  PUBLISH_STREAM_ROOT_DISC.copy(data, offset); offset += 8;
  data.writeBigUInt64LE(BigInt(rootSeq), offset); offset += 8;
  Buffer.from(root).copy(data, offset); offset += 32;
  Buffer.from(datasetHash).copy(data, offset);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: streamRootConfig, isSigner: false, isWritable: true },
      { pubkey: vlofiMint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── claim_stream (self-signed) ──────────────────────────────────────

/**
 * Build a `claim_stream` TransactionInstruction (self-signed).
 *
 * Claims vLOFI tokens from the stream distribution merkle tree.
 * The claimer signs the transaction themselves.
 *
 * Accounts (order must match ClaimStream struct):
 *   0. claimer            (signer, writable)
 *   1. protocol_state     (readonly)
 *   2. stream_root_config (readonly)
 *   3. claim_state_stream (writable) - PDA: seeds=[b"claim_stream", vlofiMint, claimer]
 *   4. vlofi_mint         (writable) - for mint_to
 *   5. claimer_vlofi_ata  (writable) - ATA(claimer, vlofiMint, TOKEN_PROGRAM)
 *   6. token_program      (readonly) - standard SPL Token
 *   7. system_program     (readonly)
 *
 * Data layout: [8 disc][8 root_seq LE][8 cumulative_total LE][4 proof_len LE][proof_len * 32 proof_nodes]
 *
 * @param claimer         - Wallet claiming vLOFI (signer)
 * @param vlofiMint       - vLOFI mint address
 * @param rootSeq         - Root sequence number to claim against
 * @param cumulativeTotal - Cumulative vLOFI amount entitled (native units)
 * @param proofHex        - Hex-encoded 32-byte merkle proof sibling hashes
 * @param programId       - Program ID (defaults to mainnet)
 * @returns Array of instructions: idempotent ATA create + claim IX
 */
export function createClaimStreamIx(
  claimer: PublicKey,
  vlofiMint: PublicKey,
  rootSeq: number | bigint,
  cumulativeTotal: bigint | number,
  proofHex: string[],
  programId: PublicKey = PROGRAM_ID,
): TransactionInstruction[] {
  const protocolState = getProtocolStatePDA(programId);
  const streamRootConfig = getStreamRootConfigPDA(vlofiMint, programId);
  const claimStateStream = getClaimStateStreamPDA(vlofiMint, claimer, programId);
  const claimerVlofiAta = getAta(claimer, vlofiMint, TOKEN_PROGRAM_ID);

  // Prepend idempotent ATA creation for claimer's vLOFI account
  const ixs: TransactionInstruction[] = [
    createAtaIdempotentIx(claimer, claimerVlofiAta, claimer, vlofiMint, TOKEN_PROGRAM_ID),
  ];

  const proofBytes = proofHex.map((h) => Buffer.from(h, 'hex'));

  // Data: [8 disc][8 root_seq LE][8 cumulative_total LE][4 proof_len LE][N * 32 proof]
  const dataLen = 8 + 8 + 8 + 4 + proofBytes.length * 32;
  const data = Buffer.alloc(dataLen);
  let offset = 0;

  CLAIM_STREAM_DISC.copy(data, offset); offset += 8;
  data.writeBigUInt64LE(BigInt(rootSeq), offset); offset += 8;
  data.writeBigUInt64LE(BigInt(cumulativeTotal), offset); offset += 8;
  data.writeUInt32LE(proofBytes.length, offset); offset += 4;
  for (const node of proofBytes) {
    node.copy(data, offset);
    offset += 32;
  }

  ixs.push(new TransactionInstruction({
    programId,
    keys: [
      { pubkey: claimer, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: streamRootConfig, isSigner: false, isWritable: false },
      { pubkey: claimStateStream, isSigner: false, isWritable: true },
      { pubkey: vlofiMint, isSigner: false, isWritable: true },
      { pubkey: claimerVlofiAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  }));

  return ixs;
}

// ── claim_stream_sponsored (gasless relay) ──────────────────────────

/**
 * Build a `claim_stream_sponsored` TransactionInstruction (gasless relay).
 *
 * A relayer pays for the transaction while vLOFI goes to the claimer.
 * The claimer does NOT need to sign.
 *
 * Accounts (order must match ClaimStreamSponsored struct):
 *   0. payer              (signer, writable) - relayer
 *   1. claimer            (readonly, NOT signer)
 *   2. protocol_state     (readonly)
 *   3. stream_root_config (readonly)
 *   4. claim_state_stream (writable)
 *   5. vlofi_mint         (writable)
 *   6. claimer_vlofi_ata  (writable)
 *   7. token_program      (readonly)
 *   8. system_program     (readonly)
 *
 * Data layout: same as claim_stream
 *
 * @param payer           - Relayer wallet (signer, pays fees)
 * @param claimer         - Wallet receiving vLOFI (NOT a signer)
 * @param vlofiMint       - vLOFI mint address
 * @param rootSeq         - Root sequence number to claim against
 * @param cumulativeTotal - Cumulative vLOFI amount entitled (native units)
 * @param proofHex        - Hex-encoded 32-byte merkle proof sibling hashes
 * @param programId       - Program ID (defaults to mainnet)
 * @returns Array of instructions: idempotent ATA create + sponsored claim IX
 */
export function createClaimStreamSponsoredIx(
  payer: PublicKey,
  claimer: PublicKey,
  vlofiMint: PublicKey,
  rootSeq: number | bigint,
  cumulativeTotal: bigint | number,
  proofHex: string[],
  programId: PublicKey = PROGRAM_ID,
): TransactionInstruction[] {
  const protocolState = getProtocolStatePDA(programId);
  const streamRootConfig = getStreamRootConfigPDA(vlofiMint, programId);
  const claimStateStream = getClaimStateStreamPDA(vlofiMint, claimer, programId);
  const claimerVlofiAta = getAta(claimer, vlofiMint, TOKEN_PROGRAM_ID);

  // Relayer pays for ATA creation if needed
  const ixs: TransactionInstruction[] = [
    createAtaIdempotentIx(payer, claimerVlofiAta, claimer, vlofiMint, TOKEN_PROGRAM_ID),
  ];

  const proofBytes = proofHex.map((h) => Buffer.from(h, 'hex'));

  // Data: [8 disc][8 root_seq LE][8 cumulative_total LE][4 proof_len LE][N * 32 proof]
  const dataLen = 8 + 8 + 8 + 4 + proofBytes.length * 32;
  const data = Buffer.alloc(dataLen);
  let offset = 0;

  CLAIM_STREAM_SPONSORED_DISC.copy(data, offset); offset += 8;
  data.writeBigUInt64LE(BigInt(rootSeq), offset); offset += 8;
  data.writeBigUInt64LE(BigInt(cumulativeTotal), offset); offset += 8;
  data.writeUInt32LE(proofBytes.length, offset); offset += 4;
  for (const node of proofBytes) {
    node.copy(data, offset);
    offset += 32;
  }

  ixs.push(new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: claimer, isSigner: false, isWritable: false },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: streamRootConfig, isSigner: false, isWritable: false },
      { pubkey: claimStateStream, isSigner: false, isWritable: true },
      { pubkey: vlofiMint, isSigner: false, isWritable: true },
      { pubkey: claimerVlofiAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  }));

  return ixs;
}
