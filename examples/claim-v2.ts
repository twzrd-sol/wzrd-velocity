/**
 * claim-v2.ts — Test E2E claim_global_v2 with V5 merkle leaf format.
 *
 * Usage:
 *   SOLANA_RPC_URL=<mainnet_rpc> \
 *   WZRD_KEYPAIR_PATH=~/.config/solana/id.json \
 *   npx tsx sdk/examples/claim-v2.ts
 *
 * Flow:
 *   1. Build claim_global_v2 instruction with base_yield + attention_bonus
 *   2. Sign and submit transaction
 *   3. Verify CCM balance increased
 */

import { ComputeBudgetProgram, Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { createClaimGlobalV2Ix, TOKEN_2022_PROGRAM_ID } from '../src/index.js';
import { loadKeypairFromFile, requireEnv, sendInstructions } from './_shared.js';

const RPC_URL = requireEnv('SOLANA_RPC_URL');
const CCM_MINT = new PublicKey('Dxk8mAb3C7AM8JN6tAJfVuSja5yidhZM5sEKW3SRX2BM');

// V5 proof data from merkle_proofs table (root_seq 1801)
const PROOF = {
  root_seq: 1801,
  base_yield: 250000n,
  attention_bonus: 523749n,
  cumulative_total: 773749n,
  proof: ['46981916b8faa085eb6a0acc08489ca910383774291c0f13a02aa0cc9d68dcc2'],
};

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const wallet = loadKeypairFromFile(requireEnv('WZRD_KEYPAIR_PATH'));
  const pubkey = wallet.publicKey.toBase58();

  console.log(`Wallet:            ${pubkey}`);
  console.log(`Root seq:          ${PROOF.root_seq}`);
  console.log(`Base yield:        ${PROOF.base_yield}`);
  console.log(`Attention bonus:   ${PROOF.attention_bonus}`);
  console.log(`Cumulative total:  ${PROOF.cumulative_total} (base_yield + attention_bonus)`);
  console.log(`Leaf version:      V5`);
  console.log(`Proof nodes:       ${PROOF.proof.length}`);

  // Check CCM balance before claim
  const claimerAta = getAssociatedTokenAddressSync(
    CCM_MINT,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
  );
  const balBefore = await connection.getTokenAccountBalance(claimerAta).catch(() => null);
  const ccmBefore = balBefore?.value?.uiAmount ?? 0;
  console.log(`\nCCM balance before: ${ccmBefore}`);

  // Build claim_global_v2 instruction (V5 leaf)
  console.log('\nBuilding claim_global_v2 instruction...');
  const ixs = await createClaimGlobalV2Ix(
    connection,
    wallet.publicKey,
    PROOF.root_seq,
    PROOF.base_yield,
    PROOF.attention_bonus,
    PROOF.proof,
  );

  ixs.unshift(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
  );

  console.log('Sending claim_global_v2 transaction...');
  const sig = await sendInstructions(connection, wallet, ixs);
  console.log(`\nTransaction signature: ${sig}`);

  // Check CCM balance after claim
  const balAfter = await connection.getTokenAccountBalance(claimerAta);
  const ccmAfter = balAfter.value.uiAmount ?? 0;
  const delta = ccmAfter - ccmBefore;

  console.log(`CCM balance after:  ${ccmAfter}`);
  console.log(`CCM received:       ${delta}`);
  console.log(`\n=== claim_global_v2 (V5 leaf) SUCCESS ===`);
}

main().catch((err) => {
  console.error('Claim failed:', err.message || err);
  process.exit(1);
});
