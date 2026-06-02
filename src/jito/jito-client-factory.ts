import type { AppConfig } from '../config.js';
import { logger } from '../logger.js';
import type { JitoBundleClient } from './jito-bundle-client.js';
import { JitoJsonRpcClient } from './jito-jsonrpc-client.js';

/**
 * Build the configured Jito transport. Defaults to the official jito-ts gRPC SDK; if it cannot
 * be initialised (e.g. proto/native issues in a constrained environment) it transparently falls
 * back to the JSON-RPC transport so a live evidence run is never blocked.
 */
export async function createJitoClient(config: AppConfig): Promise<JitoBundleClient> {
  if (config.JITO_TRANSPORT === 'jsonrpc') {
    return new JitoJsonRpcClient(config);
  }
  try {
    const { JitoGrpcClient } = await import('./jito-grpc-client.js');
    return new JitoGrpcClient(config);
  } catch (error) {
    logger.warn({ error }, 'Jito gRPC client unavailable; falling back to JSON-RPC transport.');
    return new JitoJsonRpcClient(config);
  }
}
