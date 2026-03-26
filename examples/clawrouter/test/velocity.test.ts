/**
 * Integration test — hits the live WZRD API, verifies cache + scoring.
 *
 * Run: npx tsx test/velocity.test.ts
 */

import {
  startCache,
  stopCache,
  getCacheSize,
  getCacheAge,
  getVelocityScore,
  getVelocitySignal,
  scoreModelVelocity,
  rankByVelocity,
} from "../src/index.js";

async function run() {
  console.log("=== WZRD × ClawRouter Integration Test ===\n");

  // 1. Start cache — hits live API
  console.log("1. Starting cache (live API fetch)...");
  await startCache();
  const size = getCacheSize();
  const age = getCacheAge();
  console.log(`   Cache: ${size} models, ${age}ms old`);
  if (size === 0) {
    console.error("   FAIL: cache is empty — API may be down");
    process.exit(1);
  }
  console.log(`   PASS: ${size} models cached\n`);

  // 2. Test known model lookups
  console.log("2. Model lookups...");
  const testModels = [
    "Qwen/Qwen3.5-9B",           // HuggingFace style
    "qwen/qwen3.5-9b",           // lowercase
    "qwen3.5-9b",                // slug only
    "meta-llama/Llama-3.3-70B-Instruct",
    "moonshotai/Kimi-K2.5",
    "nonexistent/model-xyz",     // should return null
  ];

  for (const model of testModels) {
    const signal = getVelocitySignal(model);
    const score = getVelocityScore(model);
    if (signal) {
      console.log(`   ${model}`);
      console.log(`     score=${score.toFixed(3)} trend=${signal.trend} conf=${signal.confidence} platform=${signal.platform}`);
      if (signal.velocity_ema) console.log(`     velocity_ema=${signal.velocity_ema}`);
      if (signal.quality_index) console.log(`     quality_index=${signal.quality_index}`);
    } else {
      console.log(`   ${model} → not tracked (score=${score})`);
    }
  }
  console.log();

  // 3. Test ClawRouter dimension scoring
  console.log("3. ClawRouter dimension scoring...");
  const dim = scoreModelVelocity("Qwen/Qwen3.5-9B");
  console.log(`   modelVelocity for Qwen3.5-9B:`);
  console.log(`     score=${dim.score} (range: -1 to 1)`);
  console.log(`     weight=${dim.weight}`);
  console.log(`     signal=${dim.signal}`);
  if (dim.score < -1 || dim.score > 1) {
    console.error("   FAIL: score out of [-1, 1] range");
    process.exit(1);
  }
  console.log(`   PASS: score in valid range\n`);

  // 4. Test untracked model returns neutral
  console.log("4. Untracked model handling...");
  const untracked = scoreModelVelocity("nonexistent/model-xyz");
  console.log(`   untracked score=${untracked.score} signal=${untracked.signal}`);
  if (untracked.score !== 0) {
    console.error("   FAIL: untracked model should score 0 (neutral)");
    process.exit(1);
  }
  console.log(`   PASS: untracked returns neutral\n`);

  // 5. Rank a batch of models
  console.log("5. Batch ranking (simulated ClawRouter model catalog)...");
  const catalog = [
    "Qwen/Qwen3.5-9B",
    "Qwen/Qwen3.5-35B-A3B",
    "meta-llama/Llama-3.3-70B-Instruct",
    "moonshotai/Kimi-K2.5",
    "deepseek-ai/DeepSeek-V3",
    "google/gemma-3-27b-it",
  ];
  const ranked = rankByVelocity(catalog);
  console.log("   Ranked by velocity:");
  for (const r of ranked) {
    const qi = r.wzrd?.quality_index != null ? ` quality=${r.wzrd.quality_index}` : "";
    console.log(`     ${r.score > 0 ? "+" : ""}${r.score.toFixed(3)} ${r.modelId} [${r.signal}]${qi}`);
  }
  console.log();

  // 6. Verify the scoring would integrate with ClawRouter's weighted sum
  console.log("6. ClawRouter weighted sum simulation...");
  // ClawRouter existing dimensions sum to ~0.94, velocity adds 0.06
  const existingScore = 0.35; // hypothetical: "COMPLEX" tier
  const velocityContribution = dim.score * dim.weight;
  const totalScore = existingScore + velocityContribution;
  console.log(`   Existing 14-dim score: ${existingScore}`);
  console.log(`   + velocity (${dim.score.toFixed(3)} × ${dim.weight}): ${velocityContribution.toFixed(4)}`);
  console.log(`   = Total: ${totalScore.toFixed(4)}`);
  console.log(`   Tier shift: ${totalScore >= 0.5 ? "→ REASONING (upgraded)" : totalScore >= 0.3 ? "→ COMPLEX (no change)" : "→ MEDIUM (downgraded)"}`);
  console.log();

  stopCache();
  console.log("=== ALL TESTS PASSED ===");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
