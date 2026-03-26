/**
 * Model Selector — pick the best open-source model using live WZRD velocity data.
 *
 * Combines on-chain attention signals from the WZRD protocol with
 * OpenRouter pricing to compute a value score for every tracked model,
 * then returns a ranked list filtered by budget, task, and trend.
 *
 * Usage:
 *   import { bestModel } from '@wzrd_sol/sdk';
 *   const picks = await bestModel({ task: 'code', budget: 'micro' });
 *   console.log(picks[0].model_id);
 *
 * @module model-selector
 */

// ── Public Types ──────────────────────────────────────────────────

/** Budget tiers controlling the maximum blended price per million tokens. */
export type BudgetTier = 'micro' | 'budget' | 'mid' | 'premium';

/** Supported task types. The selector applies a task-specific boost. */
export type TaskType = 'chat' | 'code' | 'reasoning';

/** Velocity trend labels returned by the WZRD momentum API. */
export type VelocityTrend =
  | 'surging'
  | 'accelerating'
  | 'stable'
  | 'insufficient_history'
  | 'decelerating'
  | 'cooling';

/** Confidence level from the WZRD momentum API. */
export type Confidence = 'high' | 'medium' | 'low' | 'insufficient';

/** A single model recommendation returned by the selector. */
export interface ModelRecommendation {
  /** Full model identifier (e.g. "google/gemma-3-27b-it"). */
  model_id: string;
  /** Routing provider — currently always "openrouter". */
  provider: string;
  /** Blended price per million tokens in USD (3:1 prompt:completion weighting). */
  price_per_m_tokens: number;
  /** Exponential moving average of the model's velocity from WZRD. */
  velocity_ema: number;
  /** Composite value score: velocity_ema / (blended_price + epsilon). Higher is better. */
  value_score: number;
  /** Current velocity trend from the WZRD momentum signal. */
  trend: VelocityTrend;
  /** Confidence level of the momentum signal. */
  confidence: Confidence;
}

/** Options for filtering and ranking models. */
export interface ModelSelectorOptions {
  /** Maximum price tier. Default: "mid". */
  budget?: BudgetTier;
  /** Task type — applies a relevance boost to known-good models. Default: "chat". */
  task?: TaskType;
  /** Minimum confidence level from the momentum signal. Default: "low". */
  min_confidence?: Confidence;
  /** Maximum number of results to return. Default: 5. */
  limit?: number;
  /** Model ID substrings to exclude (case-insensitive). */
  exclude?: string[];
}

/** Configuration for the ModelSelector class. */
export interface ModelSelectorConfig {
  /** WZRD API base URL. Default: "https://api.twzrd.xyz". */
  wzrd_base_url?: string;
  /** OpenRouter catalog URL. Default: "https://openrouter.ai/api/v1/models". */
  openrouter_url?: string;
  /** Cache TTL in milliseconds. Default: 300_000 (5 minutes). */
  cache_ttl_ms?: number;
}

// ── Internal Types (API Responses) ────────────────────────────────

interface WzrdLeaderboardMarket {
  market_id: number;
  channel_id: string;
  platform: string;
  status: string;
  velocity_ema: number;
  multiplier_bps: number;
}

interface WzrdLeaderboardResponse {
  markets: WzrdLeaderboardMarket[];
}

interface WzrdMomentumModel {
  market_id: number;
  velocity_trend: VelocityTrend;
  momentum_score: number;
  velocity_delta_pct: number;
  routing_implication: string;
  history_confidence: Confidence;
}

interface WzrdMomentumResponse {
  models: WzrdMomentumModel[];
}

interface OpenRouterPricing {
  prompt: string;
  completion: string;
}

interface OpenRouterModel {
  id: string;
  pricing?: OpenRouterPricing;
  context_length?: number;
  supported_parameters?: string[];
}

interface OpenRouterCatalogResponse {
  data: OpenRouterModel[];
}

// ── Cache Entry ───────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expires_at: number;
}

// ── Constants ─────────────────────────────────────────────────────

const DEFAULT_WZRD_URL = 'https://api.twzrd.xyz';
const DEFAULT_OPENROUTER_URL = 'https://openrouter.ai/api/v1/models';
const DEFAULT_CACHE_TTL_MS = 300_000; // 5 minutes
const EPSILON = 0.001;

/** Maximum blended price per million tokens for each budget tier. */
const BUDGET_LIMITS: Record<BudgetTier, number> = {
  micro: 0.20,
  budget: 1.00,
  mid: 5.00,
  premium: Infinity,
};

