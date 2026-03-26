/**
 * Agent Auth — Ed25519 challenge/verify handshake + inference/report/earned helpers.
 *
 * Stateless functions for the WZRD agent API. Used by AgentLoop and
 * directly by any TypeScript agent that needs to authenticate and earn CCM.
 *
 * Runtime dependency: tweetnacl (direct dep — required for Ed25519 signing).
 *
 * @module agent-auth
 */

import type { Keypair } from '@solana/web3.js';

// ── Constants ────────────────────────────────────────────────────

const DEFAULT_API_BASE = 'https://api.twzrd.xyz';

// ── Base58 Encoder (inline — avoids adding bs58 as a direct dep) ─

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes: Uint8Array): string {
  let zeroes = 0;
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) zeroes++;

  const size = Math.ceil(bytes.length * 138 / 100) + 1;
  const b58 = new Uint8Array(size);
  let length = 0;

  for (let i = zeroes; i < bytes.length; i++) {
    let carry = bytes[i];
    let j = 0;
    for (let k = size - 1; k >= 0 && (carry !== 0 || j < length); k--, j++) {
      carry += 256 * b58[k];
      b58[k] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    length = j;
  }

  let result = '1'.repeat(zeroes);
  let started = false;
  for (let i = size - length; i < size; i++) {
    if (!started && b58[i] === 0) continue;
    started = true;
    result += BASE58_ALPHABET[b58[i]];
  }

  return result || '1';
}

// ── Response Types ───────────────────────────────────────────────

/** Response from the challenge endpoint. */
export interface ChallengeResponse {
  nonce: string;
  message_format: string;
}

/** Response from the verify endpoint. */
export interface VerifyResponse {
  token: string;
  pubkey: string;
  expires_at: string;
}

/** Response from the infer endpoint. */
export interface InferResponse {
  execution_id: string | null;
  quality_score: number | null;
  latency_ms: number | null;
  cost_usd: number | null;
  provider: string | null;
  executed_model: string | null;
  response_preview: string | null;
}

/** Response from the report endpoint. */
export interface ReportResponse {
  pending_ccm: number;
  status: string;
}

/** Response from the earned endpoint. */
export interface EarnedResponse {
  total_earned_ccm: number;
  pending_ccm: number;
  rank: number | null;
  contribution_streak_days: number;
  pipeline: {
    state: string | null;
    next_root_eta_secs: number | null;
    hint: string | null;
  } | null;
}

// ── Auth Functions ───────────────────────────────────────────────

/**
 * Request a challenge nonce from the WZRD server.
 */
export async function agentChallenge(
  apiBase: string = DEFAULT_API_BASE,
): Promise<ChallengeResponse> {
  const resp = await fetch(`${apiBase}/v1/agent/challenge`);
  if (!resp.ok) throw new Error(`[wzrd] challenge failed: ${resp.status}`);
  return resp.json() as Promise<ChallengeResponse>;
}

/**
 * Submit a signed challenge for verification. Returns a session token.
 */
export async function agentVerify(
  pubkey: string,
  nonce: string,
  signature: string,
  apiBase: string = DEFAULT_API_BASE,
): Promise<VerifyResponse> {
  const resp = await fetch(`${apiBase}/v1/agent/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pubkey, nonce, signature }),
  });
  if (!resp.ok) throw new Error(`[wzrd] verify failed: ${resp.status}`);
  return resp.json() as Promise<VerifyResponse>;
}

/**
 * Full auth flow: challenge -> sign -> verify -> token.
 *
 * Uses tweetnacl (transitive dep of @solana/web3.js) for Ed25519 signing.
 * Message format: `wzrd-agent-auth v1 | wallet:{pubkey} | nonce:{nonce}`
 */
export async function agentAuth(
  keypair: Keypair,
  apiBase: string = DEFAULT_API_BASE,
): Promise<string> {
  // tweetnacl is a direct dependency (declared in package.json)
  const naclMod = await import('tweetnacl');
  const nacl = naclMod.default ?? naclMod;
  const pubkey = keypair.publicKey.toBase58();

  const { nonce } = await agentChallenge(apiBase);
  const message = `wzrd-agent-auth v1 | wallet:${pubkey} | nonce:${nonce}`;
  const messageBytes = new TextEncoder().encode(message);
  const sig = nacl.sign.detached(messageBytes, keypair.secretKey);
  const signatureB58 = base58Encode(sig);

  const session = await agentVerify(pubkey, nonce, signatureB58, apiBase);
  return session.token;
}

// ── API Functions ────────────────────────────────────────────────

/**
 * Run server-witnessed inference. Returns execution_id for verified reports.
 *
 * The server calls the LLM, grades the response, and stores an execution
 * receipt. Pass the returned `execution_id` to `agentReport()` so the
 * contribution is marked verified (highest reward tier).
 */
export async function agentInfer(
  token: string,
  model: string,
  taskType: string,
  apiBase: string = DEFAULT_API_BASE,
): Promise<InferResponse> {
  const resp = await fetch(`${apiBase}/v1/agent/infer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ model, task_type: taskType }),
  });
  if (!resp.ok) throw new Error(`[wzrd] infer failed: ${resp.status}`);
  return resp.json() as Promise<InferResponse>;
}

/**
 * Report a model pick for reward eligibility.
 */
export async function agentReport(
  token: string,
  modelId: string,
  opts: {
    taskType?: string;
    executionId?: string | null;
    qualityScore?: number | null;
    latencyMs?: number | null;
    costUsd?: number | null;
    outcome?: string;
    /** Full WZRD signal metadata — mirrors Python report_pick().metadata.wzrd */
    metadata?: Record<string, unknown>;
  } = {},
  apiBase: string = DEFAULT_API_BASE,
): Promise<ReportResponse> {
  const payload: Record<string, unknown> = {
    model_id: modelId,
    outcome: opts.outcome ?? 'success',
  };
  if (opts.taskType != null) payload.task_type = opts.taskType;
  if (opts.executionId != null) payload.execution_id = opts.executionId;
  if (opts.qualityScore != null) payload.quality_score = opts.qualityScore;
  if (opts.latencyMs != null) payload.latency_ms = opts.latencyMs;
  if (opts.costUsd != null) payload.cost_usd = opts.costUsd;
  if (opts.metadata != null) payload.metadata = opts.metadata;

  const resp = await fetch(`${apiBase}/v1/agent/report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`[wzrd] report failed: ${resp.status}`);
  return resp.json() as Promise<ReportResponse>;
}

/**
 * Check earned CCM status.
 */
export async function agentEarned(
  token: string,
  apiBase: string = DEFAULT_API_BASE,
): Promise<EarnedResponse> {
  const resp = await fetch(`${apiBase}/v1/agent/earned`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`[wzrd] earned check failed: ${resp.status}`);
  return resp.json() as Promise<EarnedResponse>;
}
