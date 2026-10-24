// The six crossroad runs analysed in the comparison report (seed 63916, 200 ticks).
// Ids follow the report's labels (matched on incident and pile-up counts), not file order.
// R19 runs must be replayed with the rules-v19 build (commit 0d8e6f9).
export const REPO = 'z:/works/kcores.com/repo/silicon-conductor-bench';
export const V19_REPO = 'Z:/works/kcores.com/repo/scb-rules-v19';

export const RUNS = [
  { id: 'R19-1', version: 'R19', stem: 'deepseek-flash_2026-10-05_182706061-72412', env: '.env.deepseek-flash' },
  { id: 'R19-2', version: 'R19', stem: 'deepseek-flash_2026-10-05_182723625-63004', env: '.env.deepseek-flash' },
  { id: 'R19-3', version: 'R19', stem: 'deepseek-flash_2026-10-05_182701620-60820', env: '.env.deepseek-flash' },
  { id: '1017-1', version: '1017', stem: 'deepseek-v4.1-flash-1017_2026-10-17_182918441-98980', env: '.env.deepseek-v4.1-flash-1017' },
  { id: '1017-2', version: '1017', stem: 'deepseek-v4.1-flash-1017_2026-10-17_182918446-21752', env: '.env.deepseek-v4.1-flash-1017' },
  { id: '1017-3', version: '1017', stem: 'deepseek-v4.1-flash-1017_2026-10-17_182918440-99816', env: '.env.deepseek-v4.1-flash-1017' },
];

export function runRepo(run) {
  return run.version === 'R19' ? V19_REPO : REPO;
}

export function logPath(kind, run) {
  const ext = kind === 'checkpoint' || kind === 'report' || kind === 'run' ? 'json' : 'jsonl';
  return `${REPO}/logs/${kind}_${run.stem}.${ext}`;
}