/** Confidence levels ranked from lowest to highest. */
const CONFIDENCE_RANK: Record<Confidence, number> = {
  insufficient: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/** Task-specific model name patterns and their score boost multiplier. */
const TASK_BOOSTS: Record<TaskType, { patterns: string[]; boost: number }> = {
  code: {
    patterns: ['deepseek', 'qwen', 'codestral', 'starcoder', 'coder'],
    boost: 1.3,
  },
  reasoning: {
    patterns: ['deepseek-r', 'o1', 'o3', 'reasoning'],
    boost: 1.5,
  },
  chat: {
    patterns: ['claude', 'gpt', 'gemini', 'chat', 'llama'],
    boost: 1.1,
  },
};

// ── ModelSelector Class ───────────────────────────────────────────

/**
 * Fetches WZRD velocity data and OpenRouter pricing, caches results,
 * and scores models by value (velocity / cost).
 *
 * Create one instance and reuse it — the internal cache avoids redundant
 * HTTP requests within the TTL window.
 *
 * @example
 * ```ts
 * const selector = new ModelSelector({ wzrd_base_url: 'https://api.twzrd.xyz' });
 * const picks = await selector.select({ task: 'code', budget: 'budget', limit: 3 });
 * console.log(picks[0].model_id);
 * ```
 */
export class ModelSelector {
  private readonly wzrdBaseUrl: string;
  private readonly openrouterUrl: string;
  private readonly cacheTtlMs: number;
  private cache: Map<string, CacheEntry<unknown>> = new Map();

  constructor(config: ModelSelectorConfig = {}) {
    this.wzrdBaseUrl = (config.wzrd_base_url ?? DEFAULT_WZRD_URL).replace(/\/+$/, '');
    this.openrouterUrl = config.openrouter_url ?? DEFAULT_OPENROUTER_URL;
    this.cacheTtlMs = config.cache_ttl_ms ?? DEFAULT_CACHE_TTL_MS;
  }

  /**
   * Select the best models for a given task and budget.
   *
   * Fetches live data from the WZRD leaderboard, momentum signal, and
   * OpenRouter catalog (all cached for 5 minutes by default), then ranks
   * every OpenRouter model tracked by WZRD using:
   *
   *   value_score = velocity_ema / (blended_price_per_m_tokens + epsilon)
   *
   * Results are filtered by budget tier, task relevance, minimum confidence,
   * and exclusion list, then sorted by value_score descending.
   *
   * @param options - Filtering and ranking options.
   * @returns Ranked array of model recommendations (may be empty).
   */
  async select(options: ModelSelectorOptions = {}): Promise<ModelRecommendation[]> {
    const {
      budget = 'mid',
      task = 'chat',
      min_confidence = 'low',
      limit = 5,
      exclude = [],
    } = options;

    // Fetch all three data sources in parallel (cached).
    const [leaderboard, momentum, catalog] = await Promise.all([
      this.fetchLeaderboard(),
      this.fetchMomentum(),
      this.fetchOpenRouterCatalog(),
    ]);

    // If any critical source failed, return empty (graceful degradation).
    if (leaderboard === null || catalog === null) {
      return [];
    }

    // Build lookup indices.
    const orIndex = new Map<string, OpenRouterModel>();
    for (const m of catalog.data) {
      orIndex.set(m.id, m);
    }

    const momentumIndex = new Map<number, WzrdMomentumModel>();
    if (momentum !== null) {
      for (const m of momentum.models) {
        momentumIndex.set(m.market_id, m);
      }
    }

    // Filtering thresholds.
    const maxPrice = BUDGET_LIMITS[budget];
    const minConfidenceRank = CONFIDENCE_RANK[min_confidence];
    const taskBoost = TASK_BOOSTS[task];
    const excludeLower = exclude.map((e) => e.toLowerCase());

    const candidates: ModelRecommendation[] = [];

    for (const market of leaderboard.markets) {
      if (market.platform !== 'openrouter') continue;
      if (market.status !== 'open') continue;

      const orModel = orIndex.get(market.channel_id);
      if (!orModel) continue;

      // Exclusion filter.
      if (excludeLower.some((e) => market.channel_id.toLowerCase().includes(e))) continue;

      // Compute blended price per million tokens (3:1 prompt:completion weighting).
      const promptPrice = parseFloat(orModel.pricing?.prompt ?? '0');
      const completionPrice = parseFloat(orModel.pricing?.completion ?? '0');
      const blendedPerM = ((promptPrice * 3 + completionPrice) / 4) * 1_000_000;

      // Budget filter.
      if (blendedPerM > maxPrice) continue;

      // Momentum data.
      const mom = momentumIndex.get(market.market_id);
      const trend: VelocityTrend = mom?.velocity_trend ?? 'insufficient_history';
      const confidence: Confidence = mom?.history_confidence ?? 'insufficient';

      // Confidence filter.
      const confidenceRank = CONFIDENCE_RANK[confidence];
      if (confidenceRank < minConfidenceRank) continue;

      // Compute value score: velocity / (price + epsilon).
      const velocityEma = market.velocity_ema;
      const rawValueScore = velocityEma / (blendedPerM + EPSILON);

      // Apply task-specific boost.
      let taskMultiplier = 1.0;
      if (taskBoost) {
        for (const pattern of taskBoost.patterns) {
          if (market.channel_id.toLowerCase().includes(pattern)) {
            taskMultiplier = taskBoost.boost;
            break;
          }
        }
      }

      const valueScore = rawValueScore * taskMultiplier;

      candidates.push({
        model_id: market.channel_id,
        provider: 'openrouter',
        price_per_m_tokens: Math.round(blendedPerM * 1000) / 1000,
        velocity_ema: velocityEma,
        value_score: Math.round(valueScore * 1000) / 1000,
        trend,
        confidence,
      });
    }

    // Sort by value_score descending.
    candidates.sort((a, b) => b.value_score - a.value_score);

    return candidates.slice(0, limit);
  }

  /**
   * Invalidate the in-memory cache.
   *
   * Useful when you know upstream data has changed and want
   * fresh results on the next `select()` call.
   */
  clearCache(): void {
    this.cache.clear();
  }

  // ── Private Helpers ───────────────────────────────────────────

  private async fetchLeaderboard(): Promise<WzrdLeaderboardResponse | null> {
    return this.cachedFetch<WzrdLeaderboardResponse>(
      'wzrd:leaderboard',
      `${this.wzrdBaseUrl}/v1/leaderboard?limit=100`,
    );
  }

  private async fetchMomentum(): Promise<WzrdMomentumResponse | null> {
    return this.cachedFetch<WzrdMomentumResponse>(
      'wzrd:momentum',
      `${this.wzrdBaseUrl}/v1/signals/momentum`,
    );
  }

  private async fetchOpenRouterCatalog(): Promise<OpenRouterCatalogResponse | null> {
    return this.cachedFetch<OpenRouterCatalogResponse>(
      'openrouter:catalog',
      this.openrouterUrl,
    );
  }

  /**
   * Fetch JSON from a URL with in-memory TTL caching.
   * Returns null on any error (network, HTTP status, parse failure).
   */
  private async cachedFetch<T>(key: string, url: string): Promise<T | null> {
    const now = Date.now();
    const cached = this.cache.get(key) as CacheEntry<T> | undefined;
    if (cached && cached.expires_at > now) {
      return cached.data;
    }

    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        return null;
      }
      const data = (await resp.json()) as T;
      this.cache.set(key, { data, expires_at: now + this.cacheTtlMs });
      return data;
    } catch {
      return null;
    }
  }
}

