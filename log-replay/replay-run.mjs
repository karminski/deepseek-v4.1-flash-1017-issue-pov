// Deterministically re-run a recorded crossroad benchmark run.
// A local mock of the OpenAI chat endpoint serves the recorded responses in order,
// checks every incoming request against the recorded one, and snapshots the
// engine checkpoint at the start of every cycle.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '');
    args[key] = argv[i + 1];
    i += 1;
  }
  for (const required of ['raw', 'repo', 'env', 'out']) {
    if (!args[required]) throw new Error(`missing --${required}`);
  }
  return args;
}

function loadPairs(rawPath) {
  const lines = readFileSync(rawPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const pairs = [];
  let pending = null;
  for (const entry of lines) {
    if (entry.event === 'API_REQUEST') pending = entry;
    else if (entry.event === 'API_RESPONSE' && pending) {
      pairs.push({ cycle: entry.cycle, round: entry.round, tick: entry.tick, request: pending.payload, response: entry.payload });
      pending = null;
    } else if (entry.event === 'API_ERROR' && pending) {
      pairs.push({ cycle: entry.cycle, round: entry.round, tick: entry.tick, request: pending.payload, error: entry.payload });
      pending = null;
    }
  }
  return pairs;
}

function firstDifference(expected, actual) {
  const a = JSON.stringify(expected);
  const b = JSON.stringify(actual);
  if (a === b) return null;
  let index = 0;
  while (index < a.length && a[index] === b[index]) index += 1;
  return { at: index, expected: a.slice(Math.max(0, index - 120), index + 200), actual: b.slice(Math.max(0, index - 120), index + 200) };
}

function latestCheckpoint(dir) {
  if (!existsSync(dir)) return null;
  const found = readdirSync(dir).filter((name) => name.startsWith('checkpoint_') && name.endsWith('.json'));
  return found.length === 0 ? null : join(dir, found[0]);
}

const args = parseArgs(process.argv.slice(2));
const out = resolve(args.out);
const artifacts = join(out, 'artifacts');
const snapshots = join(out, 'snapshots');
rmSync(out, { recursive: true, force: true });
mkdirSync(artifacts, { recursive: true });
mkdirSync(snapshots, { recursive: true });

const pairs = loadPairs(resolve(args.raw));
const status = { served: 0, total: pairs.length, mismatches: [], snapshotCycles: [] };
let lastCycle = 0;

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    const pair = pairs[status.served];
    if (!pair) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'replay exhausted' } }));
      return;
    }
    const request = JSON.parse(body);
    if (pair.cycle !== lastCycle) {
      const checkpoint = latestCheckpoint(artifacts);
      if (checkpoint) {
        copyFileSync(checkpoint, join(snapshots, `cycle-${String(pair.cycle).padStart(3, '0')}.json`));
        status.snapshotCycles.push(pair.cycle);
      }
      lastCycle = pair.cycle;
    }
    // Assistant turns are echoed back from the recording; their reasoning text carries
    // lossy UTF-8 that does not round-trip, so only environment-authored turns are compared.
    const environmentTurns = (messages) => messages.filter((message) => message.role !== 'assistant');
    const diff = firstDifference(environmentTurns(pair.request.messages), environmentTurns(request.messages));
    if (diff) status.mismatches.push({ index: status.served, cycle: pair.cycle, round: pair.round, ...diff });
    status.served += 1;
    if (pair.error) {
      req.socket.destroy();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(pair.response));
  });
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  const child = spawn(process.execPath, [join(resolve(args.repo), 'dist', 'src', 'cli.js'), '--ticks', '200', '--seed', '63916', '--plain'], {
    cwd: resolve(args.repo),
    env: {
      ...process.env,
      DOTENV_CONFIG_PATH: resolve(args.env),
      OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
      OPENAI_API_KEY: 'replay',
      AGENT_API_LOG_DIR: artifacts,
      BENCH_QUIET_CONSOLE: '1',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.on('exit', (code) => {
    server.close();
    status.exitCode = code;
    status.stderrTail = stderr.split('\n').filter((line) => !line.includes('activity=')).slice(-15).join('\n');
    writeFileSync(join(out, 'replay-status.json'), JSON.stringify(status, null, 2));
    console.log(`served ${status.served}/${status.total} mismatches=${status.mismatches.length} snapshots=${status.snapshotCycles.length} exit=${code}`);
    if (status.mismatches.length > 0) console.log(JSON.stringify(status.mismatches[0], null, 2));
  });
});
