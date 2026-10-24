import { MAX_ROUNDS_PER_TURN, MAX_TURNS, POOL_START, WAIT_MAX } from '../team-auction/constants.mjs';
import { tickSnapshot } from '../team-auction/analysis.mjs';
import { MONEY_EVENTS, applyAction, cloneState, createState, poolCheck, step, teamValue } from '../team-auction/engine.mjs';
import { generateWorld } from '../team-auction/lots.mjs';
import { episodeMetrics } from '../team-auction/metrics.mjs';
import { buildObservation, eventView } from '../team-auction/observation.mjs';
import { canonicalArgs, canonicalPlanAction, canonicalToolName, localize, systemPrompt, toolDefinitions } from '../team-auction/rules.mjs';
import { SEEDS, references } from '../team-auction/seeds.mjs';

export { SEEDS as seeds };

export const id = 'team-auction';
export const hypothesis =
  'H1: the model foresees a member about to buy on their own and still does not intervene. ' +
  'H2: it treats an after-the-fact notification as protection and waits. ' +
  'H3: once it judges an action infeasible in its head it does not test that judgement. ' +
  'H0: it weighs costs that are written down but does not derive the implicit cost of not acting.';
export const primaryMetric = { key: 'gain', higherIsBetter: true };
export const summaryKeys = [
  'gain',
  'oracleGain',
  'optimality',
  'rogue',
  'cancels',
  'finesFees',
  'windows',
  'windowsPrevented',
  'windowsNamed',
  'windowsNamedRogue',
  'windowWaitTurns',
  'windowNoticeCites',
  'holdTurns',
  'holdGood',
  'claims',
  'claimsChecked',
  'claimsUnchecked',
  'claimsUncheckedWrong',
  'poolChecks',
  'turns',
  'implicitWaits',
];

function describe(event) {
  if (event.type === 'ROGUE_PURCHASE') return `ROGUE_PURCHASE ${event.buyer} bought ${event.lot} for ${event.price} + ${event.fine} fine`;
  if (event.type === 'ORDER_CANCELLED') return `ORDER_CANCELLED ${event.member} on ${event.lot}, fee ${event.fee}`;
  return `SOLD ${event.lot} to ${event.buyer} for ${event.price}`;
}

export function create({ seed, harness = {} }) {
  const world = generateWorld(seed, { prefix: harness.relabel ? 'I' : 'L' });
  const refs = references(world);
  const state = createState(world);
  const history = [tickSnapshot(world, state)];
  const turns = [];
  let seenEvents = 0;
  let interruptReason = null;
  let current = null;

  function advance(n, { interruptible }) {
    let waited = 0;
    let reason = null;
    while (waited < n && !state.done) {
      const events = step(world, state);
      waited += 1;
      if (!state.done) history.push(tickSnapshot(world, state));
      const money = events.find((e) => MONEY_EVENTS.has(e.type));
      if (interruptible && money) {
        reason = describe(money);
        break;
      }
    }
    return { waited, reason };
  }

  function endTurn(kind, n) {
    const { waited, reason } = advance(n, { interruptible: !harness.noNotice });
    Object.assign(current, { end: kind, waitN: n, waited, interrupted: reason });
    interruptReason = reason;
    return { waited, reason };
  }

  function act(type, args) {
    const { lot, member, max } = canonicalArgs(harness, args);
    const result = applyAction(world, state, { type, lot, member, max });
    current.actions.push({ type, lot, member, max, ok: result.ok, error: result.error ?? null });
    return { content: localize(harness, toContent(result)) };
  }

  function toContent(result) {
    const out = {};
    for (const [k, v] of Object.entries(result)) {
      const key = { trueValue: 'true_value', lapsedOrders: 'lapsed_orders', filledNow: 'filled_now', availableAfter: 'available_after' }[k] ?? k;
      out[key] = v;
    }
    return out;
  }

  function handleCall(name, args) {
    if (state.done) return { content: localize(harness, { error: 'SESSION_ENDED' }), endCycle: true };
    const tool = canonicalToolName(harness, name);
    current.calls.push(name);
    if (tool === 'bid' || tool === 'authorize' || tool === 'revoke') return act(tool, args);
    if (tool === 'pool_check' && !harness.noCheck) {
      current.poolChecks += 1;
      const plan = Array.isArray(args?.plan) ? args.plan.map((entry) => canonicalPlanAction(harness, entry)) : [];
      const check = poolCheck(world, state, plan);
      return {
        content: localize(harness, {
          steps: check.steps.map((s) => ({
            action: s.action.type,
            ...(s.action.lot ? { lot: s.action.lot } : {}),
            ...(s.action.member ? { member: s.action.member } : {}),
            ...(s.action.max !== undefined ? { max_price: s.action.max } : {}),
            ok: s.ok,
            ...(s.error ? { error: s.error } : {}),
            ...(s.price !== undefined ? { price: s.price } : {}),
            available_after: s.availableAfter,
          })),
          available_after: check.availableAfter,
          projection: check.projection.map((row) => ({
            member: row.member,
            lot: row.lot,
            max_price: row.maxPrice,
            fills: row.fills,
            ...(row.fills ? { fill_tick: row.fillTick, fill_price: row.fillPrice } : { reason: row.reason }),
          })),
          note: 'Projection assumes nobody else acts.',
        }),
      };
    }
    if (tool === 'wait') {
      const n = Math.min(WAIT_MAX, Math.max(1, Math.round(Number(args?.n) || 1)));
      const { waited, reason } = endTurn('wait', n);
      const content = { waited_ticks: waited, tick: state.tick, ...(reason ? { interrupted_by: reason } : {}), ...(state.done ? { ended: true } : {}) };
      return { content: localize(harness, content), endCycle: true };
    }
    if (tool === 'finish') {
      endTurn('finish', Number.POSITIVE_INFINITY);
      return { content: localize(harness, { finished: true, team_value: teamValue(world, state) }), endCycle: true };
    }
    return { content: { error: `UNKNOWN_TOOL ${name}` } };
  }

  function onAssistant({ reasoning, content }) {
    if (current) current.reasoning += `\n${reasoning ?? ''}\n${content ?? ''}`;
  }

  function onCycleTimeout() {
    if (current && !current.end && !state.done) {
      endTurn('implicit', 1);
    }
  }

  function nextCycle() {
    if (state.done || turns.length >= MAX_TURNS) return null;
    const events = state.events.slice(seenEvents);
    seenEvents = state.events.length;
    current = {
      index: turns.length + 1,
      tick: state.tick,
      snapshot: cloneState(state),
      reasoning: '',
      calls: [],
      actions: [],
      poolChecks: 0,
      end: null,
      waitN: null,
      waited: 0,
      interrupted: null,
    };
    turns.push(current);
    const obs = buildObservation(world, state, harness, { events, interruptReason });
    interruptReason = null;
    return JSON.stringify({ observation: obs });
  }

  function metrics() {
    while (!state.done) {
      step(world, state);
      if (!state.done) history.push(tickSnapshot(world, state));
    }
    return episodeMetrics({ world, state, turns, history, refs, harness });
  }

  return {
    system: systemPrompt(harness),
    tools: toolDefinitions(harness),
    maxRoundsPerCycle: MAX_ROUNDS_PER_TURN,
    world,
    state,
    refs,
    turns,
    nextCycle,
    handleCall,
    onAssistant,
    onCycleTimeout,
    isDone: () => state.done,
    metrics,
    eventView,
    poolStart: POOL_START,
  };
}
