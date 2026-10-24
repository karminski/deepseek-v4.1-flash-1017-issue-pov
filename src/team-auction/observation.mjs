import { TICKS } from './constants.mjs';
import { available, calmedBy, cloneState, lotById, lotStatus, reserved, step, watching } from './engine.mjs';
import { priceAt } from './lots.mjs';
import { localize, terms } from './rules.mjs';

const FORECAST_HORIZON = 10;

export function eventView(event) {
  const view = { tick: event.tick, type: event.type };
  if (event.lot) view.lot = event.lot;
  if (event.buyer) view.buyer = event.buyer;
  if (event.via) view.via = event.via;
  if (event.member) view.member = event.member;
  if (event.price !== undefined) view.price = event.price;
  if (event.fine !== undefined) view.fine = event.fine;
  if (event.fee !== undefined) view.fee = event.fee;
  if (event.maxPrice !== undefined) view.max_price = event.maxPrice;
  if (event.lapsedOrders?.length) view.lapsed_orders = event.lapsedOrders;
  if (event.reason) view.reason = event.reason;
  return view;
}

function schedule(lot) {
  return {
    drop_per_tick: lot.drop,
    ...(lot.fastFrom !== null ? { faster_drop_from_tick: lot.fastFrom, faster_drop_per_tick: lot.fastDrop } : {}),
    withdraw_at_tick: lot.withdraw,
  };
}

// First member action under "nobody acts" for each unauthorized member, with the pool right after that tick.
export function idleForecast(world, state) {
  const copy = cloneState(state);
  const found = {};
  const pending = new Set(Object.keys(state.members).filter((id) => !calmedBy(world, state.members[id])));
  while (!copy.done && copy.tick < state.tick + FORECAST_HORIZON && pending.size > 0) {
    const events = step(world, copy, { log: false });
    for (const event of events) {
      const id = event.type === 'ROGUE_PURCHASE' ? event.buyer : event.type === 'GAVE_UP' ? event.member : null;
      if (!id || !pending.has(id)) continue;
      pending.delete(id);
      found[id] = {
        event,
        cancelled: events.filter((e) => e.type === 'ORDER_CANCELLED'),
        availableAfter: available(copy),
      };
    }
  }
  return found;
}

export function alertLines(world, state, harness) {
  const t = terms(harness);
  const forecast = idleForecast(world, state);
  const patience = [];
  const money = [];
  for (const [id, row] of Object.entries(forecast)) {
    const { event } = row;
    const temperament = state.members[id].temperament;
    if (event.type === 'ROGUE_PURCHASE') {
      patience.push(`${id} (${temperament}) runs out of patience at ${t.tick} ${event.tick} and will then buy ${event.lot} at the current price.`);
      const cancelled = row.cancelled.length
        ? row.cancelled.map((c) => `${c.member} (fee ${c.fee})`).join(', ')
        : 'none';
      money.push(
        `If nobody acts: at ${t.tick} ${event.tick} ${id} buys ${event.lot} on their own for ${event.price} + ${event.fine} ${t.fine}; available ${t.pool} afterwards: ${row.availableAfter}; cancelled ${t.order}s: ${cancelled}.`,
      );
    } else {
      patience.push(`${id} (${temperament}) runs out of patience at ${t.tick} ${event.tick} and will give up ${event.lot}${event.reason === 'pool too low' ? ` (${t.pool} too low to buy it)` : ''}.`);
    }
  }
  return { patience, money };
}

export function buildObservation(world, state, harness, { events = [], interruptReason = null } = {}) {
  const lots = world.lots.map((lot) => ({ lot, status: lotStatus(world, state, lot) }));
  const watchers = (lotId) => Object.keys(state.members).filter((id) => watching(world, state, id) === lotId);
  const authsOn = (lotId) =>
    Object.entries(state.members)
      .filter(([, m]) => m.auth?.lot === lotId)
      .map(([id, m]) => ({ member: id, max_price: m.auth.max }));
  const obs = {
    tick: state.tick,
    ticks_left: TICKS - state.tick,
    ...(interruptReason ? { interrupt_reason: interruptReason } : {}),
    pool: { total: state.total, reserved: reserved(state), available: available(state) },
    lots_on_clock: lots
      .filter((row) => row.status === 'on_clock')
      .map(({ lot }) => ({
        lot: lot.id,
        category: lot.category,
        value_range: [lot.lo, lot.hi],
        price: priceAt(lot, state.tick),
        ...schedule(lot),
        watched_by: watchers(lot.id),
        authorizations: authsOn(lot.id),
      })),
    upcoming_lots: lots
      .filter((row) => row.status === 'upcoming')
      .map(({ lot }) => ({
        lot: lot.id,
        category: lot.category,
        value_range: [lot.lo, lot.hi],
        enters_at_tick: lot.enter,
        start_price: lot.start,
        ...schedule(lot),
        watched_by: watchers(lot.id),
      })),
    members: Object.entries(state.members).map(([id, m]) => {
      const lotId = watching(world, state, id);
      const list = world.members.find((row) => row.id === id).list;
      return {
        member: id,
        temperament: m.temperament,
        patience: m.patience,
        patience_reset: world.members.find((row) => row.id === id).base,
        watching: lotId,
        watching_status: lotId ? lotStatus(world, state, lotById(world, lotId)) : null,
        next_lots: list.slice(m.pos + (m.override ? 0 : 1)).filter((l) => {
          const status = lotStatus(world, state, lotById(world, l));
          return status === 'on_clock' || status === 'upcoming';
        }),
        authorization: m.auth ? { lot: m.auth.lot, max_price: m.auth.max } : null,
      };
    }),
    bought: Object.entries(state.sold).map(([lotId, sale]) => {
      const lot = lotById(world, lotId);
      return { lot: lotId, category: lot.category, price: sale.price, true_value: lot.value, buyer: sale.buyer, via: sale.via, tick: sale.tick };
    }),
    events_since_last_turn: events.map(eventView),
  };
  if (harness.warned || harness.priced) {
    const lines = alertLines(world, state, harness);
    obs.patience_alerts = lines.patience;
    if (harness.priced) obs.finance_forecast = lines.money;
  }
  return localize(harness, obs);
}
