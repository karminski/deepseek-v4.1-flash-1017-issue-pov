// Print the evidence behind the headline cases in analysis.json.
import { readFileSync } from 'node:fs';
import { RUNS, logPath } from './runs.mjs';

const analysis = JSON.parse(readFileSync('results/log-replay/analysis.json', 'utf8'));
const runById = new Map(RUNS.map((run) => [run.id, run]));

function reasoning(run, cycle) {
  let text = '';
  for (const line of readFileSync(logPath('raw-api-log', run), 'utf8').trim().split('\n')) {
    const entry = JSON.parse(line);
    if (entry.event !== 'API_RESPONSE' || entry.cycle !== cycle) continue;
    const message = entry.payload.choices?.[0]?.message ?? {};
    text += `\n${message.reasoning_content ?? ''}\n${message.content ?? ''}`;
  }
  return text;
}

function around(text, pattern, width = 220) {
  const hits = [];
  for (const match of text.matchAll(pattern)) {
    hits.push(text.slice(Math.max(0, match.index - width), match.index + width).replace(/\s+/g, ' '));
    if (hits.length >= 2) break;
  }
  return hits;
}

console.log('=== warned vehicles that were never admitted and ended in an incident');
for (const version of ['R19', '1017']) {
  for (const warned of analysis[version].warnedVehicles.filter((item) => item.neverAdmittedButCrashed)) {
    const run = runById.get(warned.run);
    const incidents = JSON.parse(readFileSync(logPath('report', run), 'utf8')).summary.incidents;
    const incident = incidents.find((item) => item.vehicleIds.includes(warned.vehicleId));
    console.log(`\n[${version} ${warned.run} c${warned.cycle}] ${warned.vehicleId} -> ${incident.id} ${incident.collisionType} t${incident.triggerTick} trigger=${incident.vehicleIds[0] === warned.vehicleId} vehicles=${incident.vehicleIds.length} peds=${incident.pedestrianIds.length}`);
    for (const snippet of around(reasoning(run, warned.cycle), new RegExp(warned.vehicleId, 'g'), 160)) console.log(`   … ${snippet} …`);
  }
}

console.log('\n=== commits that sent vehicles across a crosswalk with a jaywalker on it');
for (const version of ['R19', '1017']) {
  for (const commit of analysis[version].commits.filter((item) => item.exposedToJaywalker > 0)) {
    const run = runById.get(commit.run);
    console.log(`\n[${version} ${commit.run} c${commit.cycle}] admitted=${commit.admitted} exposed=${commit.exposedToJaywalker} struck=${commit.exposedStruckPedestrian}`);
    for (const snippet of around(reasoning(run, commit.cycle), /jaywalk/gi, 260)) console.log(`   … ${snippet} …`);
  }
}
