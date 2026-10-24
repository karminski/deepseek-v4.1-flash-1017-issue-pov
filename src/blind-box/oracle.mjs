import {
  DRAW_LIMIT,
  EXPENSIVE_PRICE,
  HEURISTIC_RATIO,
  TARGET_COUNT,
} from './constants.mjs';
import {
  autoCheckout,
  createState,
  drawsLeft,
  evaluateCart,
  itemsNeeded,
  openBox,
  returnBox,
} from './engine.mjs';

export function combinations(n, k) {
  const out = [];
  const cur = [];
  const rec = (start) => {
    if (cur.length === k) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i <= n - (k - cur.length); i += 1) {
      cur.push(i);
      rec(i + 1);
      cur.pop();
    }
  };
  rec(0);
  return out;
}

function nextNonKeep(keep, from, maxKeep) {
  for (let j = from; j <= maxKeep; j += 1) {
    if (!keep.has(j)) return j;
  }
  return null;
}

function dumpExtras(state, keep) {
  for (const item of [...state.cart]) {
    if (keep.has(item.index)) continue;
    if (item.sealed) return { ok: false, reason: 'cannot dump sealed extra' };
    const ret = returnBox(state, item.boxId);
    if (ret.error) return { ok: false, reason: ret.error };
  }
  const ev = evaluateCart(state);
  if (!ev.ok) return { ok: false, reason: ev.reasons.join('; ') };
  return {
    ok: true,
    score: ev.score,
    state,
    items: state.cart.map((item) => ({ index: item.index, ...item.sku, boxId: item.boxId })),
  };
}

export function realizeKeepSet(sequence, keepIndices, mode = 'late') {
  const keep = new Set(keepIndices);
  const maxKeep = Math.max(...keepIndices);
  const state = createState();
  const wouldSeal = () => (state.returns + 1) % 3 === 0;

  const flushSafe = (from) => {
    if (mode !== 'late') return { ok: true };
    for (const item of [...state.cart]) {
      if (keep.has(item.index)) continue;
      if (wouldSeal() && nextNonKeep(keep, from, maxKeep) !== null) break;
      if (item.sealed) return { ok: false, reason: 'cannot dump sealed extra' };
      const ret = returnBox(state, item.boxId);
      if (ret.error) return { ok: false, reason: ret.error };
    }
    return { ok: true };
  };

  for (let i = 0; i <= maxKeep; i += 1) {
    const opened = openBox(state, sequence[i]);
    const want = keep.has(i);
    if (opened.autoReturned) {
      if (want) return { ok: false, reason: 'auto-return of keep' };
      const flushed = flushSafe(i + 1);
      if (!flushed.ok) return flushed;
      continue;
    }
    if (want) {
      const flushed = flushSafe(i + 1);
      if (!flushed.ok) return flushed;
      continue;
    }
    if (opened.sealed) return { ok: false, reason: 'sealed non-keep' };

    const delay = mode === 'late' && wouldSeal() && nextNonKeep(keep, i + 1, maxKeep) !== null;
    if (!delay) {
      const ret = returnBox(state, opened.boxId);
      if (ret.error) return { ok: false, reason: ret.error };
    }
    const flushed = flushSafe(i + 1);
    if (!flushed.ok) return flushed;
  }

  return dumpExtras(state, keep);
}

export function bestPlan(sequence, { lateReturns = true, uniqueCategories = false } = {}) {
  let best = { ok: false, score: 0, keepIndices: [], items: [] };
  const modes = lateReturns ? ['late', 'immediate'] : ['immediate'];
  for (const combo of combinations(sequence.length, TARGET_COUNT)) {
    const ids = combo.map((i) => sequence[i].id);
    if (new Set(ids).size !== TARGET_COUNT) continue;
    if (uniqueCategories) {
      const cats = combo.map((i) => sequence[i].category);
      if (new Set(cats).size !== TARGET_COUNT) continue;
    }
    for (const mode of modes) {
      const realized = realizeKeepSet(sequence, combo, mode);
      if (realized.ok && realized.score > best.score) {
        best = { ok: true, score: realized.score, keepIndices: combo, items: realized.items, mode };
      }
    }
  }
  return best;
}

export function playOnline(sequence, decide) {
  const state = createState();
  for (let i = 0; i < sequence.length && !state.done; i += 1) {
    const opened = openBox(state, sequence[i]);
    if (opened.error || opened.autoReturned) continue;
    const action = decide(state, opened);
    if (action === 'keep' || !action) continue;
    if (action === 'return') returnBox(state, opened.boxId);
    else if (typeof action === 'string' && action.startsWith('return:')) {
      returnBox(state, action.slice(7));
    }
  }
  if (!state.done) autoCheckout(state);
  return { state, evaluation: state.checkout };
}

export function playGreedy(sequence) {
  return playOnline(sequence, (state, opened) => {
    if (opened.sealed) return 'keep';
    if (drawsLeft(state) <= itemsNeeded(state)) return 'keep';
    const sku = opened.sku;
    if (sku.calories === 0) return 'return';
    if (sku.calories / sku.price < HEURISTIC_RATIO) return 'return';
    if (state.cart.filter((item) => item.sku.id === sku.id).length > 1) return 'return';
    return 'keep';
  });
}

export function playLoose(sequence) {
  return playOnline(sequence, (_state, opened) => {
    if (opened.sealed) return 'keep';
    const sku = opened.sku;
    if (sku.calories < 250) return 'return';
    if (_state.cart.filter((item) => item.sku.id === sku.id).length > 1) return 'return';
    return 'keep';
  });
}

export function playHeuristic(sequence) {
  return playGreedy(sequence);
}

export function isJunkSku(sku) {
  return sku.calories === 0 || sku.price >= EXPENSIVE_PRICE;
}

const REF_CACHE = new Map();

export function references(sequence, cacheKey = null) {
  const key = cacheKey ?? sequence.map((sku) => sku.id).join(',');
  if (REF_CACHE.has(key)) return REF_CACHE.get(key);
  const oracle = bestPlan(sequence, { lateReturns: true, uniqueCategories: false });
  const strictCategory = bestPlan(sequence, { lateReturns: true, uniqueCategories: true });
  const immediate = bestPlan(sequence, { lateReturns: false, uniqueCategories: false });
  const heuristic = playHeuristic(sequence);
  const value = {
    oracle: oracle.score,
    oraclePlan: oracle,
    strictCategory: strictCategory.score,
    immediate: immediate.score,
    immediatePlan: immediate,
    heuristic: heuristic.evaluation?.score ?? 0,
    heuristicValid: heuristic.evaluation?.ok ? 1 : 0,
  };
  REF_CACHE.set(key, value);
  return value;
}
