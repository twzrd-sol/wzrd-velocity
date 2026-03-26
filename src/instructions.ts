/**
 * Instruction builders for the Liquid Attention Protocol.
 *
 * Builds deposit_market, settle_market, and claim_global TransactionInstructions
 * that the wallet adapter signs directly — no server signing needed.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';

import {
  PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
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

import { parseMarketVault, parseProtocolState } from './accounts.js';

// ── Helpers ────────────────────────────────────────────

/**
 * Anchor instruction discriminator: first 8 bytes of SHA-256("global:<name>").
 * Works in both browser (WebCrypto) and Node.js (crypto module) environments.
 */
export async function anchorDisc(name: string): Promise<Buffer> {
  const preimage = `global:${name}`;

  // Node.js path — use built-in crypto module
  if (typeof globalThis.process !== 'undefined') {
    const { createHash } = await import('crypto');
    const hash = createHash('sha256').update(preimage).digest();
    return Buffer.from(hash.subarray(0, 8));
  }

  // Browser path — WebCrypto
  const encoded = new TextEncoder().encode(preimage);
  const hash = await crypto.subtle.digest('SHA-256', encoded.buffer as ArrayBuffer);
  return Buffer.from(new Uint8Array(hash).slice(0, 8));
}

/** Build a CreateIdempotent ATA instruction (instruction index 1). Never fails if ATA exists. */
export function createAtaIdempotentIx(
  payer: PublicKey,
  ata: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgramId: PublicKey = TOKEN_PROGRAM_ID,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]), // CreateIdempotent
  });
}

// ── Meteora DLMM LP Helpers ──────────────────────────────

/**
 * Meteora DLMM program ID (mainnet).
 * Used for addLiquidity / removeLiquidity instructions.
 */
export const DLMM_PROGRAM_ID = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');

/**
 * Build a Meteora DLMM `addLiquidity` TransactionInstruction.
 *
 * This is the agent LP pattern: deposit CCM + counterpart (SOL/USDC) into
 * a DLMM concentrated liquidity position to earn swap fees from other agents.
 *
 * Note: For Token-2022 mints like CCM, transfer fees are deducted automatically
 * on transfer_checked. The DLMM program handles this internally.
 *
 * @param pool - DLMM pool address (e.g., CCM/SOL, CCM/USDC)
 * @param position - Position account (create with DLMM initPosition first)
 * @param owner - Position owner (signer)
 * @param tokenXMint - Pool token X mint
 * @param tokenYMint - Pool token Y mint
 * @param userTokenX - Owner's token X ATA
 * @param userTokenY - Owner's token Y ATA
 * @param reserveX - Pool reserve X account
 * @param reserveY - Pool reserve Y account
 * @param binArrayLower - Lower bin array account
 * @param binArrayUpper - Upper bin array account
 * @param amountX - Token X amount (native units)
 * @param amountY - Token Y amount (native units)
 */
