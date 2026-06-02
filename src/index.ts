import { loadConfig } from './config.js';
import { logger } from './logger.js';
const config = loadConfig();
logger.info({ cluster: config.TARGET_CLUSTER }, 'AgentArena Superteam Infra v2 ready.');
logger.info('Run `npm run watch:slots`, then `npm run challenge:run -- --count 10 --failures 2`.');
