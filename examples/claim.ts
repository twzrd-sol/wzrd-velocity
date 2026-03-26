/**
 * claim.ts — Claim CCM rewards via merkle proof.
 *
 * Usage:
 *   SOLANA_RPC_URL=https://api.mainnet-beta.solana.com \
 *   WZRD_KEYPAIR_PATH=~/.config/solana/id.json \
 *   npx tsx sdk/examples/claim.ts
 *
 * Flow:
 *   1. Fetch merkle proof from the server API
 *   2. Build claim_global instruction via @wzrd_sol/sdk
 *   3. Sign and submit transaction
 */

import { ComputeBudgetProgram, Connection } from '@solana/web3.js';
import { createClaimGlobalV2Ix } from '../src/index.js';
import { loadKeypairFromFile, requireEnv, sendInstructions } from './_shared.js';

const RPC_URL = process.env.SOLANA_RPC_URL ?? '';
const API_BASE = process.env.API_BASE ?? 'https://api.twzrd.xyz';

interface ClaimProof {
  root_seq: number;
  base_yield: number;
  attention_bonus: number;
  leaf_index: number;
  proof: string[];
}

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const wallet = loadKeypairFromFile(requireEnv('WZRD_KEYPAIR_PATH'));
  const pubkey = wallet.publicKey.toBase58();

  console.log(`Wallet: ${pubkey}`);

  // Step 1: Fetch merkle proof from server
  // Note: this endpoint requires SIWS session auth in production.
  // For headless agents, use the gasless relay (POST /v1/claims/:pubkey/relay) instead.
  console.log('Fetching merkle proof...');
  const res = await fetch(`${API_BASE}/v1/claims/${pubkey}`);
  if (!res.ok) {
    const text = await res.text();
    console.error(`Claim proof fetch failed (${res.status}): ${text}`);
    if (res.status === 401) {
      console.error('This endpoint requires SIWS auth. For headless agents, use the gasless relay.');
    }
    process.exit(1);
  }

  const proof: ClaimProof = await res.json();
  const cumulativeTotal = proof.base_yield + proof.attention_bonus;
  console.log(`Root seq:    ${proof.root_seq}`);
  console.log(`Base yield:  ${proof.base_yield} CCM (native)`);
  console.log(`Bonus:       ${proof.attention_bonus} CCM (native)`);
  console.log(`Cumulative:  ${cumulativeTotal} CCM (native)`);
  console.log(`Proof nodes: ${proof.proof.length}`);

  if (cumulativeTotal === 0) {
    console.log('Nothing to claim.');
    process.exit(0);
  }

  // Step 2: Build claim instruction
  const ixs = await createClaimGlobalV2Ix(
    connection,
    wallet.publicKey,
    proof.root_seq,
    BigInt(proof.base_yield),
    BigInt(proof.attention_bonus),
    proof.proof,
  );

  ixs.unshift(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
  );

  console.log('Sending claim transaction...');
  const sig = await sendInstructions(connection, wallet, ixs);
  console.log(`Signature: ${sig}`);

  console.log('Claim confirmed. CCM deposited to your wallet.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
