import { MAX_FRACTIONS } from './constants.mjs';
import { applyAll, candidateActions, idleGain, tickSnapshot } from './analysis.mjs';
import { applyAction, available, calmedBy, cloneState, createState, gainOf, lotById, onClock, poolCheck, step, watching } from './engine.mjs';
import { priceAt } from './lots.mjs';

export function runPolicy(world, policy) {
  const state = createState(world);
  const history = [tickSnapshot(world, state)];
  const actionsByTick = [];
  while (!state.done) {
    const actions = policy(world, state);
    const applied = [];
    for (const action of actions) if (applyAction(world, state, action).ok) applied.push(action);
    actionsByTick.push({ tick: state.tick, actions: applied });
    step(world, state);
    if (!state.done) history.push(tickSnapshot(world, state));
  }
  return { state, history, actionsByTick, gain: gainOf(world, state), evGain: gainOf(world, state, { estimate: true }) };
}

export const doNothing = () => [];

function bargainBids(world, state, threshold) {
  const actions = [];
  let avail = available(state);
  const lots = world.lots
    .filter((lot) => onClock(world, state, lot))
    .map((lot) => ({ lot, price: priceAt(lot, state.tick) }))
    .filter(({ lot, price }) => price <= threshold * lot.mid)
    .sort((a, b) => b.lot.mid - b.price - (a.lot.mid - a.price));
  for (const { lot, price } of lots) {
    if (avail < price) continue;
    actions.push({ type: 'bid', lot: lot.id });
    avail -= price;
  }
  return actions;
}

export const neverDelegate = (world, state) => bargainBids(world, state, 0.75);

export function delegateAll(world, state) {
  const actions = [];
  let avail = available(state);
  for (const [id, m] of Object.entries(state.members)) {
    if (m.auth) continue;
    const lotId = watching(world, state, id);
    const lot = lotId ? lotById(world, lotId) : null;
    if (!lot || !onClock(world, state, lot)) continue;
    const max = Math.round(0.75 * lot.mid);
    if (avail < max) continue;
    actions.push({ type: 'authorize', member: id, lot: lot.id, max });
    avail -= max;
  }
  return actions;
}

function cheapestFillingAuthorization(world, state, id, lot, prefix = []) {
  for (const f of MAX_FRACTIONS) {
    const max = Math.round(f * lot.mid);
    const plan = [...prefix, { type: 'authorize', member: id, lot: lot.id, max }];
    const check = poolCheck(world, state, plan);
    if (!check.steps.every((s) => s.ok)) continue;
    if (check.projection.some((row) => row.member === id && row.lot === lot.id && row.fills)) return plan;
  }
  return null;
}

// Closed-loop reference: protect aggressive members about to act, otherwise buy bargains.
export function guard(world, state) {
  const copy = cloneState(state);
  const actions = [];
  for (const [id, m] of Object.entries(copy.members)) {
    if (calmedBy(world, m) || m.temperament !== 'aggressive' || m.patience > 2) continue;
    const lotId = watching(world, copy, id);
    const lot = lotId ? lotById(world, lotId) : null;
    if (!lot || !onClock(world, copy, lot)) continue;
    if (m.auth) {
      applyAction(world, copy, { type: 'revoke', member: id });
      actions.push({ type: 'revoke', member: id });
    }
    let plan = cheapestFillingAuthorization(world, copy, id, lot);
    if (!plan) {
      const dead = poolCheck(world, copy, []).projection.filter((row) => !row.fills);
      for (const row of dead) {
        plan = cheapestFillingAuthorization(world, copy, id, lot, [{ type: 'revoke', member: row.member }]);
        if (plan) break;
      }
    }
    if (!plan && available(copy) >= priceAt(lot, copy.tick) && priceAt(lot, copy.tick) <= lot.hi) {
      plan = [{ type: 'bid', lot: lot.id }];
    }
    if (plan && applyAll(world, copy, plan)) actions.push(...plan);
  }
  for (const action of bargainBids(world, copy, 0.75)) {
    if (applyAction(world, copy, action).ok) actions.push(action);
  }
  return actions;
}

function signature(state) {
  const members = Object.entries(state.members)
    .map(([id, m]) => `${id}:${m.temperament[0]}${m.patience}/${m.pos}/${m.override ?? ''}/${m.auth ? `${m.auth.lot}@${m.auth.max}` : ''}`)
    .join(',');
  return `${state.total}|${Object.keys(state.sold).sort().join('.')}|${members}`;
}

function expand(world, beam, width) {
  const next = new Map();
  for (const node of beam) {
    const key = signature(node.state);
    if (!next.has(key)) next.set(key, node);
    for (const candidate of candidateActions(world, node.state)) {
      const copy = cloneState(node.state);
      if (!applyAll(world, copy, candidate.actions)) continue;
      const sig = signature(copy);
      if (next.has(sig)) continue;
      next.set(sig, { state: copy, value: idleGain(world, copy), plan: [...node.plan, { tick: copy.tick, actions: candidate.actions }] });
    }
  }
  return [...next.values()].sort((a, b) => b.value - a.value).slice(0, width);
}

// Reference upper bound: beam search over the same action grid the counterfactual uses, up to two moves per tick.
export function oracle(world, { width = 40 } = {}) {
  const start = createState(world);
  let beam = [{ state: start, value: idleGain(world, start), plan: [] }];
  let best = beam[0];
  while (!beam[0].state.done) {
    beam = expand(world, expand(world, beam, width), width);
    for (const node of beam) if (node.value > best.value) best = node;
    beam = beam.map((node) => {
      const copy = cloneState(node.state);
      step(world, copy, { log: false });
      return { ...node, state: copy };
    });
  }
  const final = beam.reduce((a, b) => (gainOf(world, a.state) >= gainOf(world, b.state) ? a : b));
  const plan = gainOf(world, final.state) >= best.value ? final.plan : best.plan;
  return { gain: Math.max(gainOf(world, final.state), best.value), plan };
}
