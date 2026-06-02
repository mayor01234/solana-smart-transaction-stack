import { loadConfig } from './config.js';
import { logger } from './logger.js';
const config = loadConfig();
logger.info(
  { cluster: config.TARGET_CLUSTER, jitoTransport: config.JITO_TRANSPORT, aiMode: config.AI_DECISION_MODE },
  'AgentArena Superteam Infra v3 ready.',
);
logger.info('Run `npm run challenge:doctor`, then `npm run watch:slots`, then `npm run challenge:first-place`.');
