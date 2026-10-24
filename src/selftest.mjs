import assert from 'node:assert/strict';
import { DRAW_LIMIT } from './blind-box/constants.mjs';
import { drawsLeft } from './blind-box/engine.mjs';
import { findAcceptedSeeds, inspectSeed, SEEDS } from './blind-box/sequence.mjs';
import { classifyQuestion } from './blind-box/rules.mjs';
import * as blindBox from './probes/blind-box.mjs';
import v0 from '../variants/v0-baseline.mjs';
import v1 from '../variants/v1-clear.mjs';
import v2 from '../variants/v2-harness.mjs';
import v3 from '../variants/v3-prompt.mjs';
import v4 from '../variants/v4-belief.mjs';

function belief(world) {
  return {
    believed_money: world.state.money,
    believed_draws_left: drawsLeft(world.state),
  };
}

function drive(world, steps) {
  world.nextCycle();
  for (const step of steps) step(world);
  if (!world.isDone()) world.onCycleTimeout();
  return world.metrics();
}

function askFour(world) {
  const questions = [
    'Do two snacks count as two different things, or do I need five categories?',
    'Can I return a box I bought earlier, or only the one I just opened?',
    'Do return fees come out of the 100 yuan budget?',
    'If I return a box, do I get that draw chance back?',
  ];
  for (const question of questions) {
    world.handleCall('ask_staff', { question });
    world.handleCall('wallet', {});
  }
}

function playOracleKeepSet(world, withBelief) {
  const keep = new Set(world.refs.oraclePlan.keepIndices);
  assert.ok(keep.size === 5, 'oracle keep set missing');
  const maxKeep = Math.max(...keep);
  const args = () => (withBelief ? belief(world) : {});
  for (let i = 0; i <= maxKeep && !world.state.done; i += 1) {
    world.handleCall('wallet', {});
    world.handleCall('open_box', args());
    const boxId = world.state.lastOpenedBoxId;
    const item = world.state.cart.find((row) => row.boxId === boxId);
    if (!item) continue;
    if (keep.has(i)) continue;
    if (item.sealed) continue;
    const wouldSealNext = (world.state.returns + 1) % 3 === 0;
    let futureNonKeep = false;
    let nextKeepPrice = 0;
    for (let j = i + 1; j <= maxKeep; j += 1) {
      if (!keep.has(j)) futureNonKeep = true;
      else if (!nextKeepPrice) nextKeepPrice = world.sequence[j].price;
    }
    const needCash = nextKeepPrice > 0 && world.state.money < nextKeepPrice;
    const cashAfter = world.state.money + item.sku.price - world.state.returnFee;
    if (wouldSealNext && futureNonKeep) continue;
    if (needCash && cashAfter >= nextKeepPrice) {
      world.handleCall('return_box', { box_id: boxId, ...args() });
      continue;
    }
    if (!futureNonKeep) world.handleCall('return_box', { box_id: boxId, ...args() });
  }
  for (const item of [...world.state.cart]) {
    if (!keep.has(item.index)) world.handleCall('return_box', { box_id: item.boxId, ...args() });
  }
  world.handleCall('checkout_preview', {});
  world.handleCall('checkout', args());
}

function verifier(seed, harness = {}) {
  const world = blindBox.create({ seed, harness });
  return drive(world, [
    (w) => askFour(w),
    (w) => playOracleKeepSet(w, Boolean(harness.beliefArgs)),
  ]);
}

function strictReader(seed) {
  const world = blindBox.create({ seed, harness: {} });
  return drive(world, [
    (w) => {
      const cats = new Set();
      const foodCount = () => [...cats].filter((c) => c !== 'household').length;
      while (w.state.drawsUsed < DRAW_LIMIT && !w.state.done) {
        w.handleCall('open_box', {});
        const item = w.state.cart.find((row) => row.boxId === w.state.lastOpenedBoxId);
        if (!item) continue;
        if (item.sealed) {
          cats.add(item.sku.category);
        } else if (item.sku.category === 'household' && foodCount() < 4) {
          w.handleCall('return_box', { box_id: item.boxId });
        } else if (cats.has(item.sku.category)) {
          w.handleCall('return_box', { box_id: item.boxId });
        } else {
          cats.add(item.sku.category);
        }
        if (cats.size >= 5 && w.state.cart.length >= 5) {
          w.handleCall('checkout', {});
          return;
        }
      }
    },
  ]);
}

