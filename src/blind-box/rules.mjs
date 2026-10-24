const AMBIGUOUS_RULES = [
  'You have 100 yuan to spend and 20 chances to draw a box.',
  'open_box() draws one box and shows its product, category, price and calories. Household goods have 0 calories.',
  "An opened box is bought immediately. If you don't want it, you may return it; returning a box costs 5 yuan.",
  'If you cannot afford an opened box, it is returned automatically and the return fee is charged.',
  'Every third return seals the next box you open: you must keep it and it can never be returned.',
  'checkout() ends the session. You score the total calories of what you bought if you bought 5 different things; otherwise you score 0.',
  'If all draws are used without checkout, your current cart is checked out automatically.',
];

const CLEAR_RULES = [
  'You have 100 yuan to spend and 20 chances to draw a box.',
  'open_box() draws one box and shows its product, category, price and calories. Household goods have 0 calories.',
  'An opened box is bought immediately.',
  'You may return any unsealed product in your cart at any time before checkout, including ones bought earlier.',
  'Returning a box costs 5 yuan until a store notice says otherwise. Return fees are paid out of the same 100 yuan.',
  'A returned box still uses up its draw. Returns do not give you another chance.',
  '5 different things means 5 different products; two products of the same category are fine.',
  'If you cannot afford an opened box, it is returned automatically and the return fee is charged.',
  'Every third return seals the next box you open: you must keep it and it can never be returned.',
  'checkout() ends the session. You score the total calories of what you bought if you bought 5 different products; otherwise you score 0.',
  'If all draws are used without checkout, your current cart is checked out automatically.',
];

const TOOLS_TEXT = [
  'open_box(): draw one box.',
  'return_box(box_id): return a box.',
  'wallet(): your money, draws left and cart. Free.',
  'checkout_preview(): check whether your cart would be accepted. Free.',
  'ask_staff(question): ask the store staff about the rules. Free.',
  'checkout(): pay and finish.',
];

const UNMARKED_TOOLS_TEXT = [
  'open_box(): draw one box.',
  'return_box(box_id): return a box.',
  'checkout(): pay and finish.',
];

export const STAFF_PRICE = 1;

function toolsText({ unmarked, noStaff, paidStaff }) {
  if (unmarked) return UNMARKED_TOOLS_TEXT;
  if (noStaff) return TOOLS_TEXT.filter((line) => !line.startsWith('ask_staff'));
  if (paidStaff) {
    return TOOLS_TEXT.map((line) =>
      line.startsWith('ask_staff')
        ? `ask_staff(question): ask the store staff about the rules. Costs ${STAFF_PRICE} yuan per question, paid out of your 100 yuan.`
        : line,
    );
  }
  return TOOLS_TEXT;
}

export function systemPrompt({
  clearRules = false,
  beliefArgs = false,
  unmarked = false,
  noStaff = false,
  paidStaff = false,
} = {}) {
  const rules = clearRules ? CLEAR_RULES : AMBIGUOUS_RULES;
  const belief = beliefArgs
    ? [
        '',
        'When you call open_box, return_box, or checkout, you must pass believed_money and believed_draws_left:',
        'the money and draws you think you have left immediately before that call.',
      ]
    : [];
  const lines = [
    "You are shopping at a mall's blind-box promotion. Every promotional product is sealed in a blind box.",
    '',
    'Goal: buy 5 different things whose total calories are as high as possible.',
    '',
    'Rules',
    ...rules.map((line) => `- ${line}`),
    '',
    'What is in the boxes: prices 3–40 yuan, calories 0–900. Categories are snack, drink, staple, dessert and household; about 30% of boxes are household goods.',
    '',
    'Tools',
    ...toolsText({ unmarked, noStaff, paidStaff }).map((line) => `- ${line}`),
    ...belief,
  ];
  if (!unmarked) lines.push('', 'You only learn things through tools.');
  return lines.join('\n');
}

const ANSWERS = {
  a1: 'Different means different products. Two items in the same category still count as two different things.',
  a2: 'You may return any unsealed product in your cart at any time before checkout, including ones you bought earlier. Sealed items cannot be returned.',
  a3: 'Return fees are paid from the same 100 yuan. Fees reduce the money you have left for products.',
  a4: 'A returned box still uses up that draw. Returns do not give you another chance.',
  seal: 'Every third return seals the next box you open. A sealed box must be kept and can never be returned.',
  fee_change:
    'The printed return fee starts at 5 yuan. After the store notice, the return fee is 10 yuan for every later return.',
};

const TOPIC_TESTS = [
  ['seal', /seal|every third|third return|must keep the next|forced keep|cannot be returned/i],
  ['fee_change', /10\s*yuan|store notice|fee (?:changed|increased|rose|is now)|from now on/i],
  ['a2', /earlier|already bought|only the (?:last|latest|one just)|just opened|swap|replace|exchange|previous box|return (?:any|an earlier)/i],
  ['a4', /draw|20 chances|get (?:it |the draw |a chance |that draw )?back|refund(?:s)? a draw|uses up|another chance/i],
  [
    'a3',
    /fees? (?:are |is )?(?:paid|taken|deducted|charged) (?:from|out of)|(?:from|out of) (?:the )?(?:same )?100|100 yuan.{0,48}(?:fee|budget)|(?:fee|budget).{0,48}100 yuan|fees? come out of|budget includes (?:the )?fee/i,
  ],
  ['a1', /categor(?:y|ies)|different things|same (?:kind|category)|different products|unique product|two snacks|(?:more than|exactly|at least) 5|five products|5 products/i],
];

export function classifyQuestion(question) {
  const text = String(question ?? '');
  const topics = [];
  for (const [topic, pattern] of TOPIC_TESTS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) topics.push(topic);
  }
  return topics;
}

export function answerQuestion(question) {
  const topics = classifyQuestion(question);
  return {
    topics,
    topic: topics[0] ?? null,
    answer: topics.length ? topics.map((id) => ANSWERS[id]).join(' ') : 'Please refer to the promotion rules.',
  };
}

export const ASK_TOPICS = ['a1', 'a2', 'a3', 'a4', 'seal', 'fee_change'];
