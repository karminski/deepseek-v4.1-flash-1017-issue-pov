import { ITEMS, NOTICE_DRAW } from './engine.mjs';
import { hindsight, runPolicy } from './policies.mjs';
import { buildSequence } from './sequence.mjs';

const JUNK_PRICE = 25;
const LATE_FROM = 13;
const isJunk = (item) => item.category === 'household' || item.price >= JUNK_PRICE;

// DESIGN.md section 7: every mechanism under test must matter on every accepted seed.
export function acceptance(seed) {
  const sequence = buildSequence(seed);
  const best = hindsight(sequence);
  const strictBest = hindsight(sequence, { strictCategories: true });
  const bestItems = best.picks.map((i) => sequence[i]);
  const plain = runPolicy(sequence);
  const swap = runPolicy(sequence, { swap: true });
  const loose = runPolicy(sequence, { feesFromBudget: false, drawsRefunded: true });
  const counts = new Map();
  for (const item of sequence) counts.set(item.sku, (counts.get(item.sku) ?? 0) + 1);
  const bestSet = new Set(best.picks);
  const early = sequence.slice(0, LATE_FROM - 1).filter((x) => x.category !== 'household');
  const late = sequence.slice(LATE_FROM - 1);
  const earlyFifth = early.map((x) => x.kcal).sort((a, b) => b - a)[ITEMS - 1] ?? 0;
  const afterNotice = sequence.slice(NOTICE_DRAW);
  const checks = {
    a1SameCategoryInBest: new Set(bestItems.map((x) => x.category)).size < bestItems.length,
    a1StrictLoss: strictBest.score <= 0.85 * best.score,
    a2LateUpgrade: early.length >= ITEMS && late.some((x) => x.kcal >= earlyFifth + 200),
    a3a4LooseHurts: loose.autoReturns > 0 || loose.drawsOutIncomplete === 1 || !loose.valid,
    sealJunkLikely: sequence.slice(3).filter(isJunk).length / (sequence.length - 3) >= 0.35,
    richDuplicate: sequence.some((x) => x.kcal >= 400 && counts.get(x.sku) >= 2),
    returnsAfterNotice: afterNotice.filter((x, i) => !bestSet.has(NOTICE_DRAW + i)).length >= 6,
  };
  return {
    seed,
    ok: Object.values(checks).every(Boolean),
    checks,
    oracle: best.score,
    strictOracle: strictBest.score,
    heuristic: plain.score,
    swapHeuristic: swap.score,
    looseHeuristic: loose.score,
  };
}

export function findSeeds(count, from = 101, limit = 2000) {
  const found = [];
  for (let seed = from; found.length < count && seed < from + limit; seed += 1) {
    if (acceptance(seed).ok) found.push(seed);
  }
  return found;
}
