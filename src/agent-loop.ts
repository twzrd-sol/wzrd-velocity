/**
 * AgentLoop — turn any TypeScript agent into a WZRD earning agent.
 *
 * Ports the core earn loop from Python `wzrd.run_loop()` to TypeScript:
 *   1. Auth via Ed25519 challenge/verify
 *   2. Per task: fetchPick() (momentum API) -> agentInfer() -> agentReport()
 *   3. Check earned -> relay claim if available
 *   4. Sleep -> repeat
 *
 * Scoring parity with Python: confidence × action × trend × task-platform × quality.
 *
 * @example
 * ```ts
 * import { AgentLoop } from '@wzrd_sol/sdk';
 * import { Keypair } from '@solana/web3.js';
 *
 * const loop = new AgentLoop({
 *   keypair: Keypair.fromSecretKey(secretKey),
 *   tasks: ['code', 'chat', 'reasoning'],
 *   cycleSeconds: 300,
 * });
 *
 * loop.start(); // runs forever, handles auth + infer + report + claim
 * ```
 *
 * @module agent-loop
 */

import type { Keypair } from '@solana/web3.js';
import {
  agentAuth,
  agentInfer,
  agentReport,
  agentEarned,
} from './agent-auth.js';
import type { InferResponse, EarnedResponse } from './agent-auth.js';

// ── Types ────────────────────────────────────────────────────────

/** Result of a single cycle, delivered via onCycle callback. */
export interface CycleResult {
  cycle: number;
  tasks: Array<{
    task: string;
    model: string | null;
    qualityScore: number | null;
    executionId: string | null;
    pendingCcm: number;
  }>;
  earned: EarnedResponse | null;
  error: string | null;
}

/** Configuration for the AgentLoop. */
export interface AgentLoopOptions {
  /** Solana keypair for Ed25519 signing. */
  keypair: Keypair;
  /** Task types to report on each cycle. Default: ['code', 'chat', 'reasoning']. */
  tasks?: string[];
  /** Seconds between cycles (minimum 30). Default: 300. */
  cycleSeconds?: number;
  /** Stop after N cycles. Omit or 0 for infinite. */
  maxCycles?: number;
  /** Attempt gasless relay claim when CCM is claimable. Default: true. */
  claim?: boolean;
  /** API base URL. Default: 'https://api.twzrd.xyz'. */
  apiBase?: string;
  /** Optional callback invoked after each cycle completes. */
  onCycle?: (result: CycleResult) => void;
}

// ── Constants ────────────────────────────────────────────────────

const DEFAULT_TASKS = ['code', 'chat', 'reasoning'];
const DEFAULT_CYCLE_SECONDS = 300;
const MIN_CYCLE_SECONDS = 30;
const SESSION_REFRESH_CYCLES = 100;

// ── Helpers ──────────────────────────────────────────────────────

function timestamp(): string {
  return new Date().toISOString().substring(11, 19);
}

function log(msg: string): void {
  console.log(`${timestamp()} [wzrd] ${msg}`);
}

