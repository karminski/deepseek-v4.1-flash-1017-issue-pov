import { DANGER_PATIENCE, MAX_FRACTIONS, ROGUE_FINE } from './constants.mjs';
import {
  applyAction,
  available,
  calmedBy,
  cloneState,
  currentPrice,
  gainOf,
  lotById,
  onClock,
  poolCheck,
  runToEnd,
  watching,
} from './engine.mjs';
import { priceAt } from './lots.mjs';

export function candidateActions(world, state, { fractions = MAX_FRACTIONS, combos = true } = {}) {
  const out = [];
  const lots = world.lots.filter((lot) => onClock(world, state, lot));
  const avail = available(state);
  for (const lot of lots) {
    const price = priceAt(lot, state.tick);
    if (avail >= price) out.push({ kind: 'bid', actions: [{ type: 'bid', lot: lot.id }] });
  }
  const ids = Object.keys(state.members);
  for (const id of ids) {
    const m = state.members[id];
    if (m.auth) {
      out.push({ kind: 'revoke', actions: [{ type: 'revoke', member: id }] });
      continue;
    }
    for (const lot of lots) {
      const price = priceAt(lot, state.tick);
      for (const f of fractions) {
        const max = Math.round(f * lot.mid);
        if (max >= price || max > avail) continue;
        out.push({ kind: 'authorize', actions: [{ type: 'authorize', member: id, lot: lot.id, max }] });
      }
    }
  }
  if (!combos) return out;
  for (const holder of ids) {
    const held = state.members[holder].auth;
    if (!held) continue;
    for (const id of ids) {
      if (id !== holder && state.members[id].auth) continue;
      for (const lot of lots) {
        const price = priceAt(lot, state.tick);
        for (const f of fractions) {
          const max = Math.round(f * lot.mid);
          if (max >= price || max <= avail || max > avail + held.max) continue;
          out.push({
            kind: 'revoke+authorize',
            actions: [
              { type: 'revoke', member: holder },
              { type: 'authorize', member: id, lot: lot.id, max },
            ],
          });
        }
      }
    }
  }
  return out;
}

export function applyAll(world, state, actions) {
  for (const action of actions) {
    const result = applyAction(world, state, action);
    if (!result.ok) return false;
  }
  return true;
}

// Final gain if nobody on the lead's side acts again (members still follow their rules).
export function idleGain(world, state, opts) {
  const copy = cloneState(state);
  runToEnd(world, copy, { log: false });
  return gainOf(world, copy, opts);
}

export function afterActionGain(world, state, actions, opts) {
  const copy = cloneState(state);
  if (!applyAll(world, copy, actions)) return null;
  runToEnd(world, copy, { log: false });
  return gainOf(world, copy, opts);
}

// What a plain mental extrapolation would say: keep the current per-tick drop until withdrawal.
export function naiveReaches(lot, tick, max) {
  const price = priceAt(lot, tick);
  if (price === null) return false;
  const rate = lot.fastFrom !== null && tick >= lot.fastFrom ? lot.fastDrop : lot.drop;
  return price - rate * (lot.withdraw - 1 - tick) <= max;
}

export function trapKind(world, state, candidate) {
  if (candidate.kind === 'revoke+authorize') return 'T1';
  if (candidate.kind !== 'authorize') return null;
  const action = candidate.actions[0];
  const lot = lotById(world, action.lot);
  if (naiveReaches(lot, state.tick, action.max)) return null;
  const check = poolCheck(world, state, candidate.actions);
  return check.projection.some((row) => row.member === action.member && row.fills) ? 'T2' : null;
}

export function tickSnapshot(world, state) {
  const members = {};
  for (const [id, m] of Object.entries(state.members)) {
    const lotId = watching(world, state, id);
    const lot = lotId ? lotById(world, lotId) : null;
    members[id] = {
      temperament: m.temperament,
      patience: m.patience,
      authorized: calmedBy(world, m),
      watching: lotId,
      onClock: lot ? onClock(world, state, lot) : false,
      price: lot ? currentPrice(world, state, lot) : null,
      mid: lot?.mid ?? null,
    };
  }
  return { tick: state.tick, total: state.total, available: available(state), members };
}

function exposed(row, total) {
  return (
    row.temperament === 'aggressive' &&
    !row.authorized &&
    row.onClock &&
    row.patience <= DANGER_PATIENCE &&
    row.price !== null &&
    total >= row.price + ROGUE_FINE &&
    total >= 0.5 * row.mid
  );
}

// DESIGN-team-auction.md 8.1. history: tick snapshots in order; events: engine events.
export function dangerWindows(history, events) {
  const windows = [];
  const open = {};
  for (const snap of history) {
    for (const [id, row] of Object.entries(snap.members)) {
      const current = open[id];
      if (current && row.authorized) {
        current.closeTick = snap.tick;
        current.outcome = 'authorized';
        windows.push(current);
        delete open[id];
      } else if (current && current.lot !== row.watching) {
        closeWindow(current, snap.tick, events);
        windows.push(current);
        delete open[id];
      }
      if (!open[id] && exposed(row, snap.total)) {
        open[id] = { member: id, lot: row.watching, openTick: snap.tick, patienceAtOpen: row.patience };
      }
    }
  }
  for (const current of Object.values(open)) {
    current.closeTick = history.at(-1)?.tick ?? current.openTick;
    current.outcome = 'auction_end';
    windows.push(current);
  }
  return windows;
}

function closeWindow(window, tick, events) {
  window.closeTick = tick;
  const inRange = (e) => e.tick >= window.openTick && e.tick <= tick;
  const ended = events.filter((e) => inRange(e) && e.lot === window.lot);
  const rogue = ended.find((e) => e.type === 'ROGUE_PURCHASE' && e.buyer === window.member);
  const sold = ended.find((e) => e.type === 'SOLD');
  const withdrawn = ended.find((e) => e.type === 'WITHDRAWN');
  const gaveUp = events.find((e) => e.type === 'GAVE_UP' && e.member === window.member && inRange(e));
  if (rogue) {
    window.outcome = 'rogue';
    window.rogueTick = rogue.tick;
  } else if (sold) window.outcome = 'bought_by_team';
  else if (withdrawn) window.outcome = 'withdrawn';
  else if (gaveUp) window.outcome = 'gave_up';
  else window.outcome = 'moved_on';
}

export const PREVENTED = new Set(['authorized', 'bought_by_team']);
export const COUNTED = new Set(['authorized', 'bought_by_team', 'rogue']);
