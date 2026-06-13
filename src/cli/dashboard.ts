import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
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

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy(); // cap payload — local viewer only
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const ASK_SYSTEM_PROMPT = [
  'You are a senior Solana infrastructure analyst embedded in a smart-transaction stack.',
  'You are given ONE bundle lifecycle record as JSON and a question about it.',
  'Answer concisely and precisely using ONLY the data in the record — never invent slots, signatures, or numbers.',
  'Explain what happened across the processed → confirmed → finalized lifecycle, the AI agent decision and its reasoning,',
  'the tip economics, and any failure classification. If the record shows a deliberate fault (intent starts with "fault_"),',
  'say so and explain why that outcome is correct. If the data needed to answer is absent, say it is not in the record.',
  'Keep answers under ~150 words unless asked for detail. Plain text, no markdown headers.',
].join(' ');

/** Claude-powered Q&A over a single lifecycle record. Returns 200 with a graceful message on any failure. */
async function handleAsk(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const reply = (answer: string) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ answer }));
  };
  try {
    const body = JSON.parse((await readBody(req)) || '{}');
    const question = String(body.question ?? '').slice(0, 2_000).trim();
    const record = body.record ?? {};
    if (!question) return reply('Ask a question about this transaction to get a live analysis.');
    if (!config.ANTHROPIC_API_KEY) {
      return reply(
        'Live AI Q&A is offline: no ANTHROPIC_API_KEY is configured. Set it in .env to enable on-demand analysis. ' +
          'The reasoning recorded during the run (shown above) is real and was produced live by the agent at submission time.',
      );
    }
    const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, timeout: config.AI_LLM_TIMEOUT_MS, maxRetries: 1 });
    const msg = await client.messages.create({
      model: config.ANTHROPIC_MODEL,
      max_tokens: 800,
      system: ASK_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Bundle lifecycle record:\n\n${JSON.stringify(record, null, 2)}\n\nQuestion: ${question}`,
        },
      ],
    });
    const answer = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n').trim();
    return reply(answer || 'No answer was returned by the model.');
  } catch (e) {
    return reply(`AI analysis error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const server = http.createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  if (req.method === 'POST' && url === '/api/ask') {
    void handleAsk(req, res);
    return;
  }
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

// Bind to loopback only: this is a local read-only viewer, never meant to be reachable from the
// LAN. Without an explicit host, Node listens on all interfaces (0.0.0.0) — exposing the evidence
// to anyone on the same network. 127.0.0.1 keeps it on this machine.
//
// If the port is already taken (a leftover dashboard from an earlier run), fall forward to the next
// free port instead of crashing with an EADDRINUSE stack trace — so a demo is never derailed.
function startServer(port: number, attemptsLeft: number): void {
  // Pair the error/listening handlers per attempt and remove the other on whichever fires first, so a
  // failed bind's 'listening' callback can't leak into the next successful attempt (double-log bug).
  const onError = (err: NodeJS.ErrnoException) => {
    server.removeListener('listening', onListening);
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      logger.warn({ port }, `Port ${port} is in use (a dashboard may already be running) — trying ${port + 1}.`);
      setTimeout(() => startServer(port + 1, attemptsLeft - 1), 150);
    } else if (err.code === 'EADDRINUSE') {
      logger.error(`Ports ${PORT}–${port} are all in use. Stop the other dashboard, or run with a custom port: DASHBOARD_PORT=4400 npm run challenge:dashboard`);
      process.exit(1);
    } else {
      logger.error({ err: err.message }, 'Dashboard server error.');
      process.exit(1);
    }
  };
  const onListening = () => {
    server.removeListener('error', onError);
    logger.info({ url: `http://localhost:${port}` }, 'AgentArena dashboard running. Open it in your browser. Ctrl-C to stop.');
  };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, '127.0.0.1');
}
startServer(PORT, 9);