export function createAddLiquidityIx(
  pool: PublicKey,
  position: PublicKey,
  owner: PublicKey,
  tokenXMint: PublicKey,
  tokenYMint: PublicKey,
  userTokenX: PublicKey,
  userTokenY: PublicKey,
  reserveX: PublicKey,
  reserveY: PublicKey,
  binArrayLower: PublicKey,
  binArrayUpper: PublicKey,
  amountX: bigint,
  amountY: bigint,
  activeBinId: number,
  binCount: number,
  tokenXProgram: PublicKey = TOKEN_PROGRAM_ID,
  tokenYProgram: PublicKey = TOKEN_2022_PROGRAM_ID,
): TransactionInstruction {
  // Meteora addLiquidityByStrategy disc = SHA-256("global:add_liquidity_by_strategy")[0..8]
  // Strategy: Spot distribution centered on activeBinId
  const disc = Buffer.from([28, 190, 93, 94, 229, 198, 83, 56]); // add_liquidity_by_strategy
  const data = Buffer.alloc(8 + 8 + 8 + 4 + 4 + 1);
  disc.copy(data, 0);
  data.writeBigUInt64LE(amountX, 8);
  data.writeBigUInt64LE(amountY, 16);
  data.writeInt32LE(activeBinId, 24);
  data.writeInt32LE(binCount, 28);
  data.writeUInt8(0, 32); // StrategyType::Spot

  return new TransactionInstruction({
    programId: DLMM_PROGRAM_ID,
    keys: [
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: binArrayLower, isSigner: false, isWritable: true },
      { pubkey: binArrayUpper, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: reserveX, isSigner: false, isWritable: true },
      { pubkey: reserveY, isSigner: false, isWritable: true },
      { pubkey: userTokenX, isSigner: false, isWritable: true },
      { pubkey: userTokenY, isSigner: false, isWritable: true },
      { pubkey: tokenXMint, isSigner: false, isWritable: false },
      { pubkey: tokenYMint, isSigner: false, isWritable: false },
      { pubkey: tokenXProgram, isSigner: false, isWritable: false },
      { pubkey: tokenYProgram, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Build a Meteora DLMM `removeLiquidity` TransactionInstruction.
 *
 * Agent pattern: withdraw LP position to recover tokens and accrued fees.
 */
export function createRemoveLiquidityIx(
  pool: PublicKey,
  position: PublicKey,
  owner: PublicKey,
  reserveX: PublicKey,
  reserveY: PublicKey,
  userTokenX: PublicKey,
  userTokenY: PublicKey,
  tokenXMint: PublicKey,
  tokenYMint: PublicKey,
  binArrayLower: PublicKey,
  binArrayUpper: PublicKey,
  bpsBasisPointsToRemove: number,
  tokenXProgram: PublicKey = TOKEN_PROGRAM_ID,
  tokenYProgram: PublicKey = TOKEN_2022_PROGRAM_ID,
): TransactionInstruction {
  const disc = Buffer.from([80, 85, 209, 72, 24, 206, 177, 108]); // remove_liquidity
  const data = Buffer.alloc(8 + 2);
  disc.copy(data, 0);
  data.writeUInt16LE(bpsBasisPointsToRemove, 8); // 10000 = 100%

  return new TransactionInstruction({
    programId: DLMM_PROGRAM_ID,
    keys: [
      { pubkey: position, isSigner: false, isWritable: true },
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: binArrayLower, isSigner: false, isWritable: true },
      { pubkey: binArrayUpper, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: reserveX, isSigner: false, isWritable: true },
      { pubkey: reserveY, isSigner: false, isWritable: true },
      { pubkey: userTokenX, isSigner: false, isWritable: true },
      { pubkey: userTokenY, isSigner: false, isWritable: true },
      { pubkey: tokenXMint, isSigner: false, isWritable: false },
      { pubkey: tokenYMint, isSigner: false, isWritable: false },
      { pubkey: tokenXProgram, isSigner: false, isWritable: false },
      { pubkey: tokenYProgram, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── Instruction Builders ───────────────────────────────

/**
 * `settle_market` account layout mode.
 *
 * `legacy_ccm` matches the currently deployed mainnet ABI, which still validates
 * `ccm_mint` / `user_ccm_ata` accounts even though the instruction no longer mints CCM.
 * `current` matches the slimmer source layout after those accounts were removed.
 * `auto` selects `legacy_ccm` for the current mainnet program ID and `current` otherwise.
 */
export type SettleAccountsMode = 'auto' | 'current' | 'legacy_ccm';

/**
 * Build a `deposit_market` TransactionInstruction.
 *
 * Accounts (order must match DepositMarket struct in vault.rs):
 *   0. user              (signer, writable)
 *   1. protocol_state    (readonly)
 *   2. market_vault      (writable)
 *   3. user_market_position (writable)
 *   4. user_usdc_ata     (writable)
 *   5. vault_usdc_ata    (writable)
 *   6. vlofi_mint        (writable)
 *   7. user_vlofi_ata    (writable)
 *   8. token_program     (readonly)
 *   9. token_2022_program (readonly)
 *  10. system_program    (readonly)
 *
 * @returns Array of instructions: idempotent ATA creates + the deposit IX.
 */
export async function createDepositMarketIx(
  connection: Connection,
  user: PublicKey,
  marketId: number,
  /** USDC amount in native units (6 decimals, e.g., 1_000_000 = 1 USDC) */
  amount: bigint | number,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction[]> {
  const protocolState = getProtocolStatePDA(programId);
  const marketVault = getMarketVaultPDA(protocolState, marketId, programId);
  const userPosition = getUserPositionPDA(marketVault, user, programId);

  // Fetch vault to discover mints
  const vaultInfo = await connection.getAccountInfo(marketVault);
  if (!vaultInfo) throw new Error(`MarketVault not found for market ${marketId}`);
  const vault = parseMarketVault(Buffer.from(vaultInfo.data));

  const userUsdcAta = getAta(user, vault.depositMint, TOKEN_PROGRAM_ID);
  const userVlofiAta = getAta(user, vault.vlofiMint, TOKEN_PROGRAM_ID);

  // Prepend idempotent ATA creation for USDC and vLOFI (no-ops if they exist)
  const ixs: TransactionInstruction[] = [
    createAtaIdempotentIx(user, userUsdcAta, user, vault.depositMint, TOKEN_PROGRAM_ID),
    createAtaIdempotentIx(user, userVlofiAta, user, vault.vlofiMint, TOKEN_PROGRAM_ID),
  ];

  // Instruction data: [8 disc][8 market_id LE][8 amount LE]
  const disc = await anchorDisc('deposit_market');
  const data = Buffer.alloc(24);
  disc.copy(data, 0);
  data.writeBigUInt64LE(BigInt(marketId), 8);
  data.writeBigUInt64LE(BigInt(amount), 16);

  ixs.push(new TransactionInstruction({
    programId,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: marketVault, isSigner: false, isWritable: true },
      { pubkey: userPosition, isSigner: false, isWritable: true },
      { pubkey: userUsdcAta, isSigner: false, isWritable: true },
      { pubkey: vault.vaultAta, isSigner: false, isWritable: true },
      { pubkey: vault.vlofiMint, isSigner: false, isWritable: true },
      { pubkey: userVlofiAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  }));

  return ixs;
}

/**
 * Build a `settle_market` TransactionInstruction.
 *
 * Accounts (order must match SettleMarket struct in vault.rs):
 *   0. user              (signer, writable)
 *   1. protocol_state    (readonly)
 *   2. market_vault      (writable)
 *   3. user_market_position (writable)
 *   4. vlofi_mint        (writable)
 *   5. user_vlofi_ata    (writable)
 *   6. vault_usdc_ata    (writable)
 *   7. user_usdc_ata     (writable)
 *   8. ccm_mint          (legacy mainnet ABI only)
 *   9. user_ccm_ata      (legacy mainnet ABI only)
 *  10. token_program     (readonly) — legacy SPL (USDC)
 *  11. token_2022_program (readonly) — vLOFI burn
 *  12. ccm_token_program (readonly) — Token-2022 for legacy mainnet ABI
 *
 * The deployed mainnet program still expects the legacy CCM accounts even though
 * the instruction no longer mints CCM. In `auto` mode we include them for mainnet
 * and use the slimmer layout elsewhere.
 *
 * @returns Array containing the settle IX.
 */
export async function createSettleMarketIx(
  connection: Connection,
  user: PublicKey,
  marketId: number,
  programId: PublicKey = PROGRAM_ID,
  options: { accountsMode?: SettleAccountsMode } = {},
): Promise<TransactionInstruction[]> {
  const protocolState = getProtocolStatePDA(programId);
  const marketVault = getMarketVaultPDA(protocolState, marketId, programId);
  const userPosition = getUserPositionPDA(marketVault, user, programId);
  // 'auto' resolves based on program ID: mainnet uses legacy_ccm layout
  const accountsMode =
    options.accountsMode === 'auto' || !options.accountsMode
      ? (programId.equals(PROGRAM_ID) ? 'legacy_ccm' : 'current')
      : options.accountsMode;

  // Fetch vault + protocol state to discover mints/accounts.
  const vaultInfo = await connection.getAccountInfo(marketVault);
  if (!vaultInfo) throw new Error(`MarketVault not found for market ${marketId}`);
  const vault = parseMarketVault(Buffer.from(vaultInfo.data));
  const protocolInfo = await connection.getAccountInfo(protocolState);
  if (!protocolInfo) throw new Error('ProtocolState not found');
  const protocol = parseProtocolState(Buffer.from(protocolInfo.data));

  const userVlofiAta = getAta(user, vault.vlofiMint, TOKEN_PROGRAM_ID);
  const userUsdcAta = getAta(user, vault.depositMint, TOKEN_PROGRAM_ID);
  const userCcmAta = getAta(user, protocol.mint, TOKEN_2022_PROGRAM_ID);
  const ixs: TransactionInstruction[] = [];

  if (accountsMode === 'legacy_ccm') {
    // The deployed mainnet settle ABI still validates the user's CCM ATA even though
    // no mint_to CPI occurs anymore. Make the ATA creation idempotent so settle works
    // whether or not the wallet has claimed before.
    ixs.push(
      createAtaIdempotentIx(
        user,
        userCcmAta,
        user,
        protocol.mint,
        TOKEN_2022_PROGRAM_ID,
      ),
    );
  }

  // Instruction data: [8 disc][8 market_id LE]
  const disc = await anchorDisc('settle_market');
  const data = Buffer.alloc(16);
  disc.copy(data, 0);
  data.writeBigUInt64LE(BigInt(marketId), 8);

  const keys =
    accountsMode === 'legacy_ccm'
      ? [
          { pubkey: user, isSigner: true, isWritable: true },
          { pubkey: protocolState, isSigner: false, isWritable: false },
          { pubkey: marketVault, isSigner: false, isWritable: true },
          { pubkey: userPosition, isSigner: false, isWritable: true },
          { pubkey: vault.vlofiMint, isSigner: false, isWritable: true },
          { pubkey: userVlofiAta, isSigner: false, isWritable: true },
          { pubkey: vault.vaultAta, isSigner: false, isWritable: true },
          { pubkey: userUsdcAta, isSigner: false, isWritable: true },
          { pubkey: protocol.mint, isSigner: false, isWritable: true },
          { pubkey: userCcmAta, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        ]
      : [
          { pubkey: user, isSigner: true, isWritable: true },
          { pubkey: protocolState, isSigner: false, isWritable: false },
          { pubkey: marketVault, isSigner: false, isWritable: true },
          { pubkey: userPosition, isSigner: false, isWritable: true },
          { pubkey: vault.vlofiMint, isSigner: false, isWritable: true },
          { pubkey: userVlofiAta, isSigner: false, isWritable: true },
          { pubkey: vault.vaultAta, isSigner: false, isWritable: true },
          { pubkey: userUsdcAta, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        ];

  ixs.push(new TransactionInstruction({
    programId,
    keys,
    data,
  }));

  return ixs;
}

/**
 * Build an `initialize_market_vault` TransactionInstruction.
 * 
 * Accounts (order must match InitializeMarketVault struct in vault.rs):
 *   0. admin            (signer, writable)
 *   1. protocol_state   (readonly)
 *   2. market_vault     (writable, init)
 *   3. deposit_mint     (readonly) — USDC
 *   4. vlofi_mint       (readonly) — Token-2022
 *   5. vault_ata        (readonly) — Pre-created ATA owned by vault PDA
 *   6. system_program   (readonly)
 */
export async function createInitializeMarketVaultIx(
  admin: PublicKey,
  marketId: number,
  depositMint: PublicKey,
  vlofiMint: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);
  const marketVault = getMarketVaultPDA(protocolState, marketId, programId);

  // The vault's USDC ATA must be pre-created and owned by the vault PDA
  const vaultAta = getAta(marketVault, depositMint, TOKEN_PROGRAM_ID);

  // Instruction data: [8 disc][8 market_id LE]
  const disc = await anchorDisc('initialize_market_vault');
  const data = Buffer.alloc(16);
  disc.copy(data, 0);
  data.writeBigUInt64LE(BigInt(marketId), 8);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: marketVault, isSigner: false, isWritable: true },
      { pubkey: depositMint, isSigner: false, isWritable: false },
      { pubkey: vlofiMint, isSigner: false, isWritable: false },
      { pubkey: vaultAta, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Build a `claim_global` TransactionInstruction.
 *
 * Accounts (must match ClaimGlobal struct in global.rs):
 *   0. claimer             (signer, writable)
 *   1. protocol_state      (writable)
 *   2. global_root_config  (readonly)
 *   3. claim_state         (writable, init_if_needed)
 *   4. mint                (readonly) — CCM Token-2022 mint
 *   5. treasury_ata        (writable)
 *   6. claimer_ata         (writable, init_if_needed)
 *   7. token_program       (readonly) — Token-2022
 *   8. associated_token_program (readonly)
 *   9. system_program      (readonly)
 *
 * @returns Array of instructions: idempotent ATA create for claimer CCM + the claim IX.
 */
export async function createClaimGlobalIx(
  connection: Connection,
  claimer: PublicKey,
  rootSeq: number,
  cumulativeTotal: bigint | number,
  /** Hex-encoded 32-byte sibling hashes from the claims API */
  proofHex: string[],
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction[]> {
  const protocolState = getProtocolStatePDA(programId);

  // Fetch protocol state to discover CCM mint
  const protocolInfo = await connection.getAccountInfo(protocolState);
  if (!protocolInfo) throw new Error('ProtocolState not found');
  const protocol = parseProtocolState(Buffer.from(protocolInfo.data));
  const ccmMint = protocol.mint;

  // Derive PDAs
  const globalRootConfig = getGlobalRootConfigPDA(ccmMint, programId);
  const claimState = getClaimStatePDA(ccmMint, claimer, programId);

  // ATAs — Token-2022 for CCM
  const treasuryAta = getAta(protocolState, ccmMint, TOKEN_2022_PROGRAM_ID);
  const claimerAta = getAta(claimer, ccmMint, TOKEN_2022_PROGRAM_ID);

  // Prepend idempotent ATA creation for claimer's CCM account
  const ixs: TransactionInstruction[] = [
    createAtaIdempotentIx(claimer, claimerAta, claimer, ccmMint, TOKEN_2022_PROGRAM_ID),
  ];

  // Decode hex proof to bytes
  const proofBytes = proofHex.map((h) => Buffer.from(h, 'hex'));

  // Instruction data: [8 disc][8 root_seq LE][8 cumulative_total LE][4 proof_len LE][N * 32 proof]
  const disc = await anchorDisc('claim_global');
  const dataLen = 8 + 8 + 8 + 4 + proofBytes.length * 32;
  const data = Buffer.alloc(dataLen);
  let offset = 0;

  disc.copy(data, offset); offset += 8;
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
      { pubkey: protocolState, isSigner: false, isWritable: true },
      { pubkey: globalRootConfig, isSigner: false, isWritable: false },
      { pubkey: claimState, isSigner: false, isWritable: true },
      { pubkey: ccmMint, isSigner: false, isWritable: false },
      { pubkey: treasuryAta, isSigner: false, isWritable: true },
      { pubkey: claimerAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  }));

  return ixs;
}

/**
 * Build a `claim_global_v2` TransactionInstruction (V5 leaf format).
 *
 * Same accounts as claim_global, but args split cumulative_total into
 * base_yield + attention_bonus for V5 merkle leaf verification.
 */
export async function createClaimGlobalV2Ix(
  connection: Connection,
  claimer: PublicKey,
  rootSeq: number,
  baseYield: bigint | number,
  attentionBonus: bigint | number,
  proofHex: string[],
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction[]> {
  const protocolState = getProtocolStatePDA(programId);

  const protocolInfo = await connection.getAccountInfo(protocolState);
  if (!protocolInfo) throw new Error('ProtocolState not found');
  const protocol = parseProtocolState(Buffer.from(protocolInfo.data));
  const ccmMint = protocol.mint;

  const globalRootConfig = getGlobalRootConfigPDA(ccmMint, programId);
  const claimState = getClaimStatePDA(ccmMint, claimer, programId);

  const treasuryAta = getAta(protocolState, ccmMint, TOKEN_2022_PROGRAM_ID);
  const claimerAta = getAta(claimer, ccmMint, TOKEN_2022_PROGRAM_ID);

  const ixs: TransactionInstruction[] = [
    createAtaIdempotentIx(claimer, claimerAta, claimer, ccmMint, TOKEN_2022_PROGRAM_ID),
  ];

  const proofBytes = proofHex.map((h) => Buffer.from(h, 'hex'));

  // Data: [8 disc][8 root_seq][8 base_yield][8 attention_bonus][4 proof_len][N*32 proof]
  const disc = await anchorDisc('claim_global_v2');
  const dataLen = 8 + 8 + 8 + 8 + 4 + proofBytes.length * 32;
  const data = Buffer.alloc(dataLen);
  let offset = 0;

  disc.copy(data, offset); offset += 8;
  data.writeBigUInt64LE(BigInt(rootSeq), offset); offset += 8;
  data.writeBigUInt64LE(BigInt(baseYield), offset); offset += 8;
  data.writeBigUInt64LE(BigInt(attentionBonus), offset); offset += 8;
  data.writeUInt32LE(proofBytes.length, offset); offset += 4;
  for (const node of proofBytes) {
    node.copy(data, offset);
    offset += 32;
  }

  ixs.push(new TransactionInstruction({
    programId,
    keys: [
      { pubkey: claimer, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: true },
      { pubkey: globalRootConfig, isSigner: false, isWritable: false },
      { pubkey: claimState, isSigner: false, isWritable: true },
      { pubkey: ccmMint, isSigner: false, isWritable: false },
      { pubkey: treasuryAta, isSigner: false, isWritable: true },
      { pubkey: claimerAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  }));

  return ixs;
}

// ── Admin Instruction Builders ────────────────────────

/**
 * Build a `create_channel_config_v2` TransactionInstruction.
 *
 * Accounts (order must match CreateChannelConfigV2 struct in admin.rs):
 *   0. admin            (signer, writable)
 *   1. protocol_state   (readonly)
 *   2. channel_config   (writable, init)
 *   3. system_program   (readonly)
 *
 * Args (Borsh-serialized):
 *   subject:         Pubkey (32 bytes)
 *   authority:       Pubkey (32 bytes)
 *   creator_wallet:  Pubkey (32 bytes)
 *   creator_fee_bps: u16   (2 bytes LE)
 */
export async function createChannelConfigV2Ix(
  admin: PublicKey,
  /** CCM mint pubkey (from ProtocolState.mint) */
  mint: PublicKey,
  subject: PublicKey,
  authority: PublicKey,
  creatorWallet: PublicKey,
  creatorFeeBps: number,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);
  const channelConfig = getChannelConfigV2PDA(mint, subject, programId);

  // Instruction data: [8 disc][32 subject][32 authority][32 creator_wallet][2 fee_bps LE]
  const disc = await anchorDisc('create_channel_config_v2');
  const data = Buffer.alloc(8 + 32 + 32 + 32 + 2);
  let offset = 0;

  disc.copy(data, offset); offset += 8;
  subject.toBuffer().copy(data, offset); offset += 32;
  authority.toBuffer().copy(data, offset); offset += 32;
  creatorWallet.toBuffer().copy(data, offset); offset += 32;
  data.writeUInt16LE(creatorFeeBps, offset);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: channelConfig, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// Extended Instruction Builders (Phase 2 + Full On-Chain Coverage)
// ══════════════════════════════════════════════════════════════════════════════

/** Sysvar Instructions program address (required by Kamino CPI). */
const SYSVAR_INSTRUCTIONS_ID = new PublicKey(
  'Sysvar1nstructions1111111111111111111111111',
);

/** PDA seed constant for legacy protocol state (seeds = ["protocol", mint]). */
const PROTOCOL_SEED = Buffer.from('protocol');

/** PDA seed constant for strategy vault. */
const STRATEGY_VAULT_SEED = Buffer.from('strategy_vault');

/** PDA seed constant for prediction market state. */
const MARKET_STATE_SEED = Buffer.from('market');

/** PDA seed for channel stake pool. */
const CHANNEL_STAKE_POOL_SEED = Buffer.from('channel_pool');

/** PDA seed for channel user stake. */
const CHANNEL_USER_STAKE_SEED = Buffer.from('channel_user');

/** PDA seed for soulbound NFT mint. */
const STAKE_NFT_MINT_SEED = Buffer.from('stake_nft');

/** PDA seed for stake vault (holds staked CCM). */
const STAKE_VAULT_SEED = Buffer.from('stake_vault');

// ── PDA derivation helpers (local, not exported from pda.ts) ─────────

function getStrategyVaultPDA(
  marketVault: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [STRATEGY_VAULT_SEED, marketVault.toBuffer()],
    programId,
  )[0];
}

function getMarketStatePDA(
  ccmMint: PublicKey,
  marketId: number,
  programId: PublicKey = PROGRAM_ID,
): PublicKey {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(marketId));
  return PublicKey.findProgramAddressSync(
    [MARKET_STATE_SEED, ccmMint.toBuffer(), idBuf],
    programId,
  )[0];
}

// ── Prediction market PDA helpers ────────────────────────────────────

const PM_VAULT_SEED = Buffer.from('market_vault');
const MARKET_YES_MINT_SEED = Buffer.from('market_yes');
const MARKET_NO_MINT_SEED = Buffer.from('market_no');
const MARKET_MINT_AUTH_SEED = Buffer.from('market_auth');

function getPredictionVaultPDA(
  ccmMint: PublicKey,
  marketId: number,
  programId: PublicKey = PROGRAM_ID,
): PublicKey {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(marketId));
  return PublicKey.findProgramAddressSync(
    [PM_VAULT_SEED, ccmMint.toBuffer(), idBuf],
    programId,
  )[0];
}

function getPredictionYesMintPDA(
  ccmMint: PublicKey,
  marketId: number,
  programId: PublicKey = PROGRAM_ID,
): PublicKey {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(marketId));
  return PublicKey.findProgramAddressSync(
    [MARKET_YES_MINT_SEED, ccmMint.toBuffer(), idBuf],
    programId,
  )[0];
}

function getPredictionNoMintPDA(
  ccmMint: PublicKey,
  marketId: number,
  programId: PublicKey = PROGRAM_ID,
): PublicKey {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(marketId));
  return PublicKey.findProgramAddressSync(
    [MARKET_NO_MINT_SEED, ccmMint.toBuffer(), idBuf],
    programId,
  )[0];
}

function getPredictionMintAuthorityPDA(
  ccmMint: PublicKey,
  marketId: number,
  programId: PublicKey = PROGRAM_ID,
): PublicKey {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(marketId));
  return PublicKey.findProgramAddressSync(
    [MARKET_MINT_AUTH_SEED, ccmMint.toBuffer(), idBuf],
    programId,
  )[0];
}

function getLegacyProtocolStatePDA(
  ccmMint: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [PROTOCOL_SEED, ccmMint.toBuffer()],
    programId,
  )[0];
}

function getStakePoolPDA(
  channelConfig: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [CHANNEL_STAKE_POOL_SEED, channelConfig.toBuffer()],
    programId,
  )[0];
}

function getStakeVaultPDA(
  stakePool: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [STAKE_VAULT_SEED, stakePool.toBuffer()],
    programId,
  )[0];
}

function getUserStakePDA(
  channelConfig: PublicKey,
  user: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [CHANNEL_USER_STAKE_SEED, channelConfig.toBuffer(), user.toBuffer()],
    programId,
  )[0];
}

function getStakeNftMintPDA(
  stakePool: PublicKey,
  user: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [STAKE_NFT_MINT_SEED, stakePool.toBuffer(), user.toBuffer()],
    programId,
  )[0];
}

function getPriceFeedPDA(
  label: Buffer,
  programId: PublicKey = PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('price_feed'), label],
    programId,
  )[0];
}

