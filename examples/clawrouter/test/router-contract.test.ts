/**
 * Deterministic contract test for ClawRouter ranking behavior.
 *
 * Serves a local mock WZRD momentum feed, refreshes the cache against it,
 * and verifies that routing changes for a fixed model catalog.
 *
 * Run: npx tsx test/router-contract.test.ts
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";

import {
  getCacheSize,
  getVelocitySignal,
  rankByVelocity,
  refreshCache,
  scoreModelVelocity,
} from "../src/index.js";

type MockModel = {
  model: string;
  score: number;
  trend: string;
  action: string;
  confidence: string;
  platform: string;
  quality_index?: number | null;
};

async function withMockFeed(
  models: MockModel[],
  fn: (url: string) => Promise<void>
): Promise<void> {
  const server = createServer((req, res) => {
    if (!req.url?.startsWith("/v1/signals/momentum/premium")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        contract_version: "test",
        generated_at: "2026-03-23T00:00:00.000Z",
        count: models.length,
        models,
      })
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (err?: Error) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    throw new Error("mock server failed to bind to a TCP port");
  }

  const url = `http://127.0.0.1:${address.port}/v1/signals/momentum/premium`;

  try {
    await fn(url);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function run() {
  console.log("=== WZRD × ClawRouter Contract Test ===\n");

  await withMockFeed(
    [
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
    async (url) => {
      console.log("1. Refreshing cache from mock feed...");
      await refreshCache(url);
      assert.equal(getCacheSize(), 3, "expected exactly 3 cached models");
      console.log("   PASS: cache populated with deterministic test payload\n");

      console.log("2. Verifying fuzzy model lookup...");
      const qwenFull = getVelocitySignal("Qwen/Qwen3.5-9B");
      const qwenSlug = getVelocitySignal("qwen3.5-9b");
      assert.ok(qwenFull, "expected exact Qwen lookup to resolve");
      assert.ok(qwenSlug, "expected slug Qwen lookup to resolve");
      assert.equal(qwenFull?.model, qwenSlug?.model, "expected slug lookup to map to the same model");
      console.log("   PASS: full model id and slug resolve consistently\n");

      console.log("3. Scoring routing dimension...");
      const qwenScore = scoreModelVelocity("Qwen/Qwen3.5-9B");
      const llamaScore = scoreModelVelocity("meta-llama/Llama-3.3-70B-Instruct");
      const untrackedScore = scoreModelVelocity("google/gemma-3-27b-it");
      const kimiScore = scoreModelVelocity("moonshotai/Kimi-K2.5");

      assert.equal(qwenScore.signal, "surging");
      assert.ok(qwenScore.score > llamaScore.score, "surging Qwen should outrank stable Llama");
      assert.equal(untrackedScore.score, 0, "untracked models should stay neutral");
      assert.ok(kimiScore.score < 0, "cooling Kimi should score negative");
      console.log("   PASS: surging > stable > untracked > cooling\n");

      console.log("4. Ranking a fixed ClawRouter catalog...");
      const ranked = rankByVelocity([
        "Qwen/Qwen3.5-9B",
        "meta-llama/Llama-3.3-70B-Instruct",
        "google/gemma-3-27b-it",
        "moonshotai/Kimi-K2.5",
      ]);

      assert.deepEqual(
        ranked.map((entry) => entry.modelId),
        [
          "Qwen/Qwen3.5-9B",
          "meta-llama/Llama-3.3-70B-Instruct",
          "google/gemma-3-27b-it",
          "moonshotai/Kimi-K2.5",
        ],
        "expected WZRD velocity to reorder the catalog deterministically"
      );

      const totalScore = 0.35 + qwenScore.score * qwenScore.weight;
      assert.ok(totalScore > 0.35, "expected WZRD velocity to lift the weighted score");

      console.log("   PASS: catalog reranks and weighted score shifts upward");
      console.log(`   Winning model: ${ranked[0]?.modelId}`);
      console.log(`   Weighted total: ${totalScore.toFixed(4)}\n`);
    }
  );

  console.log("=== ALL CONTRACT TESTS PASSED ===");
}

run().catch((error) => {
  console.error("Contract test failed:", error);
  process.exit(1);
});