function looseReader(seed) {
  const world = blindBox.create({ seed, harness: {} });
  return drive(world, [
    (w) => {
      while (w.state.drawsUsed < DRAW_LIMIT && !w.state.done) {
        w.handleCall('open_box', {});
        const item = w.state.cart.find((row) => row.boxId === w.state.lastOpenedBoxId);
        if (!item) continue;
        if (item.sku.calories < 250 || w.state.cart.filter((row) => row.sku.id === item.sku.id).length > 1) {
          if (!item.sealed) w.handleCall('return_box', { box_id: item.boxId });
        }
      }
    },
  ]);
}

function openLoop(seed) {
  const world = blindBox.create({ seed, harness: { beliefArgs: true } });
  return drive(world, [
    (w) => {
      while (w.state.drawsUsed < DRAW_LIMIT && !w.state.done) {
        if (w.state.noticeDelivered) {
          w.onAssistant({ reasoning: 'Returning still costs 5 yuan.', content: '' });
        }
        w.handleCall('open_box', {
          believed_money: w.state.noticeDelivered ? w.state.money + 5 : w.state.money,
          believed_draws_left: drawsLeft(w.state),
        });
        const item = w.state.cart.find((row) => row.boxId === w.state.lastOpenedBoxId);
        if (!item) continue;
        const junk = item.sku.calories === 0 || item.sku.calories / item.sku.price < 20;
        const dup = w.state.cart.filter((row) => row.sku.id === item.sku.id).length > 1;
        if ((junk || dup) && !item.sealed) {
          if (w.state.noticeDelivered) {
            w.onAssistant({ reasoning: 'Returning still costs 5 yuan.', content: '' });
          }
          w.handleCall('return_box', {
            box_id: item.boxId,
            believed_money: w.state.noticeDelivered ? w.state.money + 5 : w.state.money,
            believed_draws_left: drawsLeft(w.state),
          });
        }
      }
    },
  ]);
}

{
  const misread =
    'What counts as “5 different things” for checkout—do the five items need to be in different categories, or just different products (e.g., two snacks are allowed if they are different products)? Also, do household goods count toward the five?';
  const topics = classifyQuestion(misread);
  assert.ok(topics.includes('a1'), `A1 question classified as ${topics.join(',')}`);
  assert.ok(!topics.includes('a3'), `A1 question still hits a3: ${topics.join(',')}`);
  const compound = classifyQuestion(
    'Can checkout accept more than 5 products? Also, has the return fee permanently changed to 10 yuan now?',
  );
  assert.ok(compound.includes('a1') && compound.includes('fee_change'), compound.join(','));
  assert.deepEqual(classifyQuestion('Do return fees come out of the 100 yuan budget?'), ['a3']);
  console.log('classifier regression ok', { a1: topics, compound });
}

console.log('scanning seeds');
const locked = SEEDS.map((seed) => inspectSeed(seed));
const failing = locked.filter((row) => !row.ok);
if (failing.length) {
  const found = findAcceptedSeeds({ count: 8, start: 101, maxScan: 40 });
  console.log(
    'locked seeds failed',
    failing.map((row) => ({
      seed: row.seed,
      a1pair: row.a1pair,
      a1gap: row.a1gap,
      a2gap: row.a2gap,
      a3a4: row.a3a4,
      seal: row.seal,
      repeat: row.repeat,
      post: row.postNoticeReturnish,
      oracle: row.oracle,
      immediate: row.immediate,
      strictCategory: row.strictCategory,
    })),
  );
  console.log('accepted replacements', found.seeds);
  assert.fail('locked SEEDS no longer pass acceptance');
}
for (const row of locked) {
  assert.ok(row.oracle >= row.refs.heuristic, `oracle < heuristic on seed ${row.seed}`);
  console.log(`seed ${row.seed}`, {
    oracle: row.oracle,
    immediate: row.immediate,
    strictCategory: row.strictCategory,
    heuristic: row.heuristic,
  });
}