// ── 1. createCreateMarketIx ──────────────────────────────────────────

/**
 * Build a `create_market` TransactionInstruction (prediction markets).
 *
 * Accounts (order must match CreateMarket struct in markets.rs):
 *   0. authority         (signer, writable)
 *   1. protocol_state    (readonly)
 *   2. global_root_config (readonly)
 *   3. market_state      (writable, init)
 *   4. system_program    (readonly)
 *
 * Args (Borsh):
 *   market_id:            u64
 *   creator_wallet:       Pubkey (32 bytes)
 *   metric:               u8
 *   target:               u64
 *   resolution_root_seq:  u64
 */
export async function createCreateMarketIx(
  authority: PublicKey,
  ccmMint: PublicKey,
  marketId: number,
  creatorWallet: PublicKey,
  metric: number,
  target: bigint | number,
  resolutionRootSeq: bigint | number,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);
  const globalRootConfig = getGlobalRootConfigPDA(ccmMint, programId);
  const marketState = getMarketStatePDA(ccmMint, marketId, programId);

  // Data: [8 disc][8 market_id][32 creator_wallet][1 metric][8 target][8 resolution_root_seq]
  const disc = await anchorDisc('create_market');
  const data = Buffer.alloc(8 + 8 + 32 + 1 + 8 + 8);
  let offset = 0;

  disc.copy(data, offset); offset += 8;
  data.writeBigUInt64LE(BigInt(marketId), offset); offset += 8;
  creatorWallet.toBuffer().copy(data, offset); offset += 32;
  data.writeUInt8(metric, offset); offset += 1;
  data.writeBigUInt64LE(BigInt(target), offset); offset += 8;
  data.writeBigUInt64LE(BigInt(resolutionRootSeq), offset);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: globalRootConfig, isSigner: false, isWritable: false },
      { pubkey: marketState, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── 2. createUpdateAttentionIx ───────────────────────────────────────

/**
 * Build an `update_attention` TransactionInstruction.
 *
 * Oracle pushes attention multiplier to a user's market position.
 *
 * Accounts (order must match UpdateAttention struct in vault.rs):
 *   0. oracle_authority        (signer, writable)
 *   1. protocol_state          (readonly)
 *   2. market_vault            (readonly)
 *   3. user_market_position    (writable)
 *
 * Args: market_id (u64), user_pubkey (Pubkey), multiplier_bps (u64)
 */
export async function createUpdateAttentionIx(
  oracleAuthority: PublicKey,
  marketId: number,
  userPubkey: PublicKey,
  multiplierBps: bigint | number,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);
  const marketVault = getMarketVaultPDA(protocolState, marketId, programId);
  const userPosition = getUserPositionPDA(marketVault, userPubkey, programId);

  // Data: [8 disc][8 market_id][32 user_pubkey][8 multiplier_bps]
  const disc = await anchorDisc('update_attention');
  const data = Buffer.alloc(8 + 8 + 32 + 8);
  let offset = 0;

  disc.copy(data, offset); offset += 8;
  data.writeBigUInt64LE(BigInt(marketId), offset); offset += 8;
  userPubkey.toBuffer().copy(data, offset); offset += 32;
  data.writeBigUInt64LE(BigInt(multiplierBps), offset);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: oracleAuthority, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: marketVault, isSigner: false, isWritable: false },
      { pubkey: userPosition, isSigner: false, isWritable: true },
    ],
    data,
  });
}

