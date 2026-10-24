import { CANCEL_FEE, POOL_START, ROGUE_FINE, TICKS } from './constants.mjs';
import { priceAt } from './lots.mjs';

// Events that move money out of the pool; only these cut a wait short.
export const MONEY_EVENTS = new Set(['SOLD', 'ROGUE_PURCHASE', 'ORDER_CANCELLED']);

export function createState(world) {
  const members = {};
  for (const m of world.members) {
    members[m.id] = { temperament: m.temperament, patience: m.base, pos: 0, override: null, auth: null };
  }
  const state = {
    tick: 0,
    total: POOL_START,
    sold: {},
    members,
    seq: 0,
    fines: 0,
    fees: 0,
    rogue: 0,
    cancels: 0,
    events: [],
    done: false,
  };
  for (const id of Object.keys(members)) normalizeWatch(world, state, id);
  return state;
}

export function cloneState(state, { keepEvents = false } = {}) {
  const members = {};
  for (const [id, m] of Object.entries(state.members)) {
    members[id] = { ...m, auth: m.auth ? { ...m.auth } : null };
  }
  return {
    ...state,
    sold: { ...state.sold },
    members,
    events: keepEvents ? state.events.map((e) => ({ ...e })) : [],
  };
}

export const lotById = (world, id) => world.lots.find((lot) => lot.id === id) ?? null;
const memberStatic = (world, id) => world.members.find((m) => m.id === id);

export function lotStatus(world, state, lot, tick = state.tick) {
  if (state.sold[lot.id]) return 'sold';
  if (tick < lot.enter) return 'upcoming';
  if (tick < lot.withdraw) return 'on_clock';
  return 'withdrawn';
}

export const onClock = (world, state, lot) => lotStatus(world, state, lot) === 'on_clock';
export const currentPrice = (world, state, lot) => (onClock(world, state, lot) ? priceAt(lot, state.tick) : null);

export function reserved(state) {
  let sum = 0;
  for (const m of Object.values(state.members)) if (m.auth) sum += m.auth.max;
  return sum;
}

export const available = (state) => state.total - reserved(state);

// An authorization that cannot fill before withdrawal does not calm the member.
export function canFill(world, auth) {
  if (!auth) return false;
  const lot = lotById(world, auth.lot);
  return priceAt(lot, lot.withdraw - 1) <= auth.max;
}

export const calmedBy = (world, m) => Boolean(m.auth) && canFill(world, m.auth);

export function watching(world, state, id) {
  const m = state.members[id];
  return m.override ?? memberStatic(world, id).list[m.pos] ?? null;
}

const isGone = (world, state, lotId) => {
  const status = lotStatus(world, state, lotById(world, lotId));
  return status === 'sold' || status === 'withdrawn';
};

function normalizeWatch(world, state, id) {
  const m = state.members[id];
  const list = memberStatic(world, id).list;
  for (;;) {
    if (m.override) {
      if (!isGone(world, state, m.override)) return;
      m.override = null;
      continue;
    }
    if (m.pos >= list.length || !isGone(world, state, list[m.pos])) return;
    m.pos += 1;
  }
}

function moveOn(world, state, id, reset) {
  const m = state.members[id];
  if (m.override) m.override = null;
  else m.pos += 1;
  normalizeWatch(world, state, id);
  if (reset) m.patience = memberStatic(world, id).base;
}

function emit(state, event, log) {
  if (log) state.events.push(event);
  return event;
}

function sell(world, state, lot, buyer, via, price) {
  state.sold[lot.id] = { buyer, via, price, tick: state.tick };
  const lapsed = [];
  for (const [id, m] of Object.entries(state.members)) {
    if (m.auth?.lot === lot.id && id !== buyer) {
      m.auth = null;
      lapsed.push(id);
    }
  }
  return lapsed;
}

function normalizeAll(world, state) {
  for (const id of Object.keys(state.members)) normalizeWatch(world, state, id);
}

