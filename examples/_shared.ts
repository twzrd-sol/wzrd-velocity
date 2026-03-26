import { readFileSync } from 'node:fs';

import {
  Connection,
  Keypair,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadKeypairFromFile(filePath: string): Keypair {
  const secretKey = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!Array.isArray(secretKey)) {
    throw new Error(`Keypair file must be a JSON array: ${filePath}`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

export async function sendInstructions(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const transaction = new VersionedTransaction(message);
  transaction.sign([payer]);

  const signature = await connection.sendTransaction(transaction, { maxRetries: 3 });
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  return signature;
}
