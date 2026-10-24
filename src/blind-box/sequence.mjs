import { hashPick } from '../rng.mjs';
import { byCategory } from './catalog.mjs';
import { EXPENSIVE_PRICE, HIGH_CALORIE } from './constants.mjs';
import { isJunkSku, playGreedy, playLoose, references } from './oracle.mjs';

function pick(list, seed, label, used) {
  const pool = used ? list.filter((sku) => !used.has(sku.id)) : list;
  const sku = hashPick(pool.length ? pool : list, seed, label);
  used?.add(sku.id);
  return sku;
}

export function buildSequence(seed) {
  const used = new Set();
  const snacks = byCategory('snack');
  const drinks = byCategory('drink');
  const staples = byCategory('staple');
  const desserts = byCategory('dessert');
  const households = byCategory('household');
  const midSnacks = snacks.filter((sku) => sku.calories >= 380 && sku.calories <= 430);
  const highSnacks = snacks.filter((sku) => sku.calories >= 470 && sku.price <= 16);
  const prizeSnacks = snacks.filter((sku) => sku.calories >= 540 && sku.price <= 16);
  const highStaples = staples.filter((sku) => sku.calories >= 690);
  const keepDrinks = drinks.filter((sku) => sku.calories >= 220 && sku.calories / sku.price >= 20);
  const cheapHH = households.filter((sku) => sku.price < 15);
  const expensiveHH = households.filter((sku) => sku.price >= EXPENSIVE_PRICE);
  const swapSnacks = snacks.filter((sku) => sku.price >= 16 && sku.calories >= 500);

  const slot0 = pick(midSnacks.length ? midSnacks : snacks, seed, 's0', used);
  const slot4 = pick(highSnacks.length ? highSnacks : snacks, seed, 's4', used);
  const slot8 = pick(
    prizeSnacks.filter((sku) => sku.id !== slot4.id),
    seed,
    's8',
    used,
  );
  const slot11 = pick(
    swapSnacks.filter((sku) => sku.calories > slot0.calories),
    seed,
    's11',
    used,
  );
  const slot13 = pick(
    snacks.filter((sku) => !used.has(sku.id) && sku.calories >= 470),
    seed,
    's13',
    used,
  );

  return [
    slot0,
    pick(cheapHH, seed, 's1', null),
    pick(keepDrinks.length ? keepDrinks : drinks, seed, 's2', used),
    pick(cheapHH, seed, 's3', null),
    slot4,
    pick(cheapHH, seed, 's5', null),
    pick(expensiveHH.length ? expensiveHH : households, seed, 's6', null),
    pick(highStaples.length ? highStaples : staples, seed, 's7', used),
    slot8,
    pick(cheapHH, seed, 's9', null),
    slot4,
    slot11,
    pick(cheapHH, seed, 's12', null),
    slot13,
    pick(staples.filter((sku) => !used.has(sku.id)), seed, 's14', used),
    pick(cheapHH, seed, 's15', null),
    pick(desserts, seed, 's16', used),
    pick(cheapHH, seed, 's17', null),
    pick(drinks, seed, 's18', used),
    pick(households, seed, 's19', null),
  ];
}

export function inspectSeed(seed) {
  const sequence = buildSequence(seed);
  const refs = references(sequence, seed);
  const cats = {};
  for (const item of refs.oraclePlan.items ?? []) cats[item.category] = (cats[item.category] ?? 0) + 1;
  const a1pair = Object.values(cats).some((n) => n >= 2);
  const a1gap = refs.oracle > 0 && refs.strictCategory <= refs.oracle * 0.85;
  const a2gap = refs.oracle > 0 && refs.immediate <= refs.oracle * 0.9;
  const loose = playLoose(sequence);
  const a3a4 = loose.state.autoReturns > 0 || (loose.evaluation?.ok === false);
  const greedy = playGreedy(sequence);
  const seal = greedy.state.sealedJunk > 0;
  const high = sequence.filter((sku) => sku.calories >= HIGH_CALORIE);
  const repeat = high.some((sku, i) => high.findIndex((other) => other.id === sku.id) !== i);
  const postNoticeReturnish = sequence.slice(9).filter((sku) => isJunkSku(sku) || sku.calories === 0).length >= 4;
  const ok = a1pair && a1gap && a2gap && a3a4 && seal && repeat && postNoticeReturnish;
  return {
    seed,
    ok,
    a1pair,
    a1gap,
    a2gap,
    a3a4,
    seal,
    repeat,
    postNoticeReturnish,
    oracle: refs.oracle,
    strictCategory: refs.strictCategory,
    immediate: refs.immediate,
    heuristic: refs.heuristic,
    looseAuto: loose.state.autoReturns,
    greedySealedJunk: greedy.state.sealedJunk,
    sequence,
    refs,
  };
}

export function findAcceptedSeeds({ count = 8, start = 101, maxScan = 400 } = {}) {
  const seeds = [];
  const failed = [];
  for (let seed = start; seed < start + maxScan && seeds.length < count; seed += 1) {
    const report = inspectSeed(seed);
    if (report.ok) seeds.push(seed);
    else failed.push(report);
  }
  return { seeds, failed };
}

// Locked list. Selftest recomputes inspectSeed on each and fails if any regresses.
export const SEEDS = [102, 104, 108, 109, 111, 112, 115, 116];
