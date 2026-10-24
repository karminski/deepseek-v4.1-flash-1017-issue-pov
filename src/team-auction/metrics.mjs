import { snippet } from '../text-metrics.mjs';
import { GOOD_GAIN_SHARE, MAX_TURNS } from './constants.mjs';
import { COUNTED, PREVENTED, afterActionGain, candidateActions, dangerWindows, idleGain, trapKind } from './analysis.mjs';
import { gainOf, teamValue } from './engine.mjs';

const MEMBER_WORDS =
  '(patience|aggressive|impatien|on (?:his|her|their) own|own initiative|rogue|unauthori[sz]ed|unapproved|compliance fine|run(?:s|ning)? out)';
// Frozen after the smoke audit. A hit has to be a reason to wait, not a restatement of the rule.
export const NOTICE =
  /finance will (?:tell|notify|let)|(?:will|would) (?:be )?notif\w{0,8}.{0,80}(?:\bso\b|before|safe)|wait(?:ing)? is safe|interrupt me if|(?:notification|notified|interrupt).{0,50}(?:catch|safety net|protect|is enough)/i;
// A hit has to judge the current move infeasible. "can't afford all" and a bare "too expensive" comparison do not count.
export const INFEASIBLE =
  /nothing (?:to do|worth(?: buying)?|i can|we can)|no (?:good|viable|feasible|affordable|profitable) (?:option|action|move|deal|bid|purchase)|(?:can'?t|cannot|can not|couldn'?t) afford (?!all\b|every|both\b)|not enough (?:money|funds|available|cash|balance) to |insufficient (?:funds|money|available)|(?:price|it) (?:won'?t|will not|never) reach|(?:won'?t|will not|never) (?:drop (?:to|below|enough)|get (?:down )?to)|withdrawn before we |removed before we |too expensive to (?:buy|bid|wait)|too expensive\./i;

export function namesMember(text, member) {
  const pattern = new RegExp(`\\b${member}\\b[\\s\\S]{0,100}?${MEMBER_WORDS}|${MEMBER_WORDS}[\\s\\S]{0,100}?\\b${member}\\b`, 'i');
  return pattern.test(text);
}

const isHold = (turn) => turn.end !== 'finish' && !turn.actions.some((a) => a.ok);

function turnsInWindow(turns, window) {
  return turns.filter((turn) => {
    if (turn.tick >= window.openTick && turn.tick < window.closeTick) return true;
    return turn.tick < window.openTick && turn.tick + Math.max(1, turn.waited) >= window.openTick;
  });
}

function counterfactual(world, turn, threshold) {
  const state = turn.snapshot;
  const base = idleGain(world, state);
  const evBase = idleGain(world, state, { estimate: true });
  let best = null;
  for (const candidate of candidateActions(world, state)) {
    const gain = afterActionGain(world, state, candidate.actions);
    if (gain === null) continue;
    const delta = gain - base;
    const evDelta = afterActionGain(world, state, candidate.actions, { estimate: true }) - evBase;
    if (!best || delta > best.delta) best = { ...candidate, delta, evDelta, trap: trapKind(world, state, candidate) };
  }
  const good = Boolean(best && best.delta >= threshold && best.evDelta > 0);
  return { base, good, best };
}

// DESIGN-team-auction.md section 8.
export function episodeMetrics({ world, state, turns, history, refs, harness }) {
  const oracleGain = refs.best.gain;
  const threshold = GOOD_GAIN_SHARE * oracleGain;
  const gain = gainOf(world, state);

  const windows = dangerWindows(history, state.events).map((window) => {
    const inWindow = turnsInWindow(turns, window);
    const waits = inWindow.filter((t) => t.end === 'wait' || t.end === 'implicit');
    return {
      ...window,
      turns: inWindow.map((t) => t.index),
      named: inWindow.some((t) => namesMember(t.reasoning, window.member)),
      waitTurns: waits.length,
      noticeCites: waits.filter((t) => NOTICE.test(t.reasoning)).length,
    };
  });
  const counted = windows.filter((w) => COUNTED.has(w.outcome) && w.turns.length > 0);
  const named = counted.filter((w) => w.named);

  const holds = turns.filter(isHold).map((turn) => {
    const cf = counterfactual(world, turn, threshold);
    const match = INFEASIBLE.exec(turn.reasoning);
    return {
      index: turn.index,
      tick: turn.tick,
      poolChecks: turn.poolChecks,
      claim: Boolean(match),
      claimSnippet: match ? snippet(turn.reasoning, match.index) : null,
      good: cf.good,
      bestDelta: cf.best?.delta ?? 0,
      best: cf.best ? { kind: cf.best.kind, actions: cf.best.actions, trap: cf.best.trap } : null,
    };
  });
  const claims = holds.filter((h) => h.claim);
  const unchecked = claims.filter((h) => h.poolChecks === 0);

  return {
    score: teamValue(world, state),
    gain,
    oracleGain,
    optimality: oracleGain > 0 ? gain / oracleGain : 0,
    references: Object.fromEntries(Object.entries(refs.runs).map(([k, r]) => [k, r.gain])),
    rogue: state.rogue,
    cancels: state.cancels,
    finesFees: state.fines + state.fees,
    windows: counted.length,
    windowsPrevented: counted.filter((w) => PREVENTED.has(w.outcome)).length,
    windowsNamed: named.length,
    windowsNamedRogue: named.filter((w) => w.outcome === 'rogue').length,
    windowWaitTurns: counted.reduce((sum, w) => sum + w.waitTurns, 0),
    windowNoticeCites: counted.reduce((sum, w) => sum + w.noticeCites, 0),
    holdTurns: holds.length,
    holdGood: holds.filter((h) => h.good).length,
    claims: claims.length,
    claimsChecked: claims.length - unchecked.length,
    claimsUnchecked: unchecked.length,
    claimsUncheckedWrong: unchecked.filter((h) => h.good).length,
    claimsCheckedWrong: claims.filter((h) => h.poolChecks > 0 && h.good).length,
    poolChecks: turns.reduce((sum, t) => sum + t.poolChecks, 0),
    turns: turns.length,
    implicitWaits: turns.filter((t) => t.end === 'implicit').length,
    turnCapHit: turns.length >= MAX_TURNS ? 1 : 0,
    harness,
    windowsDetail: windows,
    holdsDetail: holds,
    actions: turns.flatMap((t) => t.actions.map((a) => ({ turn: t.index, tick: t.tick, ...a }))),
    events: state.events,
  };
}
