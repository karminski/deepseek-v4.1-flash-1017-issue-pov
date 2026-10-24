import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROBES } from './registry.mjs';

function collect(outDir) {
  const records = [];
  for (const probe of PROBES) {
    const probeDir = path.join(outDir, probe.id);
    if (!fs.existsSync(probeDir)) continue;
    for (const variant of fs.readdirSync(probeDir)) {
      const dir = path.join(probeDir, variant);
      for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.metrics.json'))) {
        records.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
      }
    }
  }
  return records;
}

function stats(values) {
  const list = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (list.length === 0) return null;
  const avg = list.reduce((sum, value) => sum + value, 0) / list.length;
  const sd = Math.sqrt(list.reduce((sum, value) => sum + (value - avg) ** 2, 0) / list.length);
  return { mean: avg, sd, n: list.length };
}

const fmt = (s) => (s === null ? '–' : s.n > 1 ? `${s.mean.toFixed(2)} ± ${s.sd.toFixed(2)}` : s.mean.toFixed(2));

export function summarize(outDir) {
  const records = collect(outDir);
  const summary = {};
  for (const probe of PROBES) {
    const mine = records.filter((r) => r.probe === probe.id);
    if (mine.length === 0) continue;
    summary[probe.id] = {};
    for (const variant of [...new Set(mine.map((r) => r.variant))].sort()) {
      const rows = mine.filter((r) => r.variant === variant);
      const ok = rows.filter((r) => r.ok);
      const entry = { runs: rows.length, errors: rows.length - ok.length, metrics: {} };
      for (const key of probe.summaryKeys) entry.metrics[key] = stats(ok.map((r) => r.metrics[key]));
      entry.metrics.requests = stats(ok.map((r) => r.usage.requests));
      entry.metrics.completionTokens = stats(ok.map((r) => r.usage.completionTokens));
      summary[probe.id][variant] = entry;
    }
  }
  return summary;
}

export function writeSummary(outDir) {
  const summary = summarize(outDir);
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  const lines = [`# POV summary: ${path.basename(outDir)}`, ''];
  for (const probe of PROBES) {
    const byVariant = summary[probe.id];
    if (!byVariant) continue;
    const direction = probe.primaryMetric.higherIsBetter ? 'higher is better' : 'lower is better';
    lines.push(`## ${probe.id}`, '', probe.hypothesis, '', `Primary metric: \`${probe.primaryMetric.key}\` (${direction}).`, '');
    const keys = [...probe.summaryKeys, 'requests', 'completionTokens'];
    lines.push(`| variant | runs | ${keys.join(' | ')} |`);
    lines.push(`| --- | --- | ${keys.map(() => '---').join(' | ')} |`);
    for (const [variant, entry] of Object.entries(byVariant)) {
      const runs = entry.errors ? `${entry.runs} (${entry.errors} err)` : String(entry.runs);
      lines.push(`| ${variant} | ${runs} | ${keys.map((key) => fmt(entry.metrics[key])).join(' | ')} |`);
    }
    lines.push('');
  }
  const file = path.join(outDir, 'summary.md');
  fs.writeFileSync(file, lines.join('\n'));
  return file;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node src/report.mjs <results-dir>');
    process.exit(1);
  }
  console.log(writeSummary(path.resolve(target)));
}
