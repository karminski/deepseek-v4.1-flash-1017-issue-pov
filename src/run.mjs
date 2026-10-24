import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { modelConfigFromEnv, parseEnvFile } from './env.mjs';
import { runEpisode } from './loop.mjs';
import { PROBES, ROOT, findProbe, loadVariant } from './registry.mjs';
import { writeSummary } from './report.mjs';

const { values } = parseArgs({
  options: {
    env: { type: 'string', default: path.join(ROOT, '.env') },
    probes: { type: 'string', default: 'blind-box' },
    variants: { type: 'string', default: 'v0-baseline' },
    trials: { type: 'string', default: '3' },
    seeds: { type: 'string' },
    concurrency: { type: 'string', default: '4' },
    out: { type: 'string' },
    label: { type: 'string', default: 'model' },
    'timeout-ms': { type: 'string' },
  },
});

const config = modelConfigFromEnv(parseEnvFile(values.env), {
  timeoutMs: values['timeout-ms'] ? Number(values['timeout-ms']) : undefined,
});
const probes = values.probes.split(',').map((id) => findProbe(id.trim()));
const variants = await Promise.all(values.variants.split(',').map((id) => loadVariant(id.trim())));
const trialCount = Number(values.trials);
const seeds = values.seeds
  ? values.seeds.split(',').map(Number)
  : probes[0]?.seeds?.length
    ? probes[0].seeds.slice(0, trialCount)
    : Array.from({ length: trialCount }, (_, i) => 101 + i);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.resolve(values.out ?? path.join(ROOT, 'results', `${stamp}-${values.label}`));
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'run.json'),
  JSON.stringify(
    {
      label: values.label,
      startedAt: new Date().toISOString(),
      probes: probes.map((p) => p.id),
      variants: variants.map((v) => ({ id: v.id, description: v.description, harness: v.harness })),
      seeds,
      maxTokens: config.maxTokens,
      replayReasoning: config.replayReasoning,
    },
    null,
    2,
  ),
);

const tasks = [];
for (const probe of probes) {
  for (const variant of variants) {
    if (variant.probe && variant.probe !== probe.id) continue;
    for (const seed of seeds) tasks.push({ probe, variant, seed });
  }
}

let finished = 0;
async function runTask({ probe, variant, seed }) {
  const dir = path.join(outDir, probe.id, variant.id);
  fs.mkdirSync(dir, { recursive: true });
  const transcriptPath = path.join(dir, `seed-${seed}.jsonl`);
  fs.rmSync(transcriptPath, { force: true });
  const started = Date.now();
  let record;
  try {
    const { metrics, usage } = await runEpisode({ config, probe, variant, seed, transcriptPath });
    record = { probe: probe.id, variant: variant.id, seed, ok: true, metrics, usage };
  } catch (error) {
    record = { probe: probe.id, variant: variant.id, seed, ok: false, error: String(error?.message ?? error) };
  }
  record.seconds = Math.round((Date.now() - started) / 1000);
  fs.writeFileSync(path.join(dir, `seed-${seed}.metrics.json`), JSON.stringify(record, null, 2));
  finished += 1;
  const primary = record.ok ? record.metrics[probe.primaryMetric.key] : 'ERROR';
  console.log(
    `[${finished}/${tasks.length}] ${probe.id} ${variant.id} seed=${seed} ${probe.primaryMetric.key}=${
      typeof primary === 'number' ? primary.toFixed(2) : primary
    } (${record.seconds}s)${record.ok ? '' : ` ${record.error}`}`,
  );
}

const queue = [...tasks];
const workers = Array.from({ length: Math.max(1, Number(values.concurrency)) }, async () => {
  while (queue.length > 0) await runTask(queue.shift());
});
await Promise.all(workers);
const summaryPath = writeSummary(outDir);
console.log(`Summary: ${summaryPath}`);
