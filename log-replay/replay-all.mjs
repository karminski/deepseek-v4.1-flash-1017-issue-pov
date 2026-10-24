// Replay all six runs in parallel and check the replayed totals against the original reports.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, RUNS, logPath, runRepo } from './runs.mjs';

const OUT = 'results/log-replay';

function replay(run) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [
      'log-replay/replay-run.mjs',
      '--raw', logPath('raw-api-log', run),
      '--repo', runRepo(run),
      '--env', `${REPO}/${run.env}`,
      '--out', join(OUT, run.id),
    ], { stdio: ['ignore', 'pipe', 'inherit'] });
    let text = '';
    child.stdout.on('data', (chunk) => {
      text += chunk;
    });
    child.on('exit', () => resolvePromise(text.split('\n')[0]));
  });
}

function totals(summary) {
  return `${summary.finalBalance.toFixed(4)} inc=${summary.incidents.length} adm=${summary.totals.admittedVehicles}`;
}

const lines = await Promise.all(RUNS.map(replay));
for (const [index, run] of RUNS.entries()) {
  const dir = join(OUT, run.id, 'artifacts');
  const name = readdirSync(dir).find((file) => file.startsWith('report_'));
  const replayed = JSON.parse(readFileSync(join(dir, name), 'utf8')).summary;
  const original = JSON.parse(readFileSync(logPath('report', run), 'utf8')).summary;
  const same = totals(replayed) === totals(original);
  console.log(`${run.id}: ${lines[index]} | replay ${totals(replayed)} | original ${totals(original)} | ${same ? 'MATCH' : 'DIFF'}`);
}
