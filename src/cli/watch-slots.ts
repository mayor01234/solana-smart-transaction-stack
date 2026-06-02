import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { SlotStream } from '../geyser/slot-stream.js';

const config = loadConfig();
const slotStream = new SlotStream(config);
let seen = 0;
slotStream.on('slot', (slot) => {
  seen += 1;
  logger.info(slot, 'Yellowstone slot update.');
  if (seen >= 10) {
    logger.info('Received 10 slot updates; smoke test successful.');
    process.exit(0);
  }
});
await slotStream.start();
