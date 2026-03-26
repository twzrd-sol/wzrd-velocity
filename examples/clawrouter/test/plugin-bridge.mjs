import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const CANDIDATES = [
  {
    alias: "qwen-9b",
    litellmModel: "openrouter/qwen/qwen-3.5-9b",
    wzrdModel: "Qwen/Qwen3.5-9B",
  },
  {
    alias: "qwen-35b",
    litellmModel: "openrouter/qwen/qwen-3.5-35b-a3b",
    wzrdModel: "Qwen/Qwen3.5-35B-A3B",
  },
  {
    alias: "llama-70b",
    litellmModel: "openrouter/meta-llama/llama-3.3-70b-instruct",
    wzrdModel: "meta-llama/Llama-3.3-70B-Instruct",
  },
  {
    alias: "gemma-27b",
    litellmModel: "openrouter/google/gemma-3-27b-it",
    wzrdModel: "google/gemma-3-27b-it",
  },
  {
    alias: "kimi-k2",
    litellmModel: "openrouter/moonshotai/kimi-k2.5",
    wzrdModel: "moonshotai/Kimi-K2.5",
  },
];

export const DEFAULT_PREMIUM_URL = "https://api.twzrd.xyz/v1/signals/momentum/premium";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PY_BRIDGE = path.join(__dirname, "plugin-bridge.py");

export function buildAliasMap() {
  return Object.fromEntries(CANDIDATES.map((candidate) => [candidate.alias, [candidate.wzrdModel]]));
}

export function buildDeployments() {
  return CANDIDATES.map((candidate, index) => ({
    model_name: candidate.alias,
    litellm_params: { model: candidate.litellmModel },
    model_info: { id: String(index + 1) },
  }));
}

export function clawAliasOrder(modelIds) {
  const byModel = new Map(CANDIDATES.map((candidate) => [candidate.wzrdModel, candidate.alias]));
  return modelIds.map((modelId) => byModel.get(modelId) ?? modelId);
}

export async function scoreWithPlugin({ wzrdUrl = DEFAULT_PREMIUM_URL, payload = null } = {}) {
  const args = [
    PY_BRIDGE,
    "--wzrd-url",
    wzrdUrl,
    "--deployments-json",
    JSON.stringify(buildDeployments()),
    "--alias-map-json",
    JSON.stringify(buildAliasMap()),
    "--model",
    "all-models",
  ];

  if (payload) {
    args.push("--payload-json", JSON.stringify(payload));
  }

  const { stdout } = await execFileAsync("python3", args);

  return JSON.parse(stdout);
}