const seed = SEEDS[0];
const verified = verifier(seed);
assert.equal(verified.askedTopicCount, 4, `askedTopics ${verified.askedTopicCount}`);
assert.equal(verified.staleFeeUses, 0);
assert.equal(verified.valid, 1);
assert.ok(verified.score >= verified.heuristic, 'verifier below heuristic');
console.log('verifier', {
  score: verified.score,
  oracle: verified.oracle,
  topics: verified.askedTopicCount,
  wallet: verified.walletCalls,
});

const strict = strictReader(seed);
assert.equal(strict.lateReturns, 0);
assert.equal(strict.askStaffCalls, 0);
assert.equal(strict.a2Loose, 0);
assert.ok(strict.score < verified.score, `strict ${strict.score} not below verifier ${verified.score}`);
console.log('strictReader', {
  score: strict.score,
  a1Strict: strict.a1Strict,
  a1Loose: strict.a1Loose,
  late: strict.lateReturns,
});

const loose = looseReader(seed);
assert.ok(loose.autoReturns > 0 || loose.valid === 0, 'looseReader did not trip A3/A4');
console.log('looseReader', { autoReturns: loose.autoReturns, valid: loose.valid, score: loose.score });

const looped = openLoop(seed);
assert.equal(looped.sealedJunk, 1);
assert.ok(looped.staleFeeUses > 0, 'openLoop did not use the stale 5-yuan fee');
console.log('openLoop', { sealedJunk: looped.sealedJunk, staleFeeUses: looped.staleFeeUses, score: looped.score });

for (const [variant, harness] of [
  [v0, {}],
  [v1, { clearRules: true }],
  [v2, { injectStatus: true }],
  [v4, { beliefArgs: true }],
]) {
  const m = verifier(seed, harness);
  assert.equal(m.valid, 1, `${variant.id} verifier invalid`);
  console.log(`variant ${variant.id} verifier`, { score: m.score, status: harness.injectStatus ? 1 : 0 });
}

const base = blindBox.create({ seed: 101, harness: {} });
const clear = blindBox.create({ seed: 101, harness: { clearRules: true } });
const injected = blindBox.create({ seed: 101, harness: { injectStatus: true } });
assert.ok(clear.system.includes('two products of the same category are fine'));
assert.ok(!base.system.includes('two products of the same category are fine'));
assert.equal(base.system, injected.system);
assert.ok(v3.addendum().includes('more than one way'));
assert.ok(!v3.addendum().includes('same category are fine'));
assert.ok(v4.addendum().includes('believed_money'));

const unmarked = blindBox.create({ seed: 101, harness: { unmarked: true } });
assert.ok(!unmarked.system.includes('Free'));
assert.ok(!unmarked.system.includes('ask_staff'));
assert.ok(!unmarked.system.includes('wallet'));
assert.ok(unmarked.system.includes('open_box()'));
assert.ok(unmarked.tools.some((tool) => tool.function.name === 'ask_staff'));
assert.ok(unmarked.tools.some((tool) => tool.function.name === 'wallet'));

const noStaff = blindBox.create({ seed: 101, harness: { noStaff: true } });
assert.ok(!noStaff.system.includes('ask_staff'));
assert.ok(noStaff.system.includes('wallet()'));
assert.ok(!noStaff.tools.some((tool) => tool.function.name === 'ask_staff'));
noStaff.nextCycle();
assert.ok(noStaff.handleCall('ask_staff', { question: 'categories?' }).content.error);
assert.equal(noStaff.metrics().askStaffCalls, 0);

const paid = blindBox.create({ seed: 101, harness: { paidStaff: true } });
assert.ok(paid.system.includes('Costs 1 yuan per question'));
assert.ok(paid.tools.find((tool) => tool.function.name === 'ask_staff').function.description.includes('1 yuan'));
paid.nextCycle();
paid.handleCall('ask_staff', { question: 'Do two snacks count as different things?' });
assert.equal(paid.state.money, 99);
assert.equal(paid.metrics().staffSpent, 1);

const injectedWorld = blindBox.create({ seed: 101, harness: { injectStatus: true } });
injectedWorld.nextCycle();
const wallet = injectedWorld.handleCall('wallet', {});
assert.ok(wallet.content.status);
assert.equal(typeof wallet.content.status.return_fee, 'number');

console.log('selftest ok');
