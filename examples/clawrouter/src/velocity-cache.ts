/**
 * WZRD Velocity Cache — background fetcher for ClawRouter scoring integration.
 *
 * Polls WZRD's /momentum/premium endpoint every 5 minutes, caches velocity
 * scores per model. Synchronous lookups return cached data (<1µs), compatible
 * with ClawRouter's <1ms scoring constraint.
 *
 * Usage:
 *   import { getVelocityScore, getVelocitySignal, startCache } from './velocity-cache';
 *
 *   await startCache(); // warm the cache on startup
 *
 *   const score = getVelocityScore("qwen/qwen3.5-9b");         // 0.0–1.0
 *   const signal = getVelocitySignal("qwen/qwen3.5-9b");       // full signal or null
 */

export interface VelocitySignal {
  model: string;
  score: number;
  trend: string;
  action: string;
  confidence: string;
  platform: string;
  velocity_ema?: number;
  accel?: number;
  quality_index?: number | null;
}

interface MomentumResponse {
  contract_version: string;
  generated_at: string;
  count: number;
  models: Array<{
    model: string;
    trend: string;
    score: number;
    action: string;
    confidence: string;
    platform: string;
    velocity_ema?: number;
    accel?: number;
    delta_pct?: number;
    quality_index?: number | null;
  }>;
}

const DEFAULT_API_URL = "https://api.twzrd.xyz/v1/signals/momentum";
const PREMIUM_API_URL = "https://api.twzrd.xyz/v1/signals/momentum/premium";
const DEFAULT_REFRESH_MS = 300_000; // 5 minutes
const DEFAULT_TIMEOUT_MS = 10_000;

let cache = new Map<string, VelocitySignal>();
let cacheUpdatedAt: number = 0;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Normalize model names for fuzzy matching.
 * "Qwen/Qwen3.5-9B" → "qwen/qwen3.5-9b"
 * "qwen/qwen3.5-9b" → "qwen/qwen3.5-9b"
 */
function normalize(name: string): string {
  return name.toLowerCase().trim();
}

/**
 * Extract the short slug from a model ID.
 * "Qwen/Qwen3.5-9B" → "qwen3.5-9b"
 * "meta-llama/Llama-3.3-70B-Instruct" → "llama-3.3-70b-instruct"
 */
function slug(name: string): string {
  const parts = name.toLowerCase().split("/");
  return parts[parts.length - 1];
}

/**
 * Generate fuzzy key: strip dots, version seps, common suffixes.
 * "gemini-2.5-flash" → "gemini-2-5-flash"
 * "deepseek-chat" → "deepseek-chat"
 * "deepseek-v3.2" → "deepseek-v3-2"
 */
function fuzzyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\./g, "-")       // dots → dashes (gemini-2.5 → gemini-2-5)
    .replace(/-instruct$/g, "") // strip -instruct suffix
    .replace(/-chat$/g, "")     // strip -chat suffix
    .trim();
}

/**
 * ClawRouter→WZRD model alias map.
 * ClawRouter uses provider-prefixed names; WZRD tracks by platform name.
 * These are the most common ClawRouter models that don't fuzzy-match.
 */
const CLAWROUTER_ALIASES: Record<string, string[]> = {
  // ClawRouter name → WZRD signal names to try (multiple platforms)
  "google/gemini-2.5-flash": ["gemini-2-5-flash", "google/gemini-2.5-flash-preview"],
  "google/gemini-2.5-pro": ["gemini-2-5-pro", "google/gemini-2.5-pro-preview"],
  "google/gemini-3-pro-preview": ["google/gemini-3.1-pro-preview"],
  "deepseek/deepseek-chat": ["deepseek-v3-2", "deepseek/deepseek-v3.2"],
  "deepseek/deepseek-reasoner": ["deepseek/deepseek-r1"],
  "openai/gpt-4o": ["gpt-4o"],
  "openai/gpt-4o-mini": ["gpt-4o-mini"],
  "openai/gpt-5.2": ["gpt-5-4"],
  "openai/gpt-5-mini": ["openai/gpt-5.4-mini"],
  "openai/gpt-5-nano": ["openai/gpt-5.4-nano"],
  "anthropic/claude-sonnet-4": ["claude-sonnet-4-6", "anthropic/claude-sonnet-4.6"],
  "anthropic/claude-sonnet-4.6": ["claude-sonnet-4-6", "anthropic/claude-sonnet-4.6"],
  "claude-sonnet-4-20250514": ["claude-sonnet-4-6", "anthropic/claude-sonnet-4.6"],
  "claude-opus-4-20250514": ["claude-opus-4-6", "anthropic/claude-opus-4.6"],
  "anthropic/claude-opus-4": ["claude-opus-4-6", "anthropic/claude-opus-4.6"],
  "anthropic/claude-opus-4.5": ["claude-opus-4-6"],
  "anthropic/claude-opus-4.6": ["claude-opus-4-6"],
  "moonshot/kimi-k2.5": ["moonshotai/kimi-k2.5", "moonshotai/Kimi-K2.5"],
  "nvidia/kimi-k2.5": ["moonshotai/kimi-k2.5", "moonshotai/Kimi-K2.5"],
  "xai/grok-4-fast-reasoning": ["grok-4-1-fast", "x-ai/grok-4.1-fast"],
  "xai/grok-4-1-fast-reasoning": ["grok-4-1-fast", "x-ai/grok-4.1-fast"],
  "xai/grok-4-fast-non-reasoning": ["x-ai/grok-4.20-beta"],
  "xai/grok-3": ["x-ai/grok-4.20-multi-agent-beta"],
  "xai/grok-code-fast-1": ["x-ai/grok-4.20-beta"],
  "mistralai/mistral-small-3.1-24b-instruct": ["mistralai/mistral-small-2603"],
  "nvidia/gpt-oss-120b": ["nvidia/nemotron-3-super-120b-a12b", "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8"],
};

