import {
  BASE_FEE,
  BUDGET,
  DRAWS,
  ITEMS,
  checkout,
  distinctProducts,
  drawsLeft,
  newState,
  openBox,
  returnBox,
  scoredItems,
} from './engine.mjs';

function* combinations(n, k, start = 0, prefix = []) {
  if (prefix.length === k) {
    yield prefix;
    return;
  }
  for (let i = start; i <= n - (k - prefix.length); i += 1) yield* combinations(n, k, i + 1, [...prefix, i]);
}

// Hindsight best over target sets, deciding every other box on the spot (keep if cheaper than the fee).
export function hindsight(sequence, { strictCategories = false } = {}) {
  let best = { score: 0, picks: [] };
  for (const picks of combinations(sequence.length, ITEMS)) {
    const items = picks.map((i) => sequence[i]);
    if (new Set(items.map((x) => x.sku)).size < ITEMS) continue;
    if (strictCategories && new Set(items.map((x) => x.category)).size < ITEMS) continue;
    if (items.reduce((sum, x) => sum + x.kcal, 0) <= best.score) continue;
    if (items.reduce((sum, x) => sum + x.price, 0) > BUDGET) continue;
    const s = newState(sequence);
    const wanted = new Set(picks);
    let feasible = true;
    for (let i = 0; i <= picks[ITEMS - 1] && feasible; i += 1) {
      const r = openBox(s);
      if (wanted.has(i)) feasible = !r.autoReturned;
      else if (!r.autoReturned && !r.sealed && r.item.price > s.fee) returnBox(s, r.item.id);
    }
    if (!feasible) continue;
    const result = checkout(s);
    if (result.score > best.score) best = { score: result.score, picks };
  }
  return best;
}

const RESERVE_PER_ITEM = 15;
const UPGRADE_MARGIN = 150;
const threshold = (slack) => (slack >= 10 ? 600 : slack >= 6 ? 450 : slack >= 3 ? 300 : 0);

/**
 * Online threshold policy. Options model the readings under test:
 * strictCategories (A1 strict), swap (A2 loose), feesFromBudget=false (A3 loose),
 * drawsRefunded (A4 loose), staleFee (ignores the fee notice).
 */
export function runPolicy(sequence, opts = {}) {
  const { strictCategories = false, swap = false, feesFromBudget = true, drawsRefunded = false, staleFee = false } = opts;
  const s = newState(sequence);
  const belief = { money: BUDGET, draws: DRAWS };
  const feeBelief = () => (staleFee ? BASE_FEE : s.fee);
  const trace = { forcedKeeps: 0, drawsOutIncomplete: 0 };

  const fits = (item, others, slack) => {
    if (others.some((c) => c.sku === item.sku)) return false;
    if (strictCategories) {
      if (others.some((c) => c.category === item.category)) return false;
      if (item.category === 'household') return item.price <= 10 || slack <= 2;
      return true;
    }
    return item.category !== 'household' || slack <= 1;
  };
  const doReturn = (item) => {
    const r = returnBox(s, item.id);
    if (r.error) return r;
    belief.money += item.price - (feesFromBudget ? feeBelief() : 0);
    if (drawsRefunded) belief.draws += 1;
    return r;
  };
  const cheaperToKeep = (item) => !strictCategories && feesFromBudget && item.price <= feeBelief();

  while (!s.done) {
    const need = ITEMS - distinctProducts(s.cart);
    if (need <= 0 && (!swap || drawsLeft(s) === 0 || s.money < 15)) {
      checkout(s);
      break;
    }
    const r = openBox(s);
    if (r.autoCheckout) {
      if (distinctProducts(s.cart) < ITEMS) trace.drawsOutIncomplete = 1;
      break;
    }
    belief.draws -= 1;
    if (r.autoReturned) {
      if (feesFromBudget) belief.money -= r.fee;
      continue;
    }
    belief.money -= r.item.price;
    if (r.sealed) continue;
    const item = r.item;
    const others = s.cart.filter((c) => c.id !== item.id);

    if (need <= 0) {
      const scored = scoredItems(others);
      const worst = scored[scored.length - 1];
      const upgrade =
        item.category !== 'household' && !others.some((c) => c.sku === item.sku) && item.kcal > worst.kcal + UPGRADE_MARGIN;
      if (upgrade) {
        const dropped = others.find((c) => c.id === worst.id);
        if (dropped && !dropped.sealed && dropped.price > feeBelief()) doReturn(dropped);
      } else if (!cheaperToKeep(item)) doReturn(item);
      continue;
    }

    if (drawsLeft(s) - (need - 1) <= 0) trace.forcedKeeps += 1;
    const reserve = (need - 1) * RESERVE_PER_ITEM;
    const affordableReturns = feesFromBudget
      ? Math.floor((belief.money - reserve) / feeBelief())
      : Number.POSITIVE_INFINITY;
    const slack = Math.min(belief.draws - (need - 1), affordableReturns);
    const keep = (fits(item, others, slack) && item.kcal >= threshold(slack)) || cheaperToKeep(item);
    opts.log?.push({ draw: s.drawsUsed, sku: item.sku, price: item.price, kcal: item.kcal, money: s.money, slack, keep });
    if (!keep) doReturn(item);
  }
  if (!s.done) checkout(s, 'auto');
  return {
    score: s.checkout.score,
    valid: s.checkout.valid,
    autoReturns: s.autoReturns,
    lateReturns: s.lateReturns,
    sealed: s.sealed,
    returns: s.returns,
    returnsAfterNotice: s.returnsAfterNotice,
    ...trace,
  };
}
