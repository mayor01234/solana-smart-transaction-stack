import pkg, { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import type { AppConfig } from '../config.js';

// @triton-one/yellowstone-grpc ships CommonJS. Under NodeNext ESM the client class is exposed on
// the default import's `.default`; this guard handles both interop shapes.
const Client = ((pkg as any)?.default ?? pkg) as any;
export type YellowstoneClient = InstanceType<typeof Client>;

export function commitmentToYellowstone(commitment: string): CommitmentLevel {
  switch (commitment) {
    case 'finalized':
      return CommitmentLevel.FINALIZED;
    case 'confirmed':
      return CommitmentLevel.CONFIRMED;
    default:
      return CommitmentLevel.PROCESSED;
  }
}

export class YellowstoneClientFactory {
  constructor(private readonly config: AppConfig) {}

  create(): YellowstoneClient {
    return new Client(this.config.YELLOWSTONE_GRPC_URL, this.config.YELLOWSTONE_TOKEN, undefined);
  }

  baseSubscribeRequest(): any {
    return {
      accounts: {},
      slots: {},
      transactions: {},
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      accountsDataSlice: [],
      commitment: commitmentToYellowstone(this.config.YELLOWSTONE_COMMITMENT),
    };
  }
}
