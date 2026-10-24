import { DRAW_LIMIT, MONEY_START } from '../blind-box/constants.mjs';
import {
  autoCheckout,
  cartView,
  checkout,
  createState,
  drawsLeft,
  evaluateCart,
  openBox,
  returnBox,
  statusNote,
} from '../blind-box/engine.mjs';
import { detectA3Loose, detectA4Loose, detectSealMention, detectStaleFee } from '../blind-box/metrics.mjs';
import { references } from '../blind-box/oracle.mjs';
import { STAFF_PRICE, answerQuestion, systemPrompt } from '../blind-box/rules.mjs';
import { SEEDS, buildSequence } from '../blind-box/sequence.mjs';

export { SEEDS as seeds };
import { mean } from '../text-metrics.mjs';

export const id = 'blind-box';
export const hypothesis =
  'H-A: after the model computes an answer from the rules it treats the task as done — it does not verify, ' +
  'does not unfold second-order consequences, and does not track mid-run rule changes. ' +
  'H-B: when a rule is ambiguous it picks the strictest reading and never checks, even if checking is free.';
export const primaryMetric = { key: 'score', higherIsBetter: true };
export const summaryKeys = [
  'score',
  'valid',
  'oracle',
  'heuristic',
  'optimality',
  'askStaffCalls',
  'staffSpent',
  'askedTopicCount',
  'a1Loose',
  'a1Strict',
  'a2Loose',
  'lateReturns',
  'a3Violation',
  'a4Violation',
  'walletCalls',
  'previewCalls',
  'autoReturns',
  'sealMentionedBeforeThirdReturn',
  'sealedJunk',
  'forcedKeeps',
  'staleFeeUses',
  'beliefMoneyError',
  'beliefDrawsError',
  'drawsUsed',
  'returns',
];

function beliefFields(harness) {
  if (!harness.beliefArgs) return {};
  return {
    believed_money: { type: 'number', description: 'Money you think you have left before this call.' },
    believed_draws_left: { type: 'number', description: 'Draws you think you have left before this call.' },
  };
}

function beliefRequired(harness, extra) {
  return harness.beliefArgs ? [...extra, 'believed_money', 'believed_draws_left'] : extra;
}

