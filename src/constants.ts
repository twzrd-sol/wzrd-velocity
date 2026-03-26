import { PublicKey } from '@solana/web3.js';

// ── Program IDs ────────────────────────────────────────

/** Devnet program ID (matches declare_id! in lib.rs) */
export const DEVNET_PROGRAM_ID = new PublicKey('GmGXXNjLhxKdEfCqnYgW2tev4DewPvgUXzhsVfm677VW');

/** Mainnet program ID */
export const MAINNET_PROGRAM_ID = new PublicKey('GnGzNdsQMxMpJfMeqnkGPsvHm8kwaDidiKjNU2dCVZop');

/** Default program ID — mainnet */
export const PROGRAM_ID = MAINNET_PROGRAM_ID;

// ── Token Program IDs ──────────────────────────────────

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

// ── PDA Seeds (must match programs/attention-oracle/src/constants.rs) ──

export const PROTOCOL_STATE_SEED = 'protocol_state';
export const MARKET_VAULT_SEED = 'market_vault';
export const MARKET_POSITION_SEED = 'market_position';
export const GLOBAL_ROOT_SEED = 'global_root';
export const CLAIM_STATE_GLOBAL_SEED = 'claim_global';
export const CHANNEL_CONFIG_V2_SEED = 'channel_cfg_v2';

// ── Stream (vLOFI distribution) PDA Seeds ────────────────

export const STREAM_ROOT_SEED = 'stream_root';
export const CLAIM_STATE_STREAM_SEED = 'claim_stream';