// ── 3. createPublishGlobalRootIx ─────────────────────────────────────

/**
 * Build a `publish_global_root` TransactionInstruction.
 *
 * Accounts (order must match PublishGlobalRoot struct in global.rs):
 *   0. payer                (signer, writable)
 *   1. protocol_state       (readonly)
 *   2. global_root_config   (writable)
 *
 * Args: root_seq (u64), root ([u8; 32]), dataset_hash ([u8; 32])
 */
export async function createPublishGlobalRootIx(
  payer: PublicKey,
  ccmMint: PublicKey,
  rootSeq: bigint | number,
  /** 32-byte merkle root (hex string or Buffer) */
  root: string | Buffer,
  /** 32-byte dataset hash (hex string or Buffer) */
  datasetHash: string | Buffer,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);
  const globalRootConfig = getGlobalRootConfigPDA(ccmMint, programId);

  const rootBuf = typeof root === 'string' ? Buffer.from(root, 'hex') : root;
  const hashBuf = typeof datasetHash === 'string' ? Buffer.from(datasetHash, 'hex') : datasetHash;

  // Data: [8 disc][8 root_seq][32 root][32 dataset_hash]
  const disc = await anchorDisc('publish_global_root');
  const data = Buffer.alloc(8 + 8 + 32 + 32);
  let offset = 0;

  disc.copy(data, offset); offset += 8;
  data.writeBigUInt64LE(BigInt(rootSeq), offset); offset += 8;
  rootBuf.copy(data, offset); offset += 32;
  hashBuf.copy(data, offset);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: globalRootConfig, isSigner: false, isWritable: true },
    ],
    data,
  });
}

// ── 4. createClaimYieldIx ────────────────────────────────────────────

/**
 * Build a `claim_yield` TransactionInstruction.
 *
 * NOTE: This instruction is deprecated on-chain and always returns
 * `ClaimYieldDeprecated`. Included for SDK completeness.
 *
 * Accounts (order must match ClaimYield struct in vault.rs):
 *   0. user                   (signer, writable)
 *   1. protocol_state         (readonly)
 *   2. market_vault           (readonly)
 *   3. user_market_position   (writable)
 *
 * Args: market_id (u64)
 */
export async function createClaimYieldIx(
  user: PublicKey,
  marketId: number,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);
  const marketVault = getMarketVaultPDA(protocolState, marketId, programId);
  const userPosition = getUserPositionPDA(marketVault, user, programId);

  const disc = await anchorDisc('claim_yield');
  const data = Buffer.alloc(16);
  disc.copy(data, 0);
  data.writeBigUInt64LE(BigInt(marketId), 8);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: marketVault, isSigner: false, isWritable: false },
      { pubkey: userPosition, isSigner: false, isWritable: true },
    ],
    data,
  });
}

// ── 5. createCloseMarketIx ───────────────────────────────────────────

/**
 * Build a `close_market` TransactionInstruction (prediction markets).
 *
 * Accounts (order must match CloseMarket struct in markets.rs):
 *   0. admin            (signer, writable)
 *   1. protocol_state   (readonly)
 *   2. market_state     (writable, close -> admin)
 *   3. vault            (writable) — must be empty
 *   4. ccm_mint         (readonly)
 *   5. mint_authority   (readonly)
 *   6. token_program    (readonly) — Token-2022
 */
export async function createCloseMarketIx(
  admin: PublicKey,
  ccmMint: PublicKey,
  marketId: number,
  vault: PublicKey,
  mintAuthority: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);
  const marketState = getMarketStatePDA(ccmMint, marketId, programId);

  const disc = await anchorDisc('close_market');
  const data = Buffer.alloc(8);
  disc.copy(data, 0);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: marketState, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: ccmMint, isSigner: false, isWritable: false },
      { pubkey: mintAuthority, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── 6. createUpdateNavIx ─────────────────────────────────────────────

/**
 * Build an `update_nav` TransactionInstruction.
 *
 * Oracle authority sets NAV per vLOFI share on a MarketVault.
 *
 * Accounts (order must match UpdateNav struct in vault.rs):
 *   0. oracle_authority  (signer, writable)
 *   1. protocol_state    (readonly)
 *   2. market_vault      (writable)
 *
 * Args: market_id (u64), nav_per_share_bps (u64)
 */
export async function createUpdateNavIx(
  oracleAuthority: PublicKey,
  marketId: number,
  navPerShareBps: bigint | number,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);
  const marketVault = getMarketVaultPDA(protocolState, marketId, programId);

  // Data: [8 disc][8 market_id][8 nav_per_share_bps]
  const disc = await anchorDisc('update_nav');
  const data = Buffer.alloc(24);
  disc.copy(data, 0);
  data.writeBigUInt64LE(BigInt(marketId), 8);
  data.writeBigUInt64LE(BigInt(navPerShareBps), 16);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: oracleAuthority, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: marketVault, isSigner: false, isWritable: true },
    ],
    data,
  });
}

// ── 7. createInitializeProtocolStateIx ───────────────────────────────

/**
 * Build an `initialize_protocol_state` TransactionInstruction.
 *
 * One-time protocol setup. Creates the singleton ProtocolState PDA.
 *
 * Accounts (order must match InitializeProtocolState struct in vault.rs):
 *   0. admin           (signer, writable)
 *   1. protocol_state  (writable, init)
 *   2. system_program  (readonly)
 *
 * Args: publisher (Pubkey), treasury (Pubkey), oracle_authority (Pubkey), ccm_mint (Pubkey)
 */
export async function createInitializeProtocolStateIx(
  admin: PublicKey,
  publisher: PublicKey,
  treasury: PublicKey,
  oracleAuthority: PublicKey,
  ccmMint: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);

  // Data: [8 disc][32 publisher][32 treasury][32 oracle_authority][32 ccm_mint]
  const disc = await anchorDisc('initialize_protocol_state');
  const data = Buffer.alloc(8 + 32 + 32 + 32 + 32);
  let offset = 0;

  disc.copy(data, offset); offset += 8;
  publisher.toBuffer().copy(data, offset); offset += 32;
  treasury.toBuffer().copy(data, offset); offset += 32;
  oracleAuthority.toBuffer().copy(data, offset); offset += 32;
  ccmMint.toBuffer().copy(data, offset);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── 8. createUpdateProtocolStateIx (update_publisher_open) ───────────

/**
 * Build an `update_publisher_open` TransactionInstruction.
 *
 * Admin updates the allowlisted publisher address.
 *
 * Accounts (order must match UpdatePublisherOpen struct in admin.rs):
 *   0. admin           (signer, writable)
 *   1. protocol_state  (writable)
 *
 * Args: new_publisher (Pubkey)
 */