// ── Convenience Function ──────────────────────────────────────────

/** Shared singleton used by the convenience `bestModel()` function. */
let defaultSelector: ModelSelector | null = null;

/**
 * Pick the best open-source model for a task using live WZRD velocity data.
 *
 * This is a convenience wrapper around {@link ModelSelector.select} that
 * uses a module-level singleton with default configuration. For custom
 * base URLs or cache settings, instantiate {@link ModelSelector} directly.
 *
 * @param options - Filtering and ranking options.
 * @returns Ranked array of model recommendations (may be empty if the API is unreachable).
 *
 * @example
 * ```ts
 * import { bestModel } from '@wzrd_sol/sdk';
 *
 * // Cheapest model good for code
 * const picks = await bestModel({ task: 'code', budget: 'micro' });
 * console.log(picks[0].model_id);
 *
 * // Premium reasoning model, exclude specific providers
 * const reasoning = await bestModel({
 *   task: 'reasoning',
 *   budget: 'premium',
 *   exclude: ['gpt'],
 *   limit: 3,
 * });
 * ```
 */
export async function bestModel(options: ModelSelectorOptions = {}): Promise<ModelRecommendation[]> {
  if (!defaultSelector) {
    defaultSelector = new ModelSelector();
  }
  return defaultSelector.select(options);
}