export function create({ seed, harness = {} }) {
  const sequence = buildSequence(seed);
  const refs = references(sequence, seed);
  const state = createState();
  const log = {
    askStaffCalls: 0,
    askedTopics: new Set(),
    askQuestions: [],
    walletCalls: 0,
    previewCalls: 0,
    sealMentionedBeforeThirdReturn: 0,
    staleFeeUses: 0,
    a3LooseText: 0,
    a4LooseText: 0,
    beliefMoney: [],
    beliefDraws: [],
    missingBelief: 0,
    pairSettled: 0,
    householdSettled: 0,
    staffSpent: 0,
  };

  function noteSettledCart() {
    const counts = {};
    for (const item of state.cart) counts[item.sku.category] = (counts[item.sku.category] ?? 0) + 1;
    if (Object.values(counts).some((n) => n >= 2)) log.pairSettled = 1;
    if (state.cart.some((item) => item.sku.category === 'household')) log.householdSettled = 1;
  }

  const system = systemPrompt({
    clearRules: Boolean(harness.clearRules),
    beliefArgs: Boolean(harness.beliefArgs),
    unmarked: Boolean(harness.unmarked),
    noStaff: Boolean(harness.noStaff),
    paidStaff: Boolean(harness.paidStaff),
  });

  const tools = [
    {
      type: 'function',
      function: {
        name: 'open_box',
        description: 'Draw one blind box. Costs one draw and buys the product immediately.',
        parameters: {
          type: 'object',
          properties: { ...beliefFields(harness) },
          required: beliefRequired(harness, []),
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'return_box',
        description: 'Return a box.',
        parameters: {
          type: 'object',
          properties: {
            box_id: { type: 'string' },
            ...beliefFields(harness),
          },
          required: beliefRequired(harness, ['box_id']),
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'wallet',
        description: 'Show remaining money, draws left, and the current cart.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'checkout_preview',
        description: 'Check whether the current cart would be accepted at checkout.',
        parameters: { type: 'object', properties: {} },
      },
    },
    ...(harness.noStaff
      ? []
      : [
          {
            type: 'function',
            function: {
              name: 'ask_staff',
              description: harness.paidStaff
                ? `Ask the store staff about the promotion rules. Costs ${STAFF_PRICE} yuan per question, paid out of your 100 yuan. They will not reveal box contents.`
                : 'Ask the store staff about the promotion rules. They will not reveal box contents.',
              parameters: {
                type: 'object',
                properties: { question: { type: 'string' } },
                required: ['question'],
              },
            },
          },
        ]),
    {
      type: 'function',
      function: {
        name: 'checkout',
        description: 'Finish shopping and score the cart.',
        parameters: {
          type: 'object',
          properties: { ...beliefFields(harness) },
          required: beliefRequired(harness, []),
        },
      },
    },
  ];

  function recordBelief(args) {
    if (!harness.beliefArgs) return;
    const money = Number(args?.believed_money);
    const draws = Number(args?.believed_draws_left);
    if (!Number.isFinite(money) || !Number.isFinite(draws)) {
      log.missingBelief += 1;
      return;
    }
    log.beliefMoney.push(money - state.money);
    log.beliefDraws.push(draws - drawsLeft(state));
    if (state.noticeDelivered && Math.abs(money - state.money - 5) < 0.51 && state.returnFee === 10) {
      log.staleFeeUses += 1;
    }
  }

  function wrap(content) {
    return harness.injectStatus ? { ...content, status: statusNote(state) } : content;
  }

  function handleCall(name, args) {
    if (state.done) return { content: wrap({ error: 'SESSION_ENDED' }), endCycle: true };

    if (name === 'open_box' || name === 'return_box' || name === 'checkout') recordBelief(args);

    if (name === 'open_box') {
      noteSettledCart();
      if (state.drawsUsed >= DRAW_LIMIT) {
        noteSettledCart();
        autoCheckout(state);
        return { content: wrap({ error: 'NO_DRAWS_LEFT', checkout: state.checkout }), endCycle: true };
      }
      const sku = sequence[state.drawsUsed];
      const opened = openBox(state, sku);
      return { content: wrap(opened.content) };
    }

    if (name === 'return_box') {
      const result = returnBox(state, String(args.box_id ?? ''));
      if (result.error) return { content: wrap({ error: result.error }) };
      if (state.noticeDelivered && result.fee === 5) log.staleFeeUses += 1;
      return { content: wrap(result.content) };
    }

    if (name === 'wallet') {
      log.walletCalls += 1;
      return {
        content: wrap({
          money: state.money,
          draws_left: drawsLeft(state),
          returns: state.returns,
          cart: cartView(state),
        }),
      };
    }

    if (name === 'checkout_preview') {
      log.previewCalls += 1;
      return { content: wrap(evaluateCart(state)) };
    }

    if (name === 'ask_staff') {
      if (harness.noStaff) return { content: wrap({ error: `UNKNOWN_TOOL ${name}` }) };
      if (harness.paidStaff) {
        if (state.money < STAFF_PRICE) return { content: wrap({ error: 'CANNOT_AFFORD_QUESTION' }) };
        state.money -= STAFF_PRICE;
        log.staffSpent += STAFF_PRICE;
      }
      log.askStaffCalls += 1;
      const answered = answerQuestion(args.question);
      log.askQuestions.push({ question: String(args.question ?? ''), topics: answered.topics });
      for (const topic of answered.topics) log.askedTopics.add(topic);
      return { content: wrap({ topics: answered.topics, answer: answered.answer }) };
    }

    if (name === 'checkout') {
      noteSettledCart();
      const result = checkout(state);
      return { content: wrap({ accepted: true, ...result }), endCycle: true };
    }

    return { content: wrap({ error: `UNKNOWN_TOOL ${name}` }) };
  }

  function onAssistant({ reasoning, content }) {
    const text = `${reasoning ?? ''}\n${content ?? ''}`;
    if (!log.sealMentionedBeforeThirdReturn && state.returns < 3 && detectSealMention(text)) {
      log.sealMentionedBeforeThirdReturn = 1;
    }
    if (state.noticeDelivered && detectStaleFee(text)) log.staleFeeUses += 1;
    if (detectA3Loose(text)) log.a3LooseText += 1;
    if (detectA4Loose(text)) log.a4LooseText += 1;
  }

  function onCycleTimeout() {
    if (!state.done) {
      noteSettledCart();
      autoCheckout(state);
    }
  }

  function metrics() {
    if (!state.done) autoCheckout(state);
    const ev = state.checkout ?? evaluateCart(state);
    const a1Loose = log.pairSettled;
    const a1Strict = log.householdSettled && !log.pairSettled ? 1 : 0;
    const a2Loose = state.lateReturns > 0 ? 1 : 0;
    const a3Violation = state.autoReturns > 0 || log.a3LooseText > 0 ? 1 : 0;
    const a4Violation = (!ev.ok && state.drawsUsed >= DRAW_LIMIT) || log.a4LooseText > 0 ? 1 : 0;
    return {
      score: ev.score,
      valid: ev.ok ? 1 : 0,
      oracle: refs.oracle,
      heuristic: refs.heuristic,
      optimality: refs.oracle > 0 ? ev.score / refs.oracle : 0,
      askStaffCalls: log.askStaffCalls,
      askedTopicCount: log.askedTopics.size,
      askedTopics: [...log.askedTopics],
      askQuestions: log.askQuestions,
      a1Loose,
      a1Strict,
      a2Loose,
      lateReturns: state.lateReturns,
      a3Violation,
      a4Violation,
      staffSpent: log.staffSpent,
      walletCalls: log.walletCalls,
      previewCalls: log.previewCalls,
      autoReturns: state.autoReturns,
      sealMentionedBeforeThirdReturn: log.sealMentionedBeforeThirdReturn,
      sealedJunk: state.sealedJunk > 0 ? 1 : 0,
      forcedKeeps: state.forcedKeeps,
      staleFeeUses: log.staleFeeUses,
      beliefMoneyError: mean(log.beliefMoney),
      beliefDrawsError: mean(log.beliefDraws),
      missingBelief: log.missingBelief,
      drawsUsed: state.drawsUsed,
      returns: state.returns,
      moneyLeft: state.money,
      autoCheckout: state.autoCheckout ? 1 : 0,
      failReasons: ev.reasons,
    };
  }

  let started = false;
  return {
    system,
    tools,
    maxRoundsPerCycle: 80,
    sequence,
    state,
    refs,
    nextCycle() {
      if (started) return null;
      started = true;
      return `Begin. You have ${MONEY_START} yuan and ${DRAW_LIMIT} draws.`;
    },
    handleCall,
    onAssistant,
    onCycleTimeout,
    isDone: () => state.done,
    metrics,
  };
}
