/**
 * Live comparison: ClawRouter scorer vs the real LiteLLM WZRD plugin.
 *
 * Run: node test/live-plugin-compare.mjs
 */

import { rankByVelocity, refreshCache, scoreModelVelocity } from "../dist/index.js";
import {
  CANDIDATES,
  DEFAULT_PREMIUM_URL,
  clawAliasOrder,
  scoreWithPlugin,
} from "./plugin-bridge.mjs";

async function run() {
  console.log("=== Live ClawRouter × LiteLLM Plugin Comparison ===\n");
  console.log(`Feed: ${DEFAULT_PREMIUM_URL}\n`);

  let preflight = null;
  try {
    const response = await fetch(`${DEFAULT_PREMIUM_URL}?limit=1`, {
      headers: { Accept: "application/json" },
    });
    const body = await response.json();
    preflight = {
      ok: response.ok,
      status: response.status,
      count: body?.count ?? null,
      sample: body?.models?.[0]?.model ?? null,
    };
  } catch (error) {
    preflight = {
      ok: false,
      status: null,
      count: null,
      sample: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  console.log("Feed preflight:");
  if (preflight.ok) {
    console.log(`  status=${preflight.status} count=${preflight.count} sample=${preflight.sample ?? "n/a"}`);
  } else {
    console.log(`  unavailable (${preflight.error ?? `status=${preflight.status}`})`);
  }
  console.log();

  await refreshCache(DEFAULT_PREMIUM_URL);
  const plugin = await scoreWithPlugin(DEFAULT_PREMIUM_URL);

  const clawRanked = rankByVelocity(CANDIDATES.map((candidate) => candidate.wzrdModel));
  const clawOrder = clawAliasOrder(clawRanked.map((entry) => entry.modelId));
  const clawTracked = CANDIDATES.filter((candidate) => scoreModelVelocity(candidate.wzrdModel).wzrd).length;
  const pluginTracked = plugin.ranking.filter((entry) => entry.matched_signal).length;

  console.log("ClawRouter dimension ranking:");
  for (const entry of clawRanked) {
    const alias = clawAliasOrder([entry.modelId])[0];
    console.log(
      `  ${alias.padEnd(12)} score=${entry.score >= 0 ? "+" : ""}${entry.score.toFixed(3)} signal=${entry.signal}`
    );
  }
  console.log();

  console.log("LiteLLM plugin ranking:");
  for (const entry of plugin.ranking) {
    console.log(
      `  ${entry.model_name.padEnd(12)} score=${entry.score >= 0 ? "+" : ""}${entry.score.toFixed(3)} trend=${entry.trend ?? "no-signal"}`
    );
  }
  console.log();

  console.log(`ClawRouter winner: ${clawOrder[0]}`);
  console.log(`LiteLLM winner:   ${plugin.selected_model_name}`);
  console.log(`Tracked models:   ClawRouter=${clawTracked} LiteLLM=${pluginTracked}`);
  if (!preflight.ok || (clawTracked === 0 && pluginTracked === 0)) {
    console.log("Note: this run fell back to no-signal routing; the real feed was unavailable or unmatched.");
  }
}

run().catch((error) => {
  console.error("Live comparison failed:", error);
  process.exit(1);
});