async function fetchFromUrl(url: string): Promise<VelocitySignal[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${url}?limit=200`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as MomentumResponse;
    return (data.models ?? []).map((m) => ({
      model: m.model,
      score: m.score ?? 0,
      trend: m.trend ?? "insufficient_history",
      action: m.action ?? "observe",
      confidence: m.confidence ?? "insufficient",
      platform: m.platform ?? "",
      velocity_ema: m.velocity_ema,
      accel: m.accel,
      quality_index: m.quality_index,
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSignals(apiUrl: string): Promise<VelocitySignal[]> {
  // Try premium first (has velocity_ema, accel, quality_index)
  // Fall back to base endpoint if premium returns 402/403
  const premiumUrl = apiUrl.endsWith("/premium") ? apiUrl : `${apiUrl}/premium`;
  const signals = await fetchFromUrl(premiumUrl);
  if (signals.length > 0) return signals;

  // Fallback to base endpoint (always works, fewer fields)
  const baseUrl = apiUrl.replace(/\/premium$/, "");
  return fetchFromUrl(baseUrl);
}

async function refresh(apiUrl: string): Promise<void> {
  const signals = await fetchSignals(apiUrl);
  if (signals.length === 0 && cache.size > 0) {
    // Keep stale cache over empty — stale-while-revalidate
    return;
  }
  const next = new Map<string, VelocitySignal>();
  for (const signal of signals) {
    // Index by normalized full name
    next.set(normalize(signal.model), signal);
    // Also index by slug for fuzzy lookup
    next.set(slug(signal.model), signal);
    // Also index by fuzzy key (dots→dashes, strip suffixes)
    next.set(fuzzyKey(signal.model), signal);
    next.set(fuzzyKey(slug(signal.model)), signal);
  }
  cache = next;
  cacheUpdatedAt = Date.now();
}

/**
 * Get the velocity score (0.0–1.0) for a model.
 * Returns 0.5 (neutral) if the model is not tracked.
 */
export function getVelocityScore(modelId: string): number {
  const signal = getVelocitySignal(modelId);
  return signal?.score ?? 0.5;
}

/**
 * Get the full velocity signal for a model, or null if not tracked.
 * Match cascade: exact → slug → fuzzy key → ClawRouter alias → null.
 */
export function getVelocitySignal(modelId: string): VelocitySignal | null {
  // 1. Exact normalized match
  const exact = cache.get(normalize(modelId));
  if (exact) return exact;

  // 2. Slug match (last segment after /)
  const slugMatch = cache.get(slug(modelId));
  if (slugMatch) return slugMatch;

  // 3. Fuzzy key match (dots→dashes, strip suffixes)
  const fk = fuzzyKey(slug(modelId));
  const fuzzyMatch = cache.get(fk);
  if (fuzzyMatch) return fuzzyMatch;

  // 4. ClawRouter alias table
  const aliases = CLAWROUTER_ALIASES[normalize(modelId)];
  if (aliases) {
    for (const alias of aliases) {
      const m = cache.get(normalize(alias)) ?? cache.get(slug(alias)) ?? cache.get(fuzzyKey(alias));
      if (m) return m;
    }
  }

  return null;
}

/**
 * Get cache age in milliseconds. Returns Infinity if cache is empty.
 */
export function getCacheAge(): number {
  return cacheUpdatedAt > 0 ? Date.now() - cacheUpdatedAt : Infinity;
}

/**
 * Get the number of models in the cache.
 */
export function getCacheSize(): number {
  // Each model has two entries (full name + slug), so divide by ~2
  // But some slugs may collide, so use a Set of models
  const models = new Set<string>();
  for (const signal of cache.values()) {
    models.add(signal.model);
  }
  return models.size;
}

/**
 * Start the background cache refresh. Call once on startup.
 * Immediately fetches data, then refreshes on interval.
 */
export async function startCache(
  apiUrl: string = DEFAULT_API_URL,
  refreshMs: number = DEFAULT_REFRESH_MS
): Promise<void> {
  await refresh(apiUrl);
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => refresh(apiUrl), refreshMs);
}

/**
 * Stop the background cache refresh.
 */
export function stopCache(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

/**
 * Force a cache refresh. Returns when the refresh completes.
 */
export async function refreshCache(
  apiUrl: string = DEFAULT_API_URL
): Promise<void> {
  await refresh(apiUrl);
}
