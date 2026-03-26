/**
 * deposit.ts — Deposit USDC into a WZRD attention market.
 *
 * Usage:
 *   SOLANA_RPC_URL=https://api.mainnet-beta.solana.com \
 *   WZRD_KEYPAIR_PATH=~/.config/solana/id.json \
 *   WZRD_MARKET_ID=6 \
 *   WZRD_DEPOSIT_USDC=1 \
 *   npx tsx sdk/examples/deposit.ts
 */

import { ComputeBudgetProgram, Connection } from '@solana/web3.js';
import { createDepositMarketIx, fetchMarketVault } from '../src/index.js';
import { loadKeypairFromFile, requireEnv, sendInstructions } from './_shared.js';

const RPC_URL = process.env.SOLANA_RPC_URL ?? '';

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const wallet = loadKeypairFromFile(requireEnv('WZRD_KEYPAIR_PATH'));
  const marketId = Number.parseInt(requireEnv('WZRD_MARKET_ID'), 10);
  const amountUsdc = Number.parseFloat(requireEnv('WZRD_DEPOSIT_USDC'));
  const amountNative = BigInt(Math.round(amountUsdc * 1_000_000)); // USDC has 6 decimals

  if (!Number.isSafeInteger(marketId) || marketId < 0) {
    throw new Error(`Invalid WZRD_MARKET_ID: ${marketId}`);
  }
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
    throw new Error(`Invalid WZRD_DEPOSIT_USDC: ${amountUsdc}`);
  }

  console.log(`Wallet:    ${wallet.publicKey.toBase58()}`);
  console.log(`Market:    ${marketId}`);
  console.log(`Amount:    ${amountUsdc} USDC (${amountNative} native)`);

  // Verify vault exists
  const vault = await fetchMarketVault(connection, marketId);
  if (!vault) {
    console.error(`Market ${marketId} vault not found on-chain`);
    process.exit(1);
  }
  console.log(`Vault TVL: ${vault.totalDeposited} native USDC`);

  // Build deposit instructions
  const ixs = await createDepositMarketIx(connection, wallet.publicKey, marketId, amountNative);

  // Prepend compute budget for priority fees
  ixs.unshift(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
  );

  console.log('Sending transaction...');
  const sig = await sendInstructions(connection, wallet, ixs);
  console.log(`Signature: ${sig}`);

  console.log('Deposit confirmed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
