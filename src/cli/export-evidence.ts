import { loadConfig } from '../config.js';
import { LifecycleStore } from '../core/lifecycle-store.js';

const config = loadConfig();
const store = new LifecycleStore(config);
console.log('JSON:', store.exportJson());
console.log('Markdown:', store.exportMarkdown());
console.log('Summary:', store.exportSummary());
