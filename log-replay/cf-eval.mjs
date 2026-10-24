// Counterfactual evaluation of every decision cycle of one replayed crossroad run.
//
// For each cycle c the engine is restored from the cycle-start snapshot, the recorded
// tool calls are re-executed, and the recorded sleep is stepped. The resulting engine
// checkpoint must equal snapshot c+1 (fidelity check). On hold cycles every
// single-lane batch with top_n 1 or 2 is then dry-run and, when the dry run is clean,
// committed and rolled forward against the recorded hold over the same horizon.
// Commit cycles record the pedestrian exposure of the admitted vehicles.
//
// Usage: node log-replay/cf-eval.mjs --run <id> [--horizon 20]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, RUNS, logPath, runRepo } from './runs.mjs';

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const run = RUNS.find((candidate) => candidate.id === option('run'));
if (!run) throw new Error(`unknown --run; expected one of ${RUNS.map((r) => r.id).join(', ')}`);
const HORIZON = Number(option('horizon', '20'));
const TOP_NS = [1, 2];

process.env.DOTENV_CONFIG_PATH = `${REPO}/${run.env}`;
const dist = (path) => import(pathToFileURL(join(runRepo(run), 'dist', 'src', path)).href);
const { config, engineDynamicsFromConfig } = await dist('config.js');
const { SimulationEngine } = await dist('core/engine.js');
const { createRoadNetwork, defaultRouteIds } = await dist('core/network.js');
const { arrivalsAt } = await dist('core/demand.js');
const { rewardTollForVehicle } = await dist('core/vehicleRoster.js');
const { violationForfeitsToll } = await dist('core/drivers.js');
const { AgentToolRuntime } = await dist('agent/tools.js');
const { AgentMetricsCollector } = await dist('agent/metrics.js');
const { WorkingMemoryStack } = await dist('agent/working-memory.js');

const economy = config.economy;
const seed = 63916;
const network = createRoadNetwork({
  inboundLaneLength: config.simulation.inboundLaneLength,
  outboundLaneLength: config.simulation.outboundLaneLength,
});
const agentEconomy = {
  decisionTax: economy.decisionTax,
  toolTax: economy.toolTax,
  recklessAttemptPenalty: economy.recklessAttemptPenalty,
  parallelTerminalWarningPenalty: economy.parallelTerminalWarningPenalty,
  pedestrianDelayPerTick: economy.pedestrianDelayPerTick,
  pedestrianWaitingGraceTicks: economy.pedestrianWaitingGraceTicks,
  pedestrianCompletionReward: economy.pedestrianCompletionReward,
  pedestrianJaywalkWavePenalty: economy.pedestrianJaywalkWavePenalty,
  pedestrianJaywalkerPenalty: economy.pedestrianJaywalkerPenalty,
  pedestrianCollisionPenalty: economy.pedestrianCollisionPenalty,
  initialBalance: economy.initialBalance,
  tollMotorcycle: economy.tollMotorcycle,
  tollStandard: economy.tollStandard,
  tollEmergency: economy.tollEmergency,
  emergencyDelayBleedPerTick: economy.emergencyDelayBleedPerTick,
  stallChainStep: economy.stallChainStep,
  hazardBleedPerResource: economy.hazardBleedPerResource,
  secondaryAdmitPenalty: economy.secondaryAdmitPenalty,
  delayBleedPerTick: economy.delayBleedPerTick,
  upstreamBleedPerTick: economy.upstreamBleedPerTick,
  unservedVehicleLiability: economy.unservedVehicleLiability,
  schoolBusAccidentPenalty: economy.schoolBusAccidentPenalty,
  hazmatHazardMultiplier: economy.hazmatHazardMultiplier,
  vehicleAggression: config.simulation.vehicleAggressionEnabled,
  horizonTicks: 200,
  endTick: 261,
};
const END_TICK = 261;
const toll = (type) => rewardTollForVehicle(type, economy.tollMotorcycle, economy.tollStandard, economy.tollEmergency);
const pedestrianRates = {
  delayPerTick: economy.pedestrianDelayPerTick,
  waitingGraceTicks: economy.pedestrianWaitingGraceTicks,
  completionReward: economy.pedestrianCompletionReward,
  jaywalkWavePenalty: economy.pedestrianJaywalkWavePenalty,
  jaywalkerPenalty: economy.pedestrianJaywalkerPenalty,
  collisionPenalty: economy.pedestrianCollisionPenalty,
};