export async function createUpdateProtocolStateIx(
  admin: PublicKey,
  newPublisher: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);

  const disc = await anchorDisc('update_publisher_open');
  const data = Buffer.alloc(8 + 32);
  disc.copy(data, 0);
  newPublisher.toBuffer().copy(data, 8);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: true },
    ],
    data,
  });
}

// ── 9. createSetTreasuryIx ───────────────────────────────────────────

/**
 * Build a `set_treasury` TransactionInstruction.
 *
 * Admin updates the treasury wallet (fee destination owner).
 *
 * Accounts (order must match SetTreasury struct in admin.rs):
 *   0. admin           (signer, writable)
 *   1. protocol_state  (writable)
 *
 * Args: new_treasury (Pubkey)
 */
export async function createSetTreasuryIx(
  admin: PublicKey,
  newTreasury: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);

  const disc = await anchorDisc('set_treasury');
  const data = Buffer.alloc(8 + 32);
  disc.copy(data, 0);
  newTreasury.toBuffer().copy(data, 8);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: true },
    ],
    data,
  });
}

// ── 10. createStakeChannelIx ─────────────────────────────────────────

/**
 * Build a `stake_channel` TransactionInstruction.
 *
 * Accounts (order must match StakeChannel struct in staking.rs):
 *   0.  user                (signer)
 *   1.  payer               (signer, writable)
 *   2.  protocol_state      (readonly)
 *   3.  channel_config      (readonly)
 *   4.  mint                (readonly) — CCM Token-2022
 *   5.  stake_pool          (writable)
 *   6.  user_stake          (writable, init)
 *   7.  vault               (writable) — pool's staking vault
 *   8.  user_token_account  (writable) — user's CCM ATA
 *   9.  nft_mint            (writable) — soulbound NFT mint PDA
 *   10. nft_ata             (writable) — user's NFT ATA
 *   11. token_program       (readonly) — Token-2022
 *   12. associated_token_program (readonly)
 *   13. system_program      (readonly)
 *   14. rent                (readonly)
 *
 * Args: amount (u64), lock_duration (u64)
 */
