/**
 * Deterministic parity test: ClawRouter scorer vs the real LiteLLM WZRD plugin.
 *
 * Run: node test/plugin-parity.test.mjs
 */

import assert from "node:assert/strict";

import { rankByVelocity, refreshCache, scoreModelVelocity } from "../dist/index.js";
import {
  CANDIDATES,
  clawAliasOrder,
  scoreWithPlugin,
} from "./plugin-bridge.mjs";

async function run() {
  console.log("=== ClawRouter × LiteLLM Plugin Parity Test ===\n");

  const payload = {
    contract_version: "test",
    generated_at: "2026-03-23T00:00:00.000Z",
    count: 4,
    models: [
      {
        model: "Qwen/Qwen3.5-9B",
        score: 0.91,
        trend: "surging",
        action: "pre_warm",
        confidence: "normal",
        platform: "openrouter",
        quality_index: 82,
      },
      {
        model: "Qwen/Qwen3.5-35B-A3B",
        score: 0.74,
        trend: "accelerating",
        action: "pre_warm",
        confidence: "normal",
        platform: "openrouter",
        quality_index: 76,
      },
      {
        model: "meta-llama/Llama-3.3-70B-Instruct",
        score: 0.58,
        trend: "stable",
        action: "observe",
        confidence: "normal",
        platform: "openrouter",
      },
      {
        model: "moonshotai/Kimi-K2.5",
        score: 0.99,
        trend: "cooling",
        action: "consider_deprovision",
        confidence: "normal",
        platform: "openrouter",
      },
    ],
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  try {
    console.log("1. Refreshing ClawRouter cache from shared injected payload...");
    await refreshCache("https://mocked.example/v1/signals/momentum/premium");
    console.log("   PASS: cache refreshed\n");

    console.log("2. Scoring identical candidate set through the real LiteLLM plugin...");
    const plugin = await scoreWithPlugin({ payload });
    const pluginOrder = plugin.ranking.map((entry) => entry.model_name);
    assert.equal(plugin.selected_model_name, "qwen-9b");
    console.log(`   PASS: plugin winner=${plugin.selected_model_name}\n`);

    console.log("3. Scoring the same candidate set through the ClawRouter dimension...");
    const clawRanked = rankByVelocity(CANDIDATES.map((candidate) => candidate.wzrdModel));
    const clawOrder = clawAliasOrder(clawRanked.map((entry) => entry.modelId));
    const qwen = scoreModelVelocity("Qwen/Qwen3.5-9B");
    const gemma = scoreModelVelocity("google/gemma-3-27b-it");
    const kimi = scoreModelVelocity("moonshotai/Kimi-K2.5");

    assert.equal(clawOrder[0], "qwen-9b");
    assert.equal(gemma.score, 0, "expected untracked gemma to stay neutral");
    assert.ok(qwen.score > 0, "surging qwen should score positive");
    assert.ok(kimi.score < 0, "cooling kimi should score negative");
    console.log(`   PASS: claw winner=${clawOrder[0]}\n`);

    console.log("4. Comparing order between both implementations...");
    assert.deepEqual(
      clawOrder,
      pluginOrder,
      "expected both implementations to produce the same ranking for the shared mock payload"
    );
    console.log(`   PASS: shared order = ${clawOrder.join(" > ")}\n`);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("=== PARITY TEST PASSED ===");
}

run().catch((error) => {
  console.error("Parity test failed:", error);
  process.exit(1);
});