function fmtCcm(raw: number): string {
  if (!raw) return '0 CCM';
  const human = Math.floor(raw / 1e6).toLocaleString();
  return `${human} CCM`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Signal from the momentum API.
 * Matches Python client.Signal fields used for scoring.
 */
interface MomentumSignal {
  model: string;
  score: number;
  trend: string;
  confidence: string;
  action: string;
  platform: string;
  capabilities?: string[];
  quality_index?: number | null;
}

/** Pick result with full scoring metadata (mirrors Python PickResult). */
interface PickWithMeta extends MomentumSignal {
  finalScore: number;
  rawScore: number;
  policy: string;
  reason: string;
}

// Scoring weights — exact parity with Python client._TREND_WEIGHTS etc.
const TREND_WEIGHTS: Record<string, number> = {
  surging: 3.0, accelerating: 2.0, stable: 1.0, onchain: 1.0,
  insufficient_history: 0.8, decelerating: 0.5, cooling: 0.25,
};

const CONFIDENCE_WEIGHTS: Record<string, number> = {
  normal: 1.0, high: 1.0, low: 0.6, insufficient: 0.35, unknown: 0.75,
};

const ACTION_WEIGHTS: Record<string, number> = {
  pre_warm_urgent: 1.2, pre_warm: 1.1, candidate: 1.0, recommend: 1.0,
  onchain: 1.0, route: 1.0, maintain: 0.9, prewarm: 0.95,
  evaluate: 0.9, watch: 0.6, consider_deprovision: 0.3, observe: 0.25,
};

const TASK_PLATFORM_WEIGHTS: Record<string, Record<string, number>> = {
  code: { github: 1.5, openrouter: 1.2, artificial_analysis: 1.1, huggingface: 1.0 },
  coding: { github: 1.5, openrouter: 1.2, artificial_analysis: 1.1, huggingface: 1.0 },
  chat: { openrouter: 1.5, artificial_analysis: 1.1, github: 0.8, huggingface: 1.0 },
  conversation: { openrouter: 1.5, artificial_analysis: 1.1, github: 0.8, huggingface: 1.0 },
  reasoning: { artificial_analysis: 1.5, openrouter: 1.2, github: 0.8, huggingface: 1.0 },
  math: { artificial_analysis: 1.5, openrouter: 1.2, github: 0.8, huggingface: 1.0 },
};

const TRUSTED_CONFIDENCE = new Set(['normal', 'high']);
const RELAXED_CONFIDENCE = new Set(['normal', 'high', 'low']);

const CAP_MAP: Record<string, string> = {
  code: 'code', coding: 'code', chat: 'chat', conversation: 'chat',
  reasoning: 'reasoning', math: 'reasoning', vision: 'vision',
};

/**
 * Pick the top model for a task from the momentum API.
 * Full parity with Python client._rank_signals() scoring:
 * score × trend × confidence × action × task-platform × quality
 */
async function fetchPick(task: string, apiBase: string): Promise<PickWithMeta | null> {
  try {
    const resp = await fetch(`${apiBase}/v1/signals/momentum`);
    if (!resp.ok) return null;
    const data = await resp.json() as { models?: MomentumSignal[] };
    const models = data.models ?? [];
    if (models.length === 0) return null;

    // Step 1: Filter by capability
    const requiredCap = CAP_MAP[task];
    const capFiltered = requiredCap
      ? models.filter((m) => m.capabilities?.includes(requiredCap))
      : models;
    const afterCap = capFiltered.length > 0 ? capFiltered : models;

    // Step 2: Filter by confidence + action (trusted → relaxed → all)
    const trusted = afterCap.filter(
      (m) => TRUSTED_CONFIDENCE.has(m.confidence) && m.action !== 'observe',
    );
    const relaxed = afterCap.filter(
      (m) => RELAXED_CONFIDENCE.has(m.confidence) && m.action !== 'observe',
    );
    const pool = trusted.length > 0 ? trusted : relaxed.length > 0 ? relaxed : afterCap;

    // Step 3: Score with full 5-layer weighting
    const taskKey = task.toLowerCase().trim();
    const platformWeights = TASK_PLATFORM_WEIGHTS[taskKey] ?? {};

    const scored: PickWithMeta[] = pool.map((m) => {
      const rawScore = m.score ?? 0;
      let s = rawScore;
      s *= TREND_WEIGHTS[m.trend] ?? 1.0;
      s *= CONFIDENCE_WEIGHTS[m.confidence] ?? CONFIDENCE_WEIGHTS.unknown;
      s *= ACTION_WEIGHTS[m.action] ?? 1.0;
      s *= platformWeights[m.platform?.toLowerCase()] ?? 1.0;
      if (m.quality_index != null && m.quality_index > 0) {
        s *= 1.0 + (m.quality_index / 100.0) * 0.15;
      }

      const policy = TRUSTED_CONFIDENCE.has(m.confidence) && m.action !== 'observe'
        ? 'strict'
        : RELAXED_CONFIDENCE.has(m.confidence) && m.action !== 'observe'
          ? 'relaxed'
          : 'fallback';

      return {
        ...m,
        finalScore: s,
        rawScore,
        policy,
        reason: `${policy} signal from ${m.platform || 'unknown'}${m.trend === 'surging' || m.trend === 'accelerating' ? ', ' + m.trend : ''}`,
      };
    });

    scored.sort((a, b) => b.finalScore - a.finalScore);
    return scored[0] ?? null;
  } catch {
    return null;
  }
}

// ── AgentLoop ────────────────────────────────────────────────────

/**
 * Runs the WZRD earn loop: authenticate, pick models, infer, report, claim.
 *
 * Create one instance and call `start()`. The loop runs until `maxCycles`
 * is reached or `stop()` is called. Handles SIGINT/SIGTERM for graceful
 * shutdown.
 */
export class AgentLoop {
  private readonly keypair: Keypair;
  private readonly tasks: string[];
  private readonly cycleSeconds: number;
  private readonly maxCycles: number;
  private readonly claim: boolean;
  private readonly apiBase: string;
  private readonly onCycle?: (result: CycleResult) => void;

  private running = false;
  private token: string | null = null;
  private sleepResolve: (() => void) | null = null;

  constructor(options: AgentLoopOptions) {
    this.keypair = options.keypair;
    this.tasks = options.tasks ?? DEFAULT_TASKS;
    const cs = options.cycleSeconds ?? DEFAULT_CYCLE_SECONDS;
    if (!Number.isFinite(cs)) throw new Error('cycleSeconds must be a finite number');
    this.cycleSeconds = Math.max(cs, MIN_CYCLE_SECONDS);
    this.maxCycles = options.maxCycles ?? 0;
    this.claim = options.claim ?? true;
    this.apiBase = options.apiBase ?? 'https://api.twzrd.xyz';
    this.onCycle = options.onCycle;
  }

  /**
   * Start the earn loop. Blocks until maxCycles is reached or stop() is called.
   */
  async start(): Promise<void> {
    if (this.running) throw new Error('AgentLoop is already running');
    this.running = true;
    const pubkey = this.keypair.publicKey.toBase58();

    // Graceful shutdown on SIGINT/SIGTERM
    const handleSignal = () => {
      log('shutting down...');
      this.stop();
    };
    if (typeof process !== 'undefined') {
      process.on('SIGINT', handleSignal);
      process.on('SIGTERM', handleSignal);
    }

    log(`agent: ${pubkey}`);
    log(`tasks: ${this.tasks.join(', ')} | cycle: ${this.cycleSeconds}s`);

    let cycle = 0;
    let totalReports = 0;
    let verifiedReports = 0;
    let claimsMade = 0;

    try {
      while (this.running) {
        if (this.maxCycles > 0 && cycle >= this.maxCycles) {
          log(`max_cycles reached (${this.maxCycles}), stopping`);
          break;
        }

        cycle++;
        const cycleStart = Date.now();
        const cycleResult: CycleResult = { cycle, tasks: [], earned: null, error: null };

        try {
          // Re-auth on first cycle and every SESSION_REFRESH_CYCLES
          if (cycle === 1 || cycle % SESSION_REFRESH_CYCLES === 0) {
            this.token = await agentAuth(this.keypair, this.apiBase);
            log(`authenticated (session ${SESSION_REFRESH_CYCLES} cycles)`);
          }

          // Pick + infer + report per task
          for (const task of this.tasks) {
            if (!this.running) break;

            const taskResult = {
              task,
              model: null as string | null,
              qualityScore: null as number | null,
              executionId: null as string | null,
              pendingCcm: 0,
            };

            try {
              const pick = await fetchPick(task, this.apiBase);
              if (!pick) {
                log(`cycle ${cycle} | ${task} | no models available`);
                cycleResult.tasks.push(taskResult);
                continue;
              }

              const model = pick.model;
              taskResult.model = model;

              // Server-witnessed inference
              let infer: InferResponse | null = null;
              try {
                infer = await agentInfer(this.token!, model, task, this.apiBase);
                taskResult.executionId = infer.execution_id;
                taskResult.qualityScore = infer.quality_score;

                if (infer.execution_id) {
                  const costStr = infer.cost_usd ? `, $${infer.cost_usd.toFixed(4)}` : '';
                  log(
                    `cycle ${cycle} | ${task} | infer via ${infer.provider ?? '?'} -> ` +
                    `${infer.executed_model ?? '?'} (q=${(infer.quality_score ?? 0).toFixed(2)}, ` +
                    `${infer.latency_ms ?? 0}ms${costStr})`,
                  );
                }
              } catch (e) {
                log(`cycle ${cycle} | ${task} | infer failed (reporting without): ${e}`);
              }

              // Report the pick (with full metadata.wzrd block — parity with Python report_pick)
              const reportResp = await agentReport(
                this.token!,
                model,
                {
                  taskType: task,
                  executionId: infer?.execution_id,
                  qualityScore: infer?.quality_score,
                  latencyMs: infer?.latency_ms,
                  costUsd: infer?.cost_usd,
                  metadata: {
                    wzrd: {
                      source: 'wzrd-sdk',
                      model: pick.model,
                      signal_model: pick.model,
                      selected_model: pick.model,
                      score: pick.finalScore,
                      raw_score: pick.rawScore,
                      trend: pick.trend,
                      confidence: pick.confidence,
                      action: pick.action,
                      platform: pick.platform,
                      policy: pick.policy,
                      policy_version: '1.0',
                      reason: pick.reason,
                      candidate_rank: 0,
                      exploration: false,
                      run_id: pubkey.substring(0, 12),
                      cycle_id: cycle,
                    },
                  },
                },
                this.apiBase,
              );

              totalReports++;
              if (infer?.execution_id) verifiedReports++;

              const tag = infer?.execution_id ? 'V' : 'o';
              taskResult.pendingCcm = reportResp.pending_ccm ?? 0;
              log(
                `cycle ${cycle} | ${tag} ${task} -> ${model} | pending: ${fmtCcm(taskResult.pendingCcm)}`,
              );
            } catch (e) {
              log(`cycle ${cycle} | ${task} | error: ${e}`);
            }

            cycleResult.tasks.push(taskResult);
          }

          // Check earned + claim
          if (this.claim && this.running && this.token) {
            try {
              const earned = await agentEarned(this.token, this.apiBase);
              cycleResult.earned = earned;
              const pending = earned.pending_ccm ?? 0;

              if (pending > 0) {
                try {
                  const claimResp = await fetch(
                    `${this.apiBase}/v1/claims/${pubkey}/relay`,
                    {
                      method: 'POST',
                      headers: {
                        Authorization: `Bearer ${this.token}`,
                        'Content-Type': 'application/json',
                      },
                    },
                  );
                  if (claimResp.ok) {
                    const data = await claimResp.json() as { tx_sig?: string };
                    if (data.tx_sig) {
                      claimsMade++;
                      const txShort = data.tx_sig.length > 20
                        ? data.tx_sig.substring(0, 20) + '...'
                        : data.tx_sig;
                      log(`claimed ${fmtCcm(pending)} | tx: ${txShort}`);
                    }
                  }
                } catch {
                  // relay unavailable or rate limited — try next cycle
                }
              }
            } catch {
              // earned check failed — try next cycle
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          cycleResult.error = msg;
          log(`cycle ${cycle} failed: ${msg}`);
        }

        // Notify callback
        if (this.onCycle) {
          try {
            this.onCycle(cycleResult);
          } catch {
            // callback errors should not break the loop
          }
        }

        // Sleep until next cycle (cancellable via stop())
        const elapsed = Date.now() - cycleStart;
        const sleepMs = Math.max(0, this.cycleSeconds * 1000 - elapsed);
        if (sleepMs > 0 && this.running) {
          await new Promise<void>((resolve) => {
            this.sleepResolve = resolve;
            const timer = setTimeout(() => { this.sleepResolve = null; resolve(); }, sleepMs);
            // If stop() was called during setup, resolve immediately
            if (!this.running) { clearTimeout(timer); this.sleepResolve = null; resolve(); }
          });
        }
      }
    } finally {
      // Clean up signal handlers
      if (typeof process !== 'undefined') {
        process.removeListener('SIGINT', handleSignal);
        process.removeListener('SIGTERM', handleSignal);
      }
      this.running = false;
    }

    // Session summary
    log('------------------------------------------------');
    log(`session complete: ${cycle} cycles`);
    log(`reports: ${totalReports} total (${verifiedReports} verified, ${totalReports - verifiedReports} unverified)`);
    if (claimsMade > 0) {
      log(`claims: ${claimsMade}`);
    }

    // Final earned status
    if (this.token) {
      try {
        const final_ = await agentEarned(this.token, this.apiBase);
        const total = final_.total_earned_ccm ?? 0;
        const pending = final_.pending_ccm ?? 0;
        const parts: string[] = [];
        parts.push(`${fmtCcm(total)} lifetime`);
        if (pending > 0) parts.push(`${fmtCcm(pending)} pending`);
        if (final_.rank) parts.push(`rank #${final_.rank}`);
        if (final_.contribution_streak_days > 1) {
          parts.push(`${final_.contribution_streak_days}-day streak`);
        }
        log(parts.join(' | '));
      } catch {
        // best effort
      }
    }
  }

  /**
   * Signal the loop to stop after the current cycle completes.
   */
  stop(): void {
    this.running = false;
    // Cancel any pending sleep so shutdown is immediate
    if (this.sleepResolve) {
      this.sleepResolve();
      this.sleepResolve = null;
    }
  }
}
