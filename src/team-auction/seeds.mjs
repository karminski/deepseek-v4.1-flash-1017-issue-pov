import { GOOD_GAIN_SHARE } from './constants.mjs';
import { afterActionGain, candidateActions, dangerWindows, idleGain, trapKind } from './analysis.mjs';
import { applyAction, cloneState, createState, lotById, onClock, step, watching } from './engine.mjs';
import { generateWorld } from './lots.mjs';
import { delegateAll, doNothing, guard, neverDelegate, oracle, runPolicy } from './policies.mjs';

// Only the calm member gets authorizations, so aggressive members act on their own while money is reserved.
export function delegateCalm(world, state) {
  const actions = [];
  for (const [id, m] of Object.entries(state.members)) {
    if (m.auth || m.temperament !== 'calm') continue;
    const lotId = watching(world, state, id);
    const lot = lotId ? lotById(world, lotId) : null;
    if (lot && onClock(world, state, lot)) actions.push({ type: 'authorize', member: id, lot: lot.id, max: Math.round(0.6 * lot.mid) });
  }
  return actions;
}

function replay(world, actionsByTick) {
  const state = createState(world);
  const states = [];
  for (const { actions } of actionsByTick) {
    states.push(cloneState(state));
    for (const action of actions) applyAction(world, state, action);
    step(world, state);
  }
  return states;
}

function trapTicks(world, guardRun, threshold) {
  const traps = [];
  for (const state of replay(world, guardRun.actionsByTick)) {
    const base = idleGain(world, state);
    for (const candidate of candidateActions(world, state)) {
      const kind = trapKind(world, state, candidate);
      if (!kind) continue;
      const gain = afterActionGain(world, state, candidate.actions);
      const evGain = afterActionGain(world, state, candidate.actions, { estimate: true });
      const evBase = idleGain(world, state, { estimate: true });
      if (gain - base >= threshold && evGain - evBase > 0) {
        traps.push({ tick: state.tick, kind, delta: gain - base });
        break;
      }
    }
  }
  return traps;
}

function waitShare(world, plan) {
  const actedTicks = new Set(plan.map((p) => p.tick));
  let live = 0;
  let acted = 0;
  for (let t = 0; t < 40; t += 1) {
    if (!world.lots.some((lot) => lot.enter <= t && t < lot.withdraw)) continue;
    live += 1;
    if (actedTicks.has(t)) acted += 1;
  }
  return live ? 1 - acted / live : 1;
}

// DESIGN-team-auction.md 7.2, gains measured as score minus the starting pool.
const referenceCache = new Map();

// The beam search is not a strict upper bound, so the reference is the best of the beam and every reference policy.
export function references(world) {
  const key = `${world.seed}|${world.lots[0].id}`;
  if (referenceCache.has(key)) return referenceCache.get(key);
  const runs = {
    doNothing: runPolicy(world, doNothing),
    neverDelegate: runPolicy(world, neverDelegate),
    delegateAll: runPolicy(world, delegateAll),
    delegateCalm: runPolicy(world, delegateCalm),
    guard: runPolicy(world, guard),
  };
  let best = oracle(world);
  for (const run of Object.values(runs)) {
    if (run.gain > best.gain) best = { gain: run.gain, plan: run.actionsByTick.filter((row) => row.actions.length > 0) };
  }
  const refs = { best, runs };
  referenceCache.set(key, refs);
  return refs;
}

export function inspectSeed(seed, { prefix = 'L' } = {}) {
  const world = generateWorld(seed, { prefix });
  const { best, runs } = references(world);
  const threshold = GOOD_GAIN_SHARE * best.gain;
  const guardWindows = dangerWindows(runs.guard.history, runs.guard.state.events);
  const traps = trapTicks(world, runs.guard, threshold);
  const share = waitShare(world, best.plan);
  const rogueLoss = runs.doNothing.state.events
    .filter((e) => e.type === 'ROGUE_PURCHASE')
    .reduce((sum, e) => sum + e.price + e.fine - lotById(world, e.lot).value, 0);
  const checks = {
    dangerWindows: guardWindows.length >= 3,
    cascade: runs.delegateCalm.state.cancels >= 1,
    calmGivesUp: runs.neverDelegate.state.events.some((e) => e.type === 'GAVE_UP' && e.reason === 'calm'),
    traps: new Set(traps.map((t) => t.tick)).size >= 2 && traps.some((t) => t.kind === 'T1') && traps.some((t) => t.kind === 'T2'),
    waitAndAct: share >= 0.5 && share <= 0.85,
    neverDelegateWorse: runs.neverDelegate.gain <= 0.8 * best.gain,
    delegateAllWorse: runs.delegateAll.gain <= 0.85 * best.gain,
    guardBetter: runs.guard.gain >= runs.neverDelegate.gain + 0.15 * best.gain,
    rogueCostly: rogueLoss >= 0.2 * best.gain,
  };
  return {
    seed,
    ok: Object.values(checks).every(Boolean),
    checks,
    oracle: best.gain,
    oraclePlan: best.plan,
    gains: Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, r.gain])),
    guardWindows: guardWindows.length,
    cascades: runs.delegateCalm.state.cancels,
    traps,
    waitShare: share,
    rogueLoss,
  };
}

export function findAcceptedSeeds({ count = 10, start = 201, maxScan = 200 } = {}) {
  const seeds = [];
  for (let seed = start; seed < start + maxScan && seeds.length < count; seed += 1) {
    if (inspectSeed(seed).ok) seeds.push(seed);
  }
  return seeds;
}

// Locked from the first ten accepted seeds in 201..; selftest re-runs inspectSeed on each.
export const SMOKE_SEEDS = [205, 212];
export const SEEDS = [214, 218, 219, 247, 248, 261, 285, 293];