function engineFrom(engineCheckpoint) {
  const engine = new SimulationEngine({ network, seed, dynamics: engineDynamicsFromConfig() });
  engine.restoreCheckpoint(structuredClone(engineCheckpoint));
  return engine;
}

function fork(engine) {
  return engineFrom(engine.exportCheckpoint());
}

function scheduledDemand(engine) {
  engine.drainUpstreamQueues();
  for (const arrival of arrivalsAt(seed, engine.currentTick, defaultRouteIds(engine.network))) {
    engine.spawnScheduled(arrival);
  }
  if (config.simulation.pedestrianDemandEnabled) engine.generatePedestrianDemand();
  engine.drainPedestrianEvents();
}

function runtimeFor(engine, memory) {
  return new AgentToolRuntime({
    engine,
    memory,
    metrics: new AgentMetricsCollector(agentEconomy),
    tollMotorcycle: economy.tollMotorcycle,
    tollStandard: economy.tollStandard,
    tollEmergency: economy.tollEmergency,
    towDispatchCost: economy.towDispatchCost,
    towClearanceTicks: config.simulation.towClearanceTicks,
  });
}

function memoryFrom(snapshot) {
  const memory = new WorkingMemoryStack(config.agent.memoryDepth);
  memory.restore(structuredClone(snapshot.workingMemory));
  return memory;
}

function incidentSummary(engine) {
  const incidents = engine.exportCheckpoint().incidents ?? [];
  return {
    count: incidents.length,
    pileups: incidents.filter((incident) => incident.collisionType === 'PILEUP').length,
    vehicleIds: new Set(incidents.flatMap((incident) => incident.vehicleIds ?? [])),
    pedestrianStrikes: incidents.filter((incident) => (incident.pedestrianIds ?? []).length > 0).length,
  };
}

// Mirrors the post-decision settlement and the per-tick loop in src/cli.ts.
function settleAndStep(engine, ticks, { stopOnInterrupt, chargeTrailing = true }) {
  let value = 0;
  value -= engine.consumeTowCharges();
  value -= engine.consumeSecondaryAdmitCount() * economy.secondaryAdmitPenalty;
  value -= engine.consumeSchoolBusAccidents() * economy.schoolBusAccidentPenalty;
  engine.drainIncidentLog();
  engine.drainPedestrianEvents();
  let exited = 0;
  let stepped = 0;
  let interrupt = null;
  const budget = Math.min(ticks, END_TICK - engine.currentTick);
  for (let step = 0; step < budget; step += 1) {
    scheduledDemand(engine);
    const waiting = engine.collectWaitingSettlement(economy.delayBleedPerTick, economy.upstreamBleedPerTick).totals;
    value -= waiting.delay + waiting.emergency + waiting.stallChain + waiting.upstream;
    const result = engine.step();
    const pedestrians = engine.collectPedestrianSettlement(pedestrianRates);
    value += pedestrians.completionRevenue - pedestrians.delayCost - pedestrians.jaywalkCost - pedestrians.collisionCost;
    value -= (engine.hazardResourceUnits() + engine.exitLockedResourceCount()) * economy.hazardBleedPerResource;
    engine.drainIncidentLog();
    engine.drainPedestrianEvents();
    for (const event of result.despawnEvents) {
      exited += 1;
      if (!violationForfeitsToll(event.violation)) value += toll(event.vehicleType);
    }
    stepped += 1;
    if (result.interruptReason !== undefined) {
      interrupt = interrupt ?? result.interruptReason;
      if (stopOnInterrupt) break;
    }
  }
  if (chargeTrailing) value -= engine.consumeSchoolBusAccidents() * economy.schoolBusAccidentPenalty;
  return { value, exited, stepped, interrupt };
}

function loadSnapshots(id) {
  const dir = join('results', 'log-replay', id, 'snapshots');
  const map = new Map();
  for (const name of readdirSync(dir)) map.set(Number(name.slice(6, 9)), JSON.parse(readFileSync(join(dir, name), 'utf8')));
  const artifacts = join('results', 'log-replay', id, 'artifacts');
  const finalName = readdirSync(artifacts).find((name) => name.startsWith('checkpoint_'));
  return { map, final: JSON.parse(readFileSync(join(artifacts, finalName), 'utf8')) };
}

function loadCycleCalls() {
  const calls = new Map();
  const results = new Map();
  for (const line of readFileSync(logPath('api-log', run), 'utf8').trim().split('\n')) {
    const entry = JSON.parse(line);
    if (entry.event === 'TOOL_CALL') {
      const list = calls.get(entry.cycle) ?? [];
      list.push(entry.payload);
      calls.set(entry.cycle, list);
    } else if (entry.event === 'TOOL_RESULT') {
      results.set(entry.payload.toolCallId, entry.payload.output);
    }
  }
  return { calls, results };
}

