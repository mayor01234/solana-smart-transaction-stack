import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { PumpfunEventStream } from '../geyser/pumpfun-event-stream.js';

// Standalone showcase of the Yellowstone gRPC live-decode skill: stream and decode REAL pump.fun
// trade events from the chain in real time. Read-only — sends nothing. Ctrl-C to stop.
const config = loadConfig();
const stream = new PumpfunEventStream(config);
let count = 0;

stream.on('trade', (t) => {
  count += 1;
  logger.info(
    {
      n: count,
      side: t.isBuy ? 'BUY' : 'SELL',
      mint: t.mint,
      solLamports: t.solLamports,
      tokenAmount: t.tokenAmount,
      slot: t.slot,
      signature: t.signature,
    },
    'Live pump.fun trade decoded from Yellowstone gRPC.',
  );
});

logger.info({ program: config.PUMPFUN_PROGRAM_ID }, 'Watching live pump.fun trades via Yellowstone gRPC. Ctrl-C to stop.');
await stream.start();
