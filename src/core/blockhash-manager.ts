import { Commitment, Connection } from '@solana/web3.js';
export class BlockhashManager {
  constructor(private readonly connection: Connection) {}
  async getFreshBlockhash(commitment: Commitment = 'processed') { return this.connection.getLatestBlockhash(commitment); }
  async getIntentionallyExpiredBlockhash() { return { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 0 }; }
}