function cancelUncovered(world, state, log, out) {
  while (state.total < reserved(state)) {
    let latestId = null;
    for (const [id, m] of Object.entries(state.members)) {
      if (m.auth && (latestId === null || m.auth.seq > state.members[latestId].auth.seq)) latestId = id;
    }
    if (latestId === null) return;
    const m = state.members[latestId];
    const lot = m.auth.lot;
    const max = m.auth.max;
    m.auth = null;
    state.total -= CANCEL_FEE;
    state.fees += CANCEL_FEE;
    state.cancels += 1;
    m.temperament = 'aggressive';
    m.patience = 2;
    out.push(emit(state, { tick: state.tick, type: 'ORDER_CANCELLED', member: latestId, lot, maxPrice: max, fee: CANCEL_FEE }, log));
  }
}

// Advance one tick. `members: false` freezes patience and member initiative (used by pool_check projections).
export function step(world, state, { members = true, log = true } = {}) {
  const out = [];
  if (state.done) return out;
  state.tick += 1;
  if (state.tick >= TICKS) {
    state.done = true;
    for (const m of Object.values(state.members)) m.auth = null;
    return out;
  }
  const t = state.tick;

  for (const lot of world.lots) {
    if (lot.withdraw === t && !state.sold[lot.id]) {
      const lapsed = [];
      for (const [id, m] of Object.entries(state.members)) {
        if (m.auth?.lot === lot.id) {
          m.auth = null;
          lapsed.push(id);
        }
      }
      out.push(emit(state, { tick: t, type: 'WITHDRAWN', lot: lot.id, lapsedOrders: lapsed }, log));
    }
  }
  normalizeAll(world, state);

  for (const id of Object.keys(state.members)) {
    const m = state.members[id];
    if (!m.auth) continue;
    const lot = lotById(world, m.auth.lot);
    if (!onClock(world, state, lot)) continue;
    const price = priceAt(lot, t);
    if (price > m.auth.max) continue;
    const max = m.auth.max;
    m.auth = null;
    state.total -= price;
    const lapsed = sell(world, state, lot, id, 'authorized', price);
    out.push(emit(state, { tick: t, type: 'SOLD', lot: lot.id, buyer: id, via: 'authorized', price, maxPrice: max, lapsedOrders: lapsed }, log));
    moveOn(world, state, id, true);
  }
  normalizeAll(world, state);

  if (members) {
    for (const id of Object.keys(state.members)) {
      const m = state.members[id];
      if (calmedBy(world, m)) continue;
      const lotId = watching(world, state, id);
      if (lotId && onClock(world, state, lotById(world, lotId))) m.patience = Math.max(0, m.patience - 1);
    }
    for (const id of Object.keys(state.members)) {
      const m = state.members[id];
      if (calmedBy(world, m) || m.patience > 0) continue;
      const lotId = watching(world, state, id);
      if (!lotId) continue;
      const lot = lotById(world, lotId);
      if (!onClock(world, state, lot)) continue;
      if (m.auth) {
        out.push(emit(state, { tick: t, type: 'ORDER_DROPPED', member: id, lot: m.auth.lot, maxPrice: m.auth.max }, log));
        m.auth = null;
      }
      const price = priceAt(lot, t);
      if (m.temperament === 'aggressive' && state.total >= price + ROGUE_FINE) {
        state.total -= price + ROGUE_FINE;
        state.fines += ROGUE_FINE;
        state.rogue += 1;
        const lapsed = sell(world, state, lot, id, 'own initiative', price);
        out.push(
          emit(state, { tick: t, type: 'ROGUE_PURCHASE', lot: lot.id, buyer: id, price, fine: ROGUE_FINE, lapsedOrders: lapsed }, log),
        );
        moveOn(world, state, id, true);
        cancelUncovered(world, state, log, out);
      } else {
        out.push(
          emit(state, { tick: t, type: 'GAVE_UP', member: id, lot: lot.id, reason: m.temperament === 'calm' ? 'calm' : 'pool too low' }, log),
        );
        moveOn(world, state, id, true);
      }
      normalizeAll(world, state);
    }
  }
  return out;
}

export function runToEnd(world, state, opts = {}) {
  while (!state.done) step(world, state, opts);
  return state;
}