export async function createStakeChannelIx(
  user: PublicKey,
  payer: PublicKey,
  ccmMint: PublicKey,
  channelConfig: PublicKey,
  amount: bigint | number,
  lockDuration: bigint | number,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);
  const stakePool = getStakePoolPDA(channelConfig, programId);
  const userStake = getUserStakePDA(channelConfig, user, programId);
  const vault = getStakeVaultPDA(stakePool, programId);
  const userTokenAccount = getAta(user, ccmMint, TOKEN_2022_PROGRAM_ID);
  const nftMint = getStakeNftMintPDA(stakePool, user, programId);
  const nftAta = getAta(user, nftMint, TOKEN_2022_PROGRAM_ID);

  const disc = await anchorDisc('stake_channel');
  const data = Buffer.alloc(8 + 8 + 8);
  disc.copy(data, 0);
  data.writeBigUInt64LE(BigInt(amount), 8);
  data.writeBigUInt64LE(BigInt(lockDuration), 16);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: user, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: channelConfig, isSigner: false, isWritable: false },
      { pubkey: ccmMint, isSigner: false, isWritable: false },
      { pubkey: stakePool, isSigner: false, isWritable: true },
      { pubkey: userStake, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: nftMint, isSigner: false, isWritable: true },
      { pubkey: nftAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── 11. createUnstakeChannelIx ───────────────────────────────────────

/**
 * Build an `unstake_channel` TransactionInstruction.
 *
 * Accounts (order must match UnstakeChannel struct in staking.rs):
 *   0.  user                (signer, writable)
 *   1.  channel_config      (readonly)
 *   2.  mint                (readonly) — CCM Token-2022
 *   3.  stake_pool          (writable)
 *   4.  user_stake          (writable, close -> user)
 *   5.  vault               (writable)
 *   6.  user_token_account  (writable)
 *   7.  nft_mint            (writable)
 *   8.  nft_ata             (writable)
 *   9.  token_program       (readonly) — Token-2022
 *   10. associated_token_program (readonly)
 *
 * No args (no instruction data beyond disc).
 */
export async function createUnstakeChannelIx(
  user: PublicKey,
  ccmMint: PublicKey,
  channelConfig: PublicKey,
  nftMint: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const stakePool = getStakePoolPDA(channelConfig, programId);
  const userStake = getUserStakePDA(channelConfig, user, programId);
  const vault = getStakeVaultPDA(stakePool, programId);
  const userTokenAccount = getAta(user, ccmMint, TOKEN_2022_PROGRAM_ID);
  const nftAta = getAta(user, nftMint, TOKEN_2022_PROGRAM_ID);

  const disc = await anchorDisc('unstake_channel');
  const data = Buffer.alloc(8);
  disc.copy(data, 0);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: channelConfig, isSigner: false, isWritable: false },
      { pubkey: ccmMint, isSigner: false, isWritable: false },
      { pubkey: stakePool, isSigner: false, isWritable: true },
      { pubkey: userStake, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: nftMint, isSigner: false, isWritable: true },
      { pubkey: nftAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── 12. createClaimChannelRewardsIx ──────────────────────────────────

/**
 * Build a `claim_channel_rewards` TransactionInstruction.
 *
 * Accounts (order must match ClaimChannelRewards struct in staking.rs):
 *   0. user                (signer, writable)
 *   1. channel_config      (readonly)
 *   2. mint                (readonly) — CCM Token-2022
 *   3. stake_pool          (writable)
 *   4. user_stake          (writable)
 *   5. vault               (writable) — pool vault
 *   6. user_token_account  (writable) — receives rewards
 *   7. token_program       (readonly) — Token-2022
 *
 * No args beyond disc.
 */
export async function createClaimChannelRewardsIx(
  user: PublicKey,
  ccmMint: PublicKey,
  channelConfig: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const stakePool = getStakePoolPDA(channelConfig, programId);
  const userStake = getUserStakePDA(channelConfig, user, programId);
  const vault = getStakeVaultPDA(stakePool, programId);
  const userTokenAccount = getAta(user, ccmMint, TOKEN_2022_PROGRAM_ID);

  const disc = await anchorDisc('claim_channel_rewards');
  const data = Buffer.alloc(8);
  disc.copy(data, 0);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: channelConfig, isSigner: false, isWritable: false },
      { pubkey: ccmMint, isSigner: false, isWritable: false },
      { pubkey: stakePool, isSigner: false, isWritable: true },
      { pubkey: userStake, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── 13. createInitializeStakePoolIx ──────────────────────────────────

/**
 * Build an `initialize_stake_pool` TransactionInstruction.
 *
 * Accounts (order must match InitializeStakePool struct in staking.rs):
 *   0. payer            (signer, writable)
 *   1. protocol_state   (readonly)
 *   2. channel_config   (readonly)
 *   3. mint             (readonly) — CCM Token-2022
 *   4. stake_pool       (writable, init)
 *   5. vault            (writable, init) — pool's CCM vault
 *   6. token_program    (readonly) — Token-2022
 *   7. system_program   (readonly)
 *
 * No args beyond disc.
 */
export async function createInitializeStakePoolIx(
  payer: PublicKey,
  ccmMint: PublicKey,
  channelConfig: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);
  const stakePool = getStakePoolPDA(channelConfig, programId);
  const vault = getStakeVaultPDA(stakePool, programId);

  const disc = await anchorDisc('initialize_stake_pool');
  const data = Buffer.alloc(8);
  disc.copy(data, 0);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: channelConfig, isSigner: false, isWritable: false },
      { pubkey: ccmMint, isSigner: false, isWritable: false },
      { pubkey: stakePool, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── 14. createInitializeStrategyVaultIx ──────────────────────────────

/**
 * Build an `initialize_strategy_vault` TransactionInstruction.
 *
 * Accounts (order must match InitializeStrategyVault struct in strategy.rs):
 *   0. admin_authority  (signer, writable)
 *   1. protocol_state   (readonly)
 *   2. market_vault     (readonly)
 *   3. deposit_mint     (readonly)
 *   4. strategy_vault   (writable, init)
 *   5. system_program   (readonly)
 *
 * Args: reserve_ratio_bps (u16), utilization_cap_bps (u16),
 *       operator_authority (Pubkey), klend_program (Pubkey),
 *       klend_reserve (Pubkey), klend_lending_market (Pubkey), ctoken_ata (Pubkey)
 */
export async function createInitializeStrategyVaultIx(
  adminAuthority: PublicKey,
  marketId: number,
  depositMint: PublicKey,
  reserveRatioBps: number,
  utilizationCapBps: number,
  operatorAuthority: PublicKey,
  klendProgram: PublicKey,
  klendReserve: PublicKey,
  klendLendingMarket: PublicKey,
  ctokenAta: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);
  const marketVault = getMarketVaultPDA(protocolState, marketId, programId);
  const strategyVault = getStrategyVaultPDA(marketVault, programId);

  // Data: [8 disc][2 reserve_ratio_bps][2 utilization_cap_bps]
  //       [32 operator][32 klend_program][32 klend_reserve][32 klend_lending_market][32 ctoken_ata]
  const disc = await anchorDisc('initialize_strategy_vault');
  const data = Buffer.alloc(8 + 2 + 2 + 32 * 5);
  let offset = 0;

  disc.copy(data, offset); offset += 8;
  data.writeUInt16LE(reserveRatioBps, offset); offset += 2;
  data.writeUInt16LE(utilizationCapBps, offset); offset += 2;
  operatorAuthority.toBuffer().copy(data, offset); offset += 32;
  klendProgram.toBuffer().copy(data, offset); offset += 32;
  klendReserve.toBuffer().copy(data, offset); offset += 32;
  klendLendingMarket.toBuffer().copy(data, offset); offset += 32;
  ctokenAta.toBuffer().copy(data, offset);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: adminAuthority, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: marketVault, isSigner: false, isWritable: false },
      { pubkey: depositMint, isSigner: false, isWritable: false },
      { pubkey: strategyVault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── 15. createDeployToStrategyIx ─────────────────────────────────────

/**
 * Build a `deploy_to_strategy` TransactionInstruction.
 *
 * Deploys USDC from MarketVault into Kamino K-Lend. Requires all Kamino
 * oracle accounts. All account addresses are pinned at strategy vault init.
 *
 * Accounts (order must match DeployToStrategy struct in strategy.rs):
 *   0.  operator_authority            (signer, writable)
 *   1.  protocol_state               (readonly)
 *   2.  market_vault                  (readonly)
 *   3.  strategy_vault               (writable)
 *   4.  deposit_mint                  (readonly)
 *   5.  vault_usdc_ata               (writable)
 *   6.  ctoken_ata                   (writable)
 *   7.  klend_program                (readonly)
 *   8.  klend_reserve                (writable)
 *   9.  klend_lending_market         (readonly)
 *   10. klend_lending_market_authority (readonly)
 *   11. reserve_liquidity_supply     (writable)
 *   12. reserve_collateral_mint      (writable)
 *   13. pyth_oracle                  (readonly)
 *   14. switchboard_price_oracle     (readonly)
 *   15. switchboard_twap_oracle      (readonly)
 *   16. scope_prices                 (readonly)
 *   17. instruction_sysvar_account   (readonly)
 *   18. token_program                (readonly) — SPL Token
 *
 * Args: amount (u64)
 */
export async function createDeployToStrategyIx(
  operatorAuthority: PublicKey,
  marketId: number,
  depositMint: PublicKey,
  vaultUsdcAta: PublicKey,
  ctokenAta: PublicKey,
  klendProgram: PublicKey,
  klendReserve: PublicKey,
  klendLendingMarket: PublicKey,
  klendLendingMarketAuthority: PublicKey,
  reserveLiquiditySupply: PublicKey,
  reserveCollateralMint: PublicKey,
  pythOracle: PublicKey,
  switchboardPriceOracle: PublicKey,
  switchboardTwapOracle: PublicKey,
  scopePrices: PublicKey,
  amount: bigint | number,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);
  const marketVault = getMarketVaultPDA(protocolState, marketId, programId);
  const strategyVault = getStrategyVaultPDA(marketVault, programId);

  const disc = await anchorDisc('deploy_to_strategy');
  const data = Buffer.alloc(16);
  disc.copy(data, 0);
  data.writeBigUInt64LE(BigInt(amount), 8);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: operatorAuthority, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: marketVault, isSigner: false, isWritable: false },
      { pubkey: strategyVault, isSigner: false, isWritable: true },
      { pubkey: depositMint, isSigner: false, isWritable: false },
      { pubkey: vaultUsdcAta, isSigner: false, isWritable: true },
      { pubkey: ctokenAta, isSigner: false, isWritable: true },
      { pubkey: klendProgram, isSigner: false, isWritable: false },
      { pubkey: klendReserve, isSigner: false, isWritable: true },
      { pubkey: klendLendingMarket, isSigner: false, isWritable: false },
      { pubkey: klendLendingMarketAuthority, isSigner: false, isWritable: false },
      { pubkey: reserveLiquiditySupply, isSigner: false, isWritable: true },
      { pubkey: reserveCollateralMint, isSigner: false, isWritable: true },
      { pubkey: pythOracle, isSigner: false, isWritable: false },
      { pubkey: switchboardPriceOracle, isSigner: false, isWritable: false },
      { pubkey: switchboardTwapOracle, isSigner: false, isWritable: false },
      { pubkey: scopePrices, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── 16. createWithdrawFromStrategyIx ─────────────────────────────────

/**
 * Build a `withdraw_from_strategy` TransactionInstruction.
 *
 * Withdraws USDC from Kamino back into the MarketVault reserve.
 * Same Kamino oracle accounts as deploy_to_strategy.
 *
 * Accounts (order must match WithdrawFromStrategy struct in strategy.rs):
 *   Same layout as DeployToStrategy.
 *
 * Args: amount (u64)
 */
export async function createWithdrawFromStrategyIx(
  operatorAuthority: PublicKey,
  marketId: number,
  depositMint: PublicKey,
  vaultUsdcAta: PublicKey,
  ctokenAta: PublicKey,
  klendProgram: PublicKey,
  klendReserve: PublicKey,
  klendLendingMarket: PublicKey,
  klendLendingMarketAuthority: PublicKey,
  reserveLiquiditySupply: PublicKey,
  reserveCollateralMint: PublicKey,
  pythOracle: PublicKey,
  switchboardPriceOracle: PublicKey,
  switchboardTwapOracle: PublicKey,
  scopePrices: PublicKey,
  amount: bigint | number,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);
  const marketVault = getMarketVaultPDA(protocolState, marketId, programId);
  const strategyVault = getStrategyVaultPDA(marketVault, programId);

  const disc = await anchorDisc('withdraw_from_strategy');
  const data = Buffer.alloc(16);
  disc.copy(data, 0);
  data.writeBigUInt64LE(BigInt(amount), 8);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: operatorAuthority, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: marketVault, isSigner: false, isWritable: false },
      { pubkey: strategyVault, isSigner: false, isWritable: true },
      { pubkey: depositMint, isSigner: false, isWritable: false },
      { pubkey: vaultUsdcAta, isSigner: false, isWritable: true },
      { pubkey: ctokenAta, isSigner: false, isWritable: true },
      { pubkey: klendProgram, isSigner: false, isWritable: false },
      { pubkey: klendReserve, isSigner: false, isWritable: true },
      { pubkey: klendLendingMarket, isSigner: false, isWritable: false },
      { pubkey: klendLendingMarketAuthority, isSigner: false, isWritable: false },
      { pubkey: reserveLiquiditySupply, isSigner: false, isWritable: true },
      { pubkey: reserveCollateralMint, isSigner: false, isWritable: true },
      { pubkey: pythOracle, isSigner: false, isWritable: false },
      { pubkey: switchboardPriceOracle, isSigner: false, isWritable: false },
      { pubkey: switchboardTwapOracle, isSigner: false, isWritable: false },
      { pubkey: scopePrices, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── 17. createHarvestStrategyYieldIx ─────────────────────────────────

/**
 * Build a `harvest_strategy_yield` TransactionInstruction.
 *
 * Harvests yield (NAV above principal) from Kamino and sends it to treasury.
 *
 * Accounts (order must match HarvestStrategyYield struct in strategy.rs):
 *   0.  operator_authority            (signer, writable)
 *   1.  protocol_state               (readonly)
 *   2.  market_vault                  (readonly)
 *   3.  strategy_vault               (writable)
 *   4.  deposit_mint                  (readonly)
 *   5.  vault_usdc_ata               (readonly) — for validation
 *   6.  treasury_ata                 (writable) — receives yield USDC
 *   7.  ctoken_ata                   (writable)
 *   8.  klend_program                (readonly)
 *   9.  klend_reserve                (writable)
 *   10. klend_lending_market         (readonly)
 *   11. klend_lending_market_authority (readonly)
 *   12. reserve_liquidity_supply     (writable)
 *   13. reserve_collateral_mint      (writable)
 *   14. pyth_oracle                  (readonly)
 *   15. switchboard_price_oracle     (readonly)
 *   16. switchboard_twap_oracle      (readonly)
 *   17. scope_prices                 (readonly)
 *   18. instruction_sysvar_account   (readonly)
 *   19. token_program                (readonly) — SPL Token
 *
 * No args beyond disc.
 */
export async function createHarvestStrategyYieldIx(
  operatorAuthority: PublicKey,
  marketId: number,
  depositMint: PublicKey,
  vaultUsdcAta: PublicKey,
  treasuryAta: PublicKey,
  ctokenAta: PublicKey,
  klendProgram: PublicKey,
  klendReserve: PublicKey,
  klendLendingMarket: PublicKey,
  klendLendingMarketAuthority: PublicKey,
  reserveLiquiditySupply: PublicKey,
  reserveCollateralMint: PublicKey,
  pythOracle: PublicKey,
  switchboardPriceOracle: PublicKey,
  switchboardTwapOracle: PublicKey,
  scopePrices: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);
  const marketVault = getMarketVaultPDA(protocolState, marketId, programId);
  const strategyVault = getStrategyVaultPDA(marketVault, programId);

  const disc = await anchorDisc('harvest_strategy_yield');
  const data = Buffer.alloc(8);
  disc.copy(data, 0);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: operatorAuthority, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: marketVault, isSigner: false, isWritable: false },
      { pubkey: strategyVault, isSigner: false, isWritable: true },
      { pubkey: depositMint, isSigner: false, isWritable: false },
      { pubkey: vaultUsdcAta, isSigner: false, isWritable: false },
      { pubkey: treasuryAta, isSigner: false, isWritable: true },
      { pubkey: ctokenAta, isSigner: false, isWritable: true },
      { pubkey: klendProgram, isSigner: false, isWritable: false },
      { pubkey: klendReserve, isSigner: false, isWritable: true },
      { pubkey: klendLendingMarket, isSigner: false, isWritable: false },
      { pubkey: klendLendingMarketAuthority, isSigner: false, isWritable: false },
      { pubkey: reserveLiquiditySupply, isSigner: false, isWritable: true },
      { pubkey: reserveCollateralMint, isSigner: false, isWritable: true },
      { pubkey: pythOracle, isSigner: false, isWritable: false },
      { pubkey: switchboardPriceOracle, isSigner: false, isWritable: false },
      { pubkey: switchboardTwapOracle, isSigner: false, isWritable: false },
      { pubkey: scopePrices, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── 18. createHarvestAndDistributeFeesIx ─────────────────────────────

/**
 * Build a `harvest_fees` TransactionInstruction.
 *
 * Permissionless. Sweeps Token-2022 withheld fees from source accounts
 * into the treasury ATA. Source accounts are passed via `sourceAccounts`.
 *
 * Accounts (order must match HarvestFees struct in governance.rs):
 *   0. authority         (signer, writable)
 *   1. protocol_state    (readonly) — legacy PDA (seeds = ["protocol", mint])
 *   2. mint              (writable)
 *   3. treasury          (writable) — treasury ATA
 *   4. token_program     (readonly) — Token-2022
 *   + remaining_accounts: source token accounts to sweep
 *
 * No args beyond disc.
 */
export async function createHarvestAndDistributeFeesIx(
  authority: PublicKey,
  ccmMint: PublicKey,
  treasuryAta: PublicKey,
  /** Token-2022 accounts with withheld fees to sweep (max 30). */
  sourceAccounts: PublicKey[],
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const legacyProtocolState = getLegacyProtocolStatePDA(ccmMint, programId);

  const disc = await anchorDisc('harvest_fees');
  const data = Buffer.alloc(8);
  disc.copy(data, 0);

  const keys = [
    { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: legacyProtocolState, isSigner: false, isWritable: false },
    { pubkey: ccmMint, isSigner: false, isWritable: true },
    { pubkey: treasuryAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Append source accounts as remaining_accounts
  for (const source of sourceAccounts) {
    keys.push({ pubkey: source, isSigner: false, isWritable: true });
  }

  return new TransactionInstruction({ programId, keys, data });
}

// ── 19. createRouteTreasuryIx ────────────────────────────────────────

/**
 * Build a `route_treasury` TransactionInstruction.
 *
 * Phase 2 treasury routing — moves CCM from treasury to destination with min_reserve guard.
 *
 * Accounts (order must match RouteTreasury struct in governance.rs):
 *   0. admin            (signer, writable)
 *   1. protocol_state   (readonly) — legacy PDA (seeds = ["protocol", mint])
 *   2. mint             (readonly)
 *   3. treasury_ata     (writable) — source
 *   4. destination_ata  (writable) — target
 *   5. token_program    (readonly) — Token-2022
 *
 * Args: amount (u64), min_reserve (u64)
 */
export async function createRouteTreasuryIx(
  admin: PublicKey,
  ccmMint: PublicKey,
  treasuryAta: PublicKey,
  destinationAta: PublicKey,
  amount: bigint | number,
  minReserve: bigint | number,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const legacyProtocolState = getLegacyProtocolStatePDA(ccmMint, programId);

  const disc = await anchorDisc('route_treasury');
  const data = Buffer.alloc(24);
  disc.copy(data, 0);
  data.writeBigUInt64LE(BigInt(amount), 8);
  data.writeBigUInt64LE(BigInt(minReserve), 16);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: legacyProtocolState, isSigner: false, isWritable: false },
      { pubkey: ccmMint, isSigner: false, isWritable: false },
      { pubkey: treasuryAta, isSigner: false, isWritable: true },
      { pubkey: destinationAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── 20. createWithdrawFeesFromMintIx ─────────────────────────────────

/**
 * Build a `withdraw_fees_from_mint` TransactionInstruction.
 *
 * Permissionless. Moves accumulated withheld fees from the mint itself to treasury.
 *
 * Accounts (order must match WithdrawFeesFromMint struct in governance.rs):
 *   0. authority         (signer, writable)
 *   1. protocol_state    (readonly) — legacy PDA (seeds = ["protocol", mint])
 *   2. mint              (writable)
 *   3. treasury_ata      (writable)
 *   4. token_program     (readonly) — Token-2022
 *
 * No args beyond disc.
 */
export async function createWithdrawFeesFromMintIx(
  authority: PublicKey,
  ccmMint: PublicKey,
  treasuryAta: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const legacyProtocolState = getLegacyProtocolStatePDA(ccmMint, programId);

  const disc = await anchorDisc('withdraw_fees_from_mint');
  const data = Buffer.alloc(8);
  disc.copy(data, 0);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: legacyProtocolState, isSigner: false, isWritable: false },
      { pubkey: ccmMint, isSigner: false, isWritable: true },
      { pubkey: treasuryAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── 21. createReallocLegacyProtocolIx ────────────────────────────────

/**
 * Build a `realloc_legacy_protocol` TransactionInstruction.
 *
 * One-shot migration: extends the legacy 141-byte ProtocolState PDA
 * (seeds = ["protocol", mint]) to 173 bytes and inserts oracle_authority.
 *
 * Accounts (order must match ReallocLegacyProtocol struct in governance.rs):
 *   0. admin                (signer, writable)
 *   1. live_protocol_state  (readonly) — current ProtocolState (seeds = ["protocol_state"])
 *   2. legacy_protocol_state (writable) — legacy PDA (seeds = ["protocol", mint])
 *   3. mint                 (readonly)
 *   4. system_program       (readonly)
 *
 * No args beyond disc.
 */
export async function createReallocLegacyProtocolIx(
  admin: PublicKey,
  ccmMint: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const liveProtocolState = getProtocolStatePDA(programId);
  const legacyProtocolState = getLegacyProtocolStatePDA(ccmMint, programId);

  const disc = await anchorDisc('realloc_legacy_protocol');
  const data = Buffer.alloc(8);
  disc.copy(data, 0);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: liveProtocolState, isSigner: false, isWritable: false },
      { pubkey: legacyProtocolState, isSigner: false, isWritable: true },
      { pubkey: ccmMint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── 22. createReallocMarketVaultIx ───────────────────────────────────

/**
 * Build a `realloc_market_vault` TransactionInstruction.
 *
 * Grows existing MarketVault PDA from 137 to 153 bytes (Phase 2 NAV fields).
 * Admin-only. No-op if already at target size.
 *
 * Accounts (order must match ReallocMarketVault struct in vault.rs):
 *   0. payer            (signer, writable)
 *   1. protocol_state   (readonly)
 *   2. market_vault     (writable) — UncheckedAccount (may be undersized)
 *   3. system_program   (readonly)
 *
 * Args: market_id (u64)
 */
export async function createReallocMarketVaultIx(
  payer: PublicKey,
  marketId: number,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);
  const marketVault = getMarketVaultPDA(protocolState, marketId, programId);

  const disc = await anchorDisc('realloc_market_vault');
  const data = Buffer.alloc(16);
  disc.copy(data, 0);
  data.writeBigUInt64LE(BigInt(marketId), 8);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: marketVault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── 23. createResolveMarketIx ────────────────────────────────────────

/**
 * Build a `resolve_market` TransactionInstruction (prediction markets).
 *
 * Accounts (order must match ResolveMarket struct in markets.rs):
 *   0. resolver          (signer)
 *   1. protocol_state    (readonly)
 *   2. global_root_config (readonly)
 *   3. market_state      (writable)
 *
 * Args: cumulative_total (u64), proof (Vec<[u8; 32]>)
 */
export async function createResolveMarketIx(
  resolver: PublicKey,
  ccmMint: PublicKey,
  marketId: number,
  cumulativeTotal: bigint | number,
  proofHex: string[],
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);
  const globalRootConfig = getGlobalRootConfigPDA(ccmMint, programId);
  const marketState = getMarketStatePDA(ccmMint, marketId, programId);

  const proofBytes = proofHex.map((h) => Buffer.from(h, 'hex'));

  // Data: [8 disc][8 cumulative_total][4 proof_len][N * 32 proof]
  const disc = await anchorDisc('resolve_market');
  const dataLen = 8 + 8 + 4 + proofBytes.length * 32;
  const data = Buffer.alloc(dataLen);
  let offset = 0;

  disc.copy(data, offset); offset += 8;
  data.writeBigUInt64LE(BigInt(cumulativeTotal), offset); offset += 8;
  data.writeUInt32LE(proofBytes.length, offset); offset += 4;
  for (const node of proofBytes) {
    node.copy(data, offset);
    offset += 32;
  }

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: resolver, isSigner: true, isWritable: false },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: globalRootConfig, isSigner: false, isWritable: false },
      { pubkey: marketState, isSigner: false, isWritable: true },
    ],
    data,
  });
}

// ── 24. createSetPausedOpenIx ────────────────────────────────────────

/**
 * Build a `set_paused_open` TransactionInstruction.
 *
 * Emergency pause/unpause toggle. Admin-only.
 *
 * Accounts (order must match SetPausedOpen struct in admin.rs):
 *   0. admin           (signer, writable)
 *   1. protocol_state  (writable)
 *
 * Args: paused (bool, serialized as u8: 0 or 1)
 */
export async function createSetPausedOpenIx(
  admin: PublicKey,
  paused: boolean,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);

  const disc = await anchorDisc('set_paused_open');
  const data = Buffer.alloc(9);
  disc.copy(data, 0);
  data.writeUInt8(paused ? 1 : 0, 8);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: true },
    ],
    data,
  });
}