function routeCrosswalks(engine, vehicleId) {
  const vehicle = engine.vehicles.get(vehicleId);
  return vehicle ? engine.routeCrosswalkIds(vehicle.routeId) : [];
}

function pedestrianExposure(engine, vehicleIds) {
  const onCrosswalk = new Map();
  for (const pedestrian of engine.pedestrians.values()) {
    if (pedestrian.state !== 'CROSSING_JAYWALK' && pedestrian.state !== 'CROSSING_RESERVED') continue;
    const entry = onCrosswalk.get(pedestrian.crosswalkId) ?? { jaywalk: [], reserved: [] };
    (pedestrian.state === 'CROSSING_JAYWALK' ? entry.jaywalk : entry.reserved).push(pedestrian.id);
    onCrosswalk.set(pedestrian.crosswalkId, entry);
  }
  const exposures = [];
  for (const vehicleId of vehicleIds) {
    for (const crosswalkId of routeCrosswalks(engine, vehicleId)) {
      const entry = onCrosswalk.get(crosswalkId);
      if (entry) exposures.push({ vehicleId, crosswalkId, jaywalkers: entry.jaywalk.length, reservedCrossers: entry.reserved.length });
    }
  }
  return exposures;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

// announced* fields only track which wake-up notices were already shown to the model;
// they are updated by the observation builder and do not affect vehicles, pedestrians or reservations.
function samePhysicalState(left, right) {
  const physical = (checkpoint) => Object.fromEntries(Object.entries(checkpoint).filter(([key]) => !key.startsWith('announced')));
  return sameJson(physical(left), physical(right));
}

const report = JSON.parse(readFileSync(logPath('report', run), 'utf8')).summary;
const { map: snapshots, final } = loadSnapshots(run.id);
const { calls, results } = loadCycleCalls();
const inboundLanes = [...network.inboundLanes.keys()].sort();
const out = [];

for (const cycleSummary of report.cycles) {
  const cycle = cycleSummary.cycle;
  const start = snapshots.get(cycle);
  const next = snapshots.get(cycle + 1) ?? (cycle === report.cycles.length ? final : undefined);
  if (!start) continue;

  // Fidelity: reproduce the recorded cycle and compare with the next snapshot.
  const engine = engineFrom(start.engine);
  const memory = memoryFrom(start);
  scheduledDemand(engine);
  engine.buildObservation(start.balance, start.interruptReason ?? undefined, null);
  const runtime = runtimeFor(engine, memory);
  const recorded = calls.get(cycle) ?? [];
  let toolMismatches = 0;
  let toolMismatchSample = null;
  let commitArgs = null;
  let decisionState = null;
  for (const call of recorded) {
    if (call.toolName === 'commit_schedule') {
      decisionState = fork(engine);
      commitArgs = call.arguments;
    }
    const executed = runtime.execute(call.toolName, JSON.stringify(call.arguments));
    if (!sameJson(executed.output, results.get(call.toolCallId))) {
      toolMismatches += 1;
      toolMismatchSample ??= {
        tool: call.toolName,
        replayed: JSON.stringify(executed.output).slice(0, 400),
        recorded: JSON.stringify(results.get(call.toolCallId)).slice(0, 400),
      };
    }
    if (executed.terminal) break;
  }
  if (cycleSummary.usedFallback) {
    decisionState = decisionState ?? fork(engine);
    engine.applyAdmissions([]);
  }
  settleAndStep(engine, cycleSummary.sleepTicks, { stopOnInterrupt: true, chargeTrailing: false });
  const replayedCheckpoint = engine.exportCheckpoint();
  const faithful = next !== undefined && samePhysicalState(replayedCheckpoint, next.engine);
  const divergentFields = next === undefined || faithful
    ? []
    : Object.keys(next.engine).filter((key) => !sameJson(replayedCheckpoint[key], next.engine[key]));

  const dryRuns = recorded.filter((call) => call.toolName === 'dry_run_admit').length;
  const admitted = cycleSummary.admitted;
  const row = {
    cycle,
    tick: cycleSummary.tick - 0,
    startTick: start.engine.currentTick ?? null,
    sleep: cycleSummary.sleepTicks,
    fallback: cycleSummary.usedFallback,
    held: admitted.length === 0,
    admitted: admitted.length,
    dryRuns,
    tools: recorded.map((call) => call.toolName),
    toolMismatches,
    ...(toolMismatchSample ? { toolMismatchSample } : {}),
    faithful,
    ...(divergentFields.length > 0 ? { divergentFields } : {}),
  };

  if (decisionState === null) {
    out.push(row);
    continue;
  }

  if (!row.held) {
    row.exposure = pedestrianExposure(decisionState, admitted);
    const later = incidentSummary(engineFrom(final.engine));
    row.admittedInLaterIncident = admitted.filter((id) => later.vehicleIds.has(id)).length;
    out.push(row);
    continue;
  }

  // Counterfactual on hold cycles: recorded hold versus each clean single-lane batch.
  const baseEngine = fork(decisionState);
  const baseRuntime = runtimeFor(baseEngine, memoryFrom(start));
  if (commitArgs) baseRuntime.execute('commit_schedule', JSON.stringify(commitArgs));
  else baseEngine.applyAdmissions([]);
  const baseIncidentsBefore = incidentSummary(baseEngine);
  const base = settleAndStep(baseEngine, HORIZON, { stopOnInterrupt: false });
  const baseIncidents = incidentSummary(baseEngine);
  const sleep = commitArgs?.sleep_ticks ?? cycleSummary.sleepTicks;

  const candidates = [];
  for (const laneId of inboundLanes) {
    for (const topN of TOP_NS) {
      const branch = fork(decisionState);
      const branchRuntime = runtimeFor(branch, memoryFrom(start));
      const batch = { lane_batches: [{ lane_id: laneId, top_n: topN }] };
      const dry = branchRuntime.execute('dry_run_admit', JSON.stringify(batch)).output;
      const candidate = { laneId, topN, ok: dry?.ok === true, reason: dry?.ok ? null : (dry?.reason ?? dry?.error?.code ?? null) };
      if (!candidate.ok) {
        candidates.push(candidate);
        continue;
      }
      candidate.vehicles = dry.resolved_vehicle_ids.length;
      candidate.jaywalkerWarning = (dry.jaywalker_warnings ?? []).length > 0;
      candidate.tailgateRisk = (dry.tailgate_risk ?? []).length > 0;
      const commit = branchRuntime.execute('commit_schedule', JSON.stringify({ ...batch, sleep_ticks: sleep, tactical_summary: 'counterfactual' }));
      candidate.committed = commit.output?.committed === true;
      const result = settleAndStep(branch, HORIZON, { stopOnInterrupt: false });
      const incidents = incidentSummary(branch);
      candidate.delta = Number((result.value - base.value).toFixed(4));
      candidate.extraIncidents = incidents.count - baseIncidents.count;
      candidate.extraPileups = incidents.pileups - baseIncidents.pileups;
      candidate.extraPedestrianStrikes = incidents.pedestrianStrikes - baseIncidents.pedestrianStrikes;
      candidate.extraExited = result.exited - base.exited;
      candidates.push(candidate);
    }
  }
  const clean = candidates.filter((candidate) => candidate.ok && !candidate.jaywalkerWarning && candidate.committed);
  const good = clean.filter((candidate) => candidate.delta > 0 && candidate.extraIncidents <= 0 && candidate.extraPedestrianStrikes <= 0);
  row.counterfactual = {
    horizon: HORIZON,
    baselineValue: Number(base.value.toFixed(4)),
    baselineNewIncidents: baseIncidents.count - baseIncidentsBefore.count,
    dryRunOk: candidates.filter((candidate) => candidate.ok).length,
    clean: clean.length,
    good: good.length,
    bestDelta: good.length === 0 ? 0 : Math.max(...good.map((candidate) => candidate.delta)),
    best: good.sort((left, right) => right.delta - left.delta).slice(0, 3),
    rejectReasons: Object.entries(candidates.filter((c) => !c.ok).reduce((acc, c) => ({ ...acc, [c.reason]: (acc[c.reason] ?? 0) + 1 }), {})),
  };
  out.push(row);
}

const target = join('results', 'log-replay', run.id, HORIZON === 20 ? 'cf-eval.json' : `cf-eval-h${HORIZON}.json`);
writeFileSync(target, JSON.stringify({ run: run.id, version: run.version, horizon: HORIZON, cycles: out }, null, 2));
const faithful = out.filter((row) => row.faithful).length;
const holds = out.filter((row) => row.held && row.counterfactual);
console.log(`${run.id}: cycles=${out.length} faithful=${faithful} toolMismatchCycles=${out.filter((row) => row.toolMismatches > 0).length} holds=${holds.length} holdsWithGoodBatch=${holds.filter((row) => row.counterfactual.good > 0).length}`);
