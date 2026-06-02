import fs from 'node:fs';
import { Keypair } from '@solana/web3.js';

export function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!Array.isArray(raw)) throw new Error(`Expected Solana keypair JSON array at ${path}`);
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}
