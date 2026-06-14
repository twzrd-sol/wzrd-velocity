/**
 * CommonJS require() smoke test.
 *
 * Regression guard for the broken CJS wrapper shipped through 0.1.3, where the
 * dist/index.cjs Proxy turned every synchronous export into a Promise. A
 * ClawRouter consumer doing `require("@wzrd_sol/clawrouter-velocity")` then got
 * `Promise { <pending> }` where it expected a dimension object / number, and
 * silently added it to its weighted routing sum as NaN.
 *
 * This test require()s the built bundle and asserts the synchronous contract:
 * scoring functions return real values, not Promises.
 *
 * Run: npm run build && node test/cjs-require.test.cjs
 */

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const distCjs = path.join(__dirname, "..", "dist", "index.cjs");
assert.ok(
  fs.existsSync(distCjs),
  `dist/index.cjs missing — run "npm run build" first (looked at ${distCjs})`
);

const v = require(distCjs);

console.log("=== WZRD × ClawRouter CJS require() Test ===\n");

console.log("1. scoreModelVelocity returns a synchronous dimension object...");
const dim = v.scoreModelVelocity("qwen/qwen3.5-9b");
assert.ok(!(dim instanceof Promise), "scoreModelVelocity must not return a Promise from require()");
assert.equal(typeof dim, "object", "scoreModelVelocity must return an object");
assert.equal(dim.name, "modelVelocity", "dimension name must be modelVelocity");
assert.equal(typeof dim.score, "number", "dimension score must be a number");
assert.equal(typeof dim.weight, "number", "dimension weight must be a number");
console.log(`   PASS: { name: ${dim.name}, score: ${dim.score}, weight: ${dim.weight} }\n`);

console.log("2. getVelocityScore returns a number (not a Promise)...");
const score = v.getVelocityScore("qwen/qwen3.5-9b");
assert.ok(!(score instanceof Promise), "getVelocityScore must not return a Promise from require()");
assert.equal(typeof score, "number", "getVelocityScore must return a number");
console.log(`   PASS: ${score}\n`);

console.log("3. rankByVelocity returns an array synchronously...");
const ranked = v.rankByVelocity(["meta-llama/Llama-3.3-70B-Instruct", "qwen/qwen3.5-9b"]);
assert.ok(Array.isArray(ranked), "rankByVelocity must return an array from require()");
assert.equal(ranked.length, 2, "rankByVelocity must score every input model");
console.log(`   PASS: ranked ${ranked.length} models\n`);

console.log("4. async cache functions are still functions returning Promises...");
assert.equal(typeof v.startCache, "function", "startCache must be exported");
assert.equal(typeof v.stopCache, "function", "stopCache must be exported");
const refreshResult = v.refreshCache("http://127.0.0.1:1/never");
assert.ok(refreshResult instanceof Promise, "refreshCache must return a Promise");
refreshResult.catch(() => {}); // swallow the expected network failure
console.log("   PASS: startCache/stopCache/refreshCache exported with correct shapes\n");

console.log("=== CJS require() SMOKE TEST PASSED ===");