export function applyAction(world, state, action) {
  if (state.done) return { ok: false, error: 'SESSION_ENDED' };
  const type = action?.type;
  if (type === 'bid') {
    const lot = lotById(world, String(action.lot ?? ''));
    if (!lot) return { ok: false, error: 'UNKNOWN_LOT' };
    if (!onClock(world, state, lot)) return { ok: false, error: 'LOT_NOT_ON_CLOCK' };
    const price = priceAt(lot, state.tick);
    if (available(state) < price) return { ok: false, error: 'INSUFFICIENT_AVAILABLE_FUNDS', price, available: available(state) };
    state.total -= price;
    const lapsed = sell(world, state, lot, 'lead', 'lead bid', price);
    normalizeAll(world, state);
    emit(state, { tick: state.tick, type: 'SOLD', lot: lot.id, buyer: 'lead', via: 'lead bid', price, lapsedOrders: lapsed }, true);
    return { ok: true, lot: lot.id, price, trueValue: lot.value, lapsedOrders: lapsed };
  }
  if (type === 'authorize') {
    const id = String(action.member ?? '');
    const m = state.members[id];
    if (!m) return { ok: false, error: 'UNKNOWN_MEMBER' };
    if (m.auth) return { ok: false, error: 'MEMBER_ALREADY_AUTHORIZED', hint: 'revoke first' };
    const lot = lotById(world, String(action.lot ?? ''));
    if (!lot) return { ok: false, error: 'UNKNOWN_LOT' };
    if (!onClock(world, state, lot)) return { ok: false, error: 'LOT_NOT_ON_CLOCK' };
    const max = Number(action.max);
    if (!Number.isFinite(max) || max <= 0) return { ok: false, error: 'INVALID_MAX_PRICE' };
    if (available(state) < max) return { ok: false, error: 'INSUFFICIENT_AVAILABLE_FUNDS', needed: max, available: available(state) };
    if (watching(world, state, id) !== lot.id) m.override = lot.id;
    state.seq += 1;
    m.auth = { lot: lot.id, max, seq: state.seq };
    const price = priceAt(lot, state.tick);
    if (price <= max) {
      m.auth = null;
      state.total -= price;
      const lapsed = sell(world, state, lot, id, 'authorized', price);
      emit(state, { tick: state.tick, type: 'SOLD', lot: lot.id, buyer: id, via: 'authorized', price, maxPrice: max, lapsedOrders: lapsed }, true);
      moveOn(world, state, id, true);
      normalizeAll(world, state);
      return { ok: true, filledNow: true, price, trueValue: lot.value };
    }
    return { ok: true, reserved: max, available: available(state) };
  }
  if (type === 'revoke') {
    const id = String(action.member ?? '');
    const m = state.members[id];
    if (!m) return { ok: false, error: 'UNKNOWN_MEMBER' };
    if (!m.auth) return { ok: false, error: 'NO_AUTHORIZATION' };
    const lot = m.auth.lot;
    m.auth = null;
    if (watching(world, state, id) !== lot) m.override = lot;
    return { ok: true, released: lot, available: available(state) };
  }
  return { ok: false, error: 'UNKNOWN_ACTION' };
}

// pool_check: apply a plan on a copy, then project every authorization with members frozen.
export function poolCheck(world, state, plan) {
  const copy = cloneState(state);
  const steps = [];
  for (const action of plan) {
    const result = applyAction(world, copy, action);
    steps.push({ action, ...result, availableAfter: available(copy) });
  }
  const pending = Object.entries(copy.members)
    .filter(([, m]) => m.auth)
    .map(([id, m]) => ({ member: id, lot: m.auth.lot, maxPrice: m.auth.max }));
  const projection = pending.map((row) => ({ ...row, fills: false }));
  const probe = cloneState(copy);
  while (!probe.done) {
    for (const event of step(world, probe, { members: false, log: false })) {
      if (event.type !== 'SOLD') continue;
      const row = projection.find((p) => p.member === event.buyer && p.lot === event.lot && !p.fills);
      if (row) Object.assign(row, { fills: true, fillTick: event.tick, fillPrice: event.price });
    }
  }
  for (const row of projection) if (!row.fills) row.reason = 'does not fill before the lot is withdrawn or the auction ends';
  return { steps, availableAfter: available(copy), projection };
}

export function teamValue(world, state, { estimate = false } = {}) {
  let goods = 0;
  for (const id of Object.keys(state.sold)) {
    const lot = lotById(world, id);
    goods += estimate ? lot.mid : lot.value;
  }
  return state.total + goods;
}

export const gainOf = (world, state, opts) => teamValue(world, state, opts) - POOL_START;