// ── 25. createInitializeGlobalRootIx ─────────────────────────────────

/**
 * Build an `initialize_global_root` TransactionInstruction.
 *
 * Creates the singleton GlobalRootConfig PDA for merkle root publishing.
 *
 * Accounts (order must match InitializeGlobalRoot struct in global.rs):
 *   0. payer              (signer, writable)
 *   1. protocol_state     (readonly)
 *   2. global_root_config (writable, init)
 *   3. system_program     (readonly)
 *
 * No args beyond disc.
 */
export async function createInitializeGlobalRootIx(
  payer: PublicKey,
  ccmMint: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);
  const globalRootConfig = getGlobalRootConfigPDA(ccmMint, programId);

  const disc = await anchorDisc('initialize_global_root');
  const data = Buffer.alloc(8);
  disc.copy(data, 0);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: globalRootConfig, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ── 26. createSetPriceUpdaterIx ──────────────────────────────────────

/**
 * Build a `set_price_updater` TransactionInstruction.
 *
 * Authority rotates the cranker key for a price feed.
 *
 * Accounts (order must match SetPriceUpdater struct in price_feed.rs):
 *   0. authority     (signer)
 *   1. price_feed    (writable)
 *
 * Args: label ([u8; 32]), new_updater (Pubkey)
 */
