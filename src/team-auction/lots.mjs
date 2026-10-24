import { hashInt, hashPick, hashUnit } from '../rng.mjs';
import { CATEGORIES, LOT_COUNT, MEMBER_IDS, TICKS } from './constants.mjs';

function buildLot(seed, i, prefix) {
  const enter = Math.min(i * 3 + hashInt(0, 1, seed, 'enter', i), 28);
  const withdraw = Math.min(enter + hashInt(10, 15, seed, 'duration', i), TICKS);
  const mid = hashInt(40, 80, seed, 'mid', i);
  const value = mid + hashInt(-9, 9, seed, 'value', i);
  const start = Math.round(mid * (1.5 + 0.2 * hashUnit(seed, 'start', i)));
  const end = Math.round(mid * (0.45 + 0.15 * hashUnit(seed, 'end', i)));
  const drops = withdraw - 1 - enter;
  const total = Math.max(drops, start - end);
  let fastFrom = null;
  let drop;
  let fastDrop = null;
  if (drops >= 6 && hashUnit(seed, 'accel', i) < 0.4) {
    const slowSteps = Math.round(drops * 0.6);
    drop = Math.max(1, Math.round(total / (2 * drops - slowSteps)));
    fastDrop = drop * 2;
    fastFrom = enter + slowSteps;
  } else {
    drop = Math.max(1, Math.round(total / drops));
  }
  return {
    id: `${prefix}${i + 1}`,
    category: hashPick(CATEGORIES, seed, 'category', i),
    lo: mid - 10,
    hi: mid + 10,
    mid,
    value,
    enter,
    withdraw,
    start,
    drop,
    fastFrom,
    fastDrop,
  };
}

export function priceAt(lot, tick) {
  if (tick < lot.enter || tick >= lot.withdraw) return null;
  const elapsed = tick - lot.enter;
  if (lot.fastFrom === null) return Math.max(1, lot.start - lot.drop * elapsed);
  const slow = Math.min(elapsed, lot.fastFrom - lot.enter);
  const fast = Math.max(0, tick - lot.fastFrom);
  return Math.max(1, lot.start - lot.drop * slow - lot.fastDrop * fast);
}

export function generateWorld(seed, { prefix = 'L' } = {}) {
  const lots = Array.from({ length: LOT_COUNT }, (_, i) => buildLot(seed, i, prefix));
  const calm = MEMBER_IDS[hashInt(0, MEMBER_IDS.length - 1, seed, 'calm')];
  const rotate = hashInt(0, MEMBER_IDS.length - 1, seed, 'rotate');
  const skipA = hashInt(0, LOT_COUNT - 1, seed, 'skipA');
  const skipB = (skipA + 1 + hashInt(0, LOT_COUNT - 2, seed, 'skipB')) % LOT_COUNT;
  const lists = Object.fromEntries(MEMBER_IDS.map((m) => [m, []]));
  lots.forEach((lot, i) => {
    if (i === skipA || i === skipB) return;
    lists[MEMBER_IDS[(i + rotate) % MEMBER_IDS.length]].push(lot.id);
  });
  const members = MEMBER_IDS.map((id) => {
    const temperament = id === calm ? 'calm' : 'aggressive';
    const base = temperament === 'calm' ? hashInt(5, 7, seed, 'base', id) : hashInt(4, 6, seed, 'base', id);
    return { id, temperament, base, list: lists[id] };
  });
  return { seed, lots, members };
}
