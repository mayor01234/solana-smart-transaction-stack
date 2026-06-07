import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';

// Read-only local web dashboard. Serves a static page that visualizes the generated evidence
// (lifecycle records, AI reasoning, tips, latency). It never touches the core stack or the chain.
const config = loadConfig();
const PORT = Number(process.env.DASHBOARD_PORT ?? 4317);
const root = process.cwd();
const htmlPath = path.join(root, 'dashboard', 'index.html');
const evidenceDir = path.resolve(config.EVIDENCE_DIR);

function readJson(file: string, fallback: unknown): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const server = http.createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  if (url === '/' || url === '/index.html') {
    try {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(htmlPath));
    } catch {
      res.writeHead(500).end('dashboard/index.html not found');
    }
    return;
  }
  if (url === '/api/lifecycle') {
    // Prefer the live .jsonl (appended per attempt during a run) so the page updates in real time;
    // then the final .json; then the example so the page always renders.
    const jsonl = path.join(evidenceDir, 'lifecycle-log.jsonl');
    const real = path.join(evidenceDir, 'lifecycle-log.json');
    const example = path.join(evidenceDir, 'lifecycle-log.example.json');
    let records: unknown = [];
    let source = 'example';
    if (fs.existsSync(jsonl)) {
      records = fs.readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      source = 'live';
    } else if (fs.existsSync(real)) {
      records = readJson(real, []);
      source = 'live';
    } else {
      records = readJson(example, []);
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ source, records }));
    return;
  }
  if (url === '/api/summary') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(readJson(path.join(evidenceDir, 'run-summary.json'), {})));
    return;
  }
  res.writeHead(404).end('not found');
});

server.listen(PORT, () => {
  logger.info({ url: `http://localhost:${PORT}` }, 'AgentArena dashboard running. Open it in your browser. Ctrl-C to stop.');
});
