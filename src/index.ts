/**
 * @wzrd_sol/sdk — TypeScript SDK for the Liquid Attention Protocol.
 *
 * PDA derivation, instruction builders, and account parsers for
 * deposit_market, settle_market, and claim_global.
 */

export const VERSION = '0.2.0';

// ── Constants ──────────────────────────────────────────
export {
  PROGRAM_ID,
  DEVNET_PROGRAM_ID,
  MAINNET_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
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

// ── PDA Derivation ─────────────────────────────────────
export {
  getProtocolStatePDA,
  getMarketVaultPDA,
  getUserPositionPDA,
  getGlobalRootConfigPDA,
  getClaimStatePDA,
  getChannelConfigV2PDA,
  getStreamRootConfigPDA,
  getClaimStateStreamPDA,
  getAta,
} from './pda.js';

// ── Account Parsing & Fetching ─────────────────────────
export type {
  LifecyclePhase,
  LifecyclePhaseInput,
  MarketVaultData,
  MarketVaultFull,
  ProtocolStateData,
  OnChainPosition,
} from './accounts.js';

export {
  parseMarketVault,
  parseProtocolState,
  parseUserMarketPosition,
  deriveLifecyclePhase,
  fetchOnChainPosition,
  fetchMarketVault,
  fetchTokenBalance,
} from './accounts.js';

// ── NAV Helpers ──────────────────────────────────────────
export type { NavInfo } from './nav.js';

export {
  computeSharesForDeposit,
  computePrincipalForSettle,
} from './nav.js';

// ── Instruction Builders ───────────────────────────────
export {
  anchorDisc,
  createAtaIdempotentIx,
  createDepositMarketIx,
  createMintSharesIx,
  createRedeemSharesIx,
  createSettlePredictionIx,
  createSettleMarketIx,
  createInitializeMarketVaultIx,
  // V1 createClaimGlobalIx removed — all agents/consumers use V2 since root_seq 1707
  createClaimGlobalV2Ix,
  createChannelConfigV2Ix,
} from './instructions.js';

// ── Stream (vLOFI) Instruction Builders ──────────────────
export {
  createPublishStreamRootIx,
  createClaimStreamIx,
  createClaimStreamSponsoredIx,
} from './stream.js';

// ── Model Selector ────────────────────────────────────────
export type {
  BudgetTier,
  TaskType,
  VelocityTrend,
  Confidence,
  ModelRecommendation,
  ModelSelectorOptions,
  ModelSelectorConfig,
} from './model-selector.js';

export { ModelSelector, bestModel } from './model-selector.js';

// ── Agent Auth ────────────────────────────────────────────────────
export type {
  ChallengeResponse,
  VerifyResponse,
  InferResponse,
  ReportResponse,
  EarnedResponse,
} from './agent-auth.js';

export {
  agentAuth,
  agentChallenge,
  agentVerify,
  agentInfer,
  agentReport,
  agentEarned,
} from './agent-auth.js';

// ── Agent Loop ────────────────────────────────────────────────────
export type { AgentLoopOptions, CycleResult } from './agent-loop.js';

export { AgentLoop } from './agent-loop.js';