export async function createSetPriceUpdaterIx(
  authority: PublicKey,
  /** 32-byte label (zero-padded). Use `Buffer.alloc(32)` and write your label. */
  label: Buffer,
  newUpdater: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const priceFeed = getPriceFeedPDA(label, programId);

  // Data: [8 disc][32 label][32 new_updater]
  const disc = await anchorDisc('set_price_updater');
  const data = Buffer.alloc(8 + 32 + 32);
  disc.copy(data, 0);
  label.copy(data, 8);
  newUpdater.toBuffer().copy(data, 40);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: priceFeed, isSigner: false, isWritable: true },
    ],
    data,
  });
}

// ══════════════════════════════════════════════════════════════════════
// PREDICTION MARKET TRADING INSTRUCTIONS
// ══════════════════════════════════════════════════════════════════════

/** Standard SPL Token program (used for YES/NO outcome tokens). */
const SPL_TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

/**
 * Build a `mint_shares` TransactionInstruction (prediction markets).
 *
 * Deposits CCM into the prediction market vault and receives 1:1 YES + NO tokens.
 *
 * Accounts (13 fixed, order matches markets.rs mint_shares):
 *   0.  depositor          (signer, writable)
 *   1.  protocol_state     (readonly)
 *   2.  market_state       (writable)
 *   3.  ccm_mint           (readonly)
 *   4.  depositor_ccm_ata  (writable)
 *   5.  vault              (writable)
 *   6.  yes_mint           (writable)
 *   7.  no_mint            (writable)
 *   8.  depositor_yes_ata  (writable)
 *   9.  depositor_no_ata   (writable)
 *   10. mint_authority     (readonly)
 *   11. token_program      (Token-2022, for CCM)
 *   12. outcome_token_prog (SPL Token, for YES/NO)
 *
 * Args: amount (u64) — CCM native units to deposit
 */
export async function createMintSharesIx(
  depositor: PublicKey,
  ccmMint: PublicKey,
  marketId: number,
  amount: bigint | number,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);
  const marketState = getMarketStatePDA(ccmMint, marketId, programId);
  const vault = getPredictionVaultPDA(ccmMint, marketId, programId);
  const yesMint = getPredictionYesMintPDA(ccmMint, marketId, programId);
  const noMint = getPredictionNoMintPDA(ccmMint, marketId, programId);
  const mintAuthority = getPredictionMintAuthorityPDA(ccmMint, marketId, programId);

  const depositorCcm = getAta(depositor, ccmMint, TOKEN_2022_PROGRAM_ID);
  const depositorYes = getAta(depositor, yesMint, SPL_TOKEN_PROGRAM_ID);
  const depositorNo = getAta(depositor, noMint, SPL_TOKEN_PROGRAM_ID);

  const disc = await anchorDisc('mint_shares');
  const data = Buffer.alloc(16);
  disc.copy(data, 0);
  data.writeBigUInt64LE(BigInt(amount), 8);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: depositor, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: marketState, isSigner: false, isWritable: true },
      { pubkey: ccmMint, isSigner: false, isWritable: false },
      { pubkey: depositorCcm, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: yesMint, isSigner: false, isWritable: true },
      { pubkey: noMint, isSigner: false, isWritable: true },
      { pubkey: depositorYes, isSigner: false, isWritable: true },
      { pubkey: depositorNo, isSigner: false, isWritable: true },
      { pubkey: mintAuthority, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Build a `redeem_shares` TransactionInstruction (prediction markets).
 *
 * Burns equal YES + NO shares and returns CCM. Pre-resolution only.
 *
 * Accounts (13 fixed, order matches markets.rs redeem_shares):
 *   0.  redeemer           (signer, writable)
 *   1.  protocol_state     (readonly)
 *   2.  market_state       (writable)
 *   3.  ccm_mint           (readonly)
 *   4.  vault              (writable)
 *   5.  yes_mint           (writable)
 *   6.  no_mint            (writable)
 *   7.  redeemer_yes_ata   (writable)
 *   8.  redeemer_no_ata    (writable)
 *   9.  redeemer_ccm_ata   (writable)
 *   10. mint_authority     (readonly)
 *   11. token_program      (Token-2022, for CCM)
 *   12. outcome_token_prog (SPL Token, for YES/NO)
 *
 * Args: shares (u64) — number of YES+NO pairs to redeem
 */
export async function createRedeemSharesIx(
  redeemer: PublicKey,
  ccmMint: PublicKey,
  marketId: number,
  shares: bigint | number,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);
  const marketState = getMarketStatePDA(ccmMint, marketId, programId);
  const vault = getPredictionVaultPDA(ccmMint, marketId, programId);
  const yesMint = getPredictionYesMintPDA(ccmMint, marketId, programId);
  const noMint = getPredictionNoMintPDA(ccmMint, marketId, programId);
  const mintAuthority = getPredictionMintAuthorityPDA(ccmMint, marketId, programId);

  const redeemerYes = getAta(redeemer, yesMint, SPL_TOKEN_PROGRAM_ID);
  const redeemerNo = getAta(redeemer, noMint, SPL_TOKEN_PROGRAM_ID);
  const redeemerCcm = getAta(redeemer, ccmMint, TOKEN_2022_PROGRAM_ID);

  const disc = await anchorDisc('redeem_shares');
  const data = Buffer.alloc(16);
  disc.copy(data, 0);
  data.writeBigUInt64LE(BigInt(shares), 8);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: redeemer, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: marketState, isSigner: false, isWritable: true },
      { pubkey: ccmMint, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: yesMint, isSigner: false, isWritable: true },
      { pubkey: noMint, isSigner: false, isWritable: true },
      { pubkey: redeemerYes, isSigner: false, isWritable: true },
      { pubkey: redeemerNo, isSigner: false, isWritable: true },
      { pubkey: redeemerCcm, isSigner: false, isWritable: true },
      { pubkey: mintAuthority, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Build a `settle` TransactionInstruction (prediction markets).
 *
 * Burns winning-side tokens and returns CCM 1:1. Post-resolution only.
 *
 * Accounts (11 fixed, order matches markets.rs settle):
 *   0.  settler            (signer, writable)
 *   1.  protocol_state     (readonly)
 *   2.  market_state       (readonly)
 *   3.  ccm_mint           (readonly)
 *   4.  vault              (writable)
 *   5.  winning_mint       (writable) — yes_mint if YES won, no_mint if NO
 *   6.  settler_winning    (writable) — settler's ATA for the winning mint
 *   7.  settler_ccm        (writable) — settler's CCM ATA
 *   8.  mint_authority     (readonly)
 *   9.  token_program      (Token-2022, for CCM)
 *   10. outcome_token_prog (SPL Token, for YES/NO)
 *
 * Args: shares (u64) — winning tokens to settle
 */
export async function createSettlePredictionIx(
  settler: PublicKey,
  ccmMint: PublicKey,
  marketId: number,
  shares: bigint | number,
  /** true = YES won, false = NO won */
  yesOutcome: boolean,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction> {
  const protocolState = getProtocolStatePDA(programId);
  const marketState = getMarketStatePDA(ccmMint, marketId, programId);
  const vault = getPredictionVaultPDA(ccmMint, marketId, programId);
  const yesMint = getPredictionYesMintPDA(ccmMint, marketId, programId);
  const noMint = getPredictionNoMintPDA(ccmMint, marketId, programId);
  const mintAuthority = getPredictionMintAuthorityPDA(ccmMint, marketId, programId);

  const winningMint = yesOutcome ? yesMint : noMint;
  const settlerWinning = getAta(settler, winningMint, SPL_TOKEN_PROGRAM_ID);
  const settlerCcm = getAta(settler, ccmMint, TOKEN_2022_PROGRAM_ID);

  const disc = await anchorDisc('settle');
  const data = Buffer.alloc(16);
  disc.copy(data, 0);
  data.writeBigUInt64LE(BigInt(shares), 8);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: settler, isSigner: true, isWritable: true },
      { pubkey: protocolState, isSigner: false, isWritable: false },
      { pubkey: marketState, isSigner: false, isWritable: false },
      { pubkey: ccmMint, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: winningMint, isSigner: false, isWritable: true },
      { pubkey: settlerWinning, isSigner: false, isWritable: true },
      { pubkey: settlerCcm, isSigner: false, isWritable: true },
      { pubkey: mintAuthority, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}
