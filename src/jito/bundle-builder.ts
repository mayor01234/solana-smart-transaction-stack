import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import type { BundleBuildResult } from '../types.js';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

export interface BuildBundleArgs {
  payer: Keypair;
  memo: string;
  blockhash: string;
  lastValidBlockHeight: number;
  tipLamports: number;
  tipAccount: string;
  computeUnitPriceMicroLamports?: number;
  faultComputeExceeded?: boolean;
}

export class BundleBuilder {
  buildDemoBundle(args: BuildBundleArgs): BundleBuildResult {
    const instructions: TransactionInstruction[] = [];

    instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: args.faultComputeExceeded ? 1 : 200_000 }));

    if (args.computeUnitPriceMicroLamports && args.computeUnitPriceMicroLamports > 0) {
      instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: args.computeUnitPriceMicroLamports }));
    }

    instructions.push(
      new TransactionInstruction({
        programId: MEMO_PROGRAM_ID,
        keys: [],
        data: Buffer.from(args.memo, 'utf8'),
      }),
    );

    // Jito tip instruction. The amount is decided upstream by the AI tip agent using live tip data.
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: args.payer.publicKey,
        toPubkey: new PublicKey(args.tipAccount),
        lamports: args.tipLamports,
      }),
    );

    const message = new TransactionMessage({
      payerKey: args.payer.publicKey,
      recentBlockhash: args.blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    tx.sign([args.payer]);

    return {
      serializedTransactions: [Buffer.from(tx.serialize()).toString('base64')],
      signatures: [bs58.encode(Buffer.from(tx.signatures[0]!))],
      tipLamports: args.tipLamports,
      tipAccount: args.tipAccount,
      recentBlockhash: args.blockhash,
      lastValidBlockHeight: args.lastValidBlockHeight,
    };
  }
}
