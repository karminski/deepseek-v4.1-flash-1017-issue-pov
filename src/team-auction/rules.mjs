import { CANCEL_FEE, MAX_TURNS, POOL_START, ROGUE_FINE, TICKS, WAIT_MAX } from './constants.mjs';

function auctionPrompt({ noNotice, noCheck }) {
  const lines = [
    'You lead a company purchasing team at a Dutch (descending-price) auction of sealed mystery lots.',
    `Everyone on the team pays from one shared team pool of ${POOL_START}.`,
    '',
    'Goal: finish with the highest team value = money left in the pool + true value of every lot the team bought.',
    '',
    'Lots',
    '- Each lot shows a category and an estimated value range; the true value is revealed only after purchase.',
    "- A lot's price starts high and drops every tick by its published schedule (some lots drop faster from a listed tick).",
    '- A lot that nobody buys is withdrawn at its listed withdrawal tick.',
    '',
    'Team members',
    '- Each member watches one lot at a time and has a temperament (aggressive or calm) and a patience counter.',
    '- While a member watches a lot on the clock without holding an authorization, their patience drops by 1 every tick. An authorization freezes it, but only one that can still fill: if max_price is below the price the lot will have at its last tick before withdrawal, the member is not calmed, and at patience 0 they drop that authorization.',
    `- At patience 0, an aggressive member buys the watched lot on their own at the current price and the company charges a ${ROGUE_FINE} compliance fine. A calm member gives up on that lot instead.`,
    "- After a member buys anything or gives up, they move to the next lot on their list with patience reset. If their lot is bought by someone else or withdrawn, they move on with their current patience.",
    '',
    'Orders and money',
    '- authorize(member, lot, max_price): the member buys the lot as soon as its price is at or below max_price. max_price is reserved from the pool immediately and the available pool shrinks by that much. One authorization per member; revoke before giving a new one. A member authorized for a lot watches that lot.',
    '- revoke(member) releases the reservation. bid(lot) buys at the current price now, paid from the available pool.',
    `- A purchase a member makes on their own is paid from the pool, including money reserved for other orders. If reserved money is no longer covered, the most recent authorizations are cancelled one by one until it is; each cancellation costs a ${CANCEL_FEE} fee and leaves that member aggressive with patience 2.`,
    '',
    'Time',
    `- The auction runs ${TICKS} ticks (0-${TICKS - 1}). Each turn you get an observation of the current tick, act with tools, then end the turn with wait(n), n = 1..${WAIT_MAX}. Unfinished authorizations lapse when the auction ends.`,
    ...(noNotice ? [] : ['- Finance notifies you after money leaves the pool; a wait ends early when that happens.']),
    `- You have at most ${MAX_TURNS} turns.`,
    '',
    'Tools',
    '- bid(lot), authorize(member, lot, max_price), revoke(member)',
    ...(noCheck
      ? []
      : [
          '- pool_check(plan): simulate a list of your actions and see whether each is affordable, the available pool afterwards, and when each authorization would fill if nobody else acts. Free, does not change anything.',
        ]),
    '- wait(n), finish()',
    '',
    'You only learn things through the observation and tools.',
  ];
  return lines.join('\n');
}

function clearancePrompt({ noNotice, noCheck }) {
  const lines = [
    'You coordinate a group of colleagues buying from a warehouse clearance of sealed mystery items.',
    `Everyone in the group pays with one shared expense account holding ${POOL_START}.`,
    '',
    'Goal: finish with the highest group value = money left on the account + true value of every item the group bought.',
    '',
    'Items',
    '- Each item shows a category and an estimated value range; the true value is revealed only after purchase.',
    "- An item's price tag starts high and is marked down every hour by its published schedule (some items are marked down faster from a listed hour).",
    '- An item that nobody buys is removed from sale at its listed removal hour.',
    '',
    'Colleagues',
    '- Each colleague is interested in one item at a time and has a temperament (aggressive or calm) and a patience counter.',
    '- While a colleague waits on an item that is on sale without holding a delegation, their patience drops by 1 every hour. A delegation freezes it, but only one that can still fill: if max_price is below the price the item will have in its last hour before removal, the colleague is not calmed, and at patience 0 they drop that delegation.',
    `- At patience 0, an aggressive colleague buys that item on their own at the current price and the company charges a ${ROGUE_FINE} compliance fine. A calm colleague gives up on that item instead.`,
    '- After a colleague buys anything or gives up, they move to the next item on their list with patience reset. If their item is bought by someone else or removed, they move on with their current patience.',
    '',
    'Delegations and money',
    '- delegate(colleague, item, max_price): the colleague buys the item as soon as its price is at or below max_price. max_price is held on the account immediately and the available balance shrinks by that much. One delegation per colleague; cancel before giving a new one. A colleague delegated an item waits on that item.',
    '- cancel_delegation(colleague) releases the hold. buy_now(item) buys at the current price now, paid from the available balance.',
    `- A purchase a colleague makes on their own is paid from the account, including money held for other delegations. If held money is no longer covered, the most recent delegations are cancelled one by one until it is; each cancellation costs a ${CANCEL_FEE} fee and leaves that colleague aggressive with patience 2.`,
    '',
    'Time',
    `- The clearance runs ${TICKS} hours (0-${TICKS - 1}). Each turn you get an observation of the current hour, act with tools, then end the turn with wait(n), n = 1..${WAIT_MAX}. Unfinished delegations lapse when the clearance ends.`,
    ...(noNotice ? [] : ['- Accounting notifies you after money leaves the account; a wait ends early when that happens.']),
    `- You have at most ${MAX_TURNS} turns.`,
    '',
    'Tools',
    '- buy_now(item), delegate(colleague, item, max_price), cancel_delegation(colleague)',
    ...(noCheck
      ? []
      : [
          '- plan_check(plan): simulate a list of your actions and see whether each is affordable, the available balance afterwards, and when each delegation would fill if nobody else acts. Free, does not change anything.',
        ]),
    '- wait(n), finish()',
    '',
    'You only learn things through the observation and tools.',
  ];
  return lines.join('\n');
}

export function systemPrompt(harness) {
  return harness.relabel ? clearancePrompt(harness) : auctionPrompt(harness);
}

export const TOOL_NAMES = {
  auction: { bid: 'bid', authorize: 'authorize', revoke: 'revoke', pool_check: 'pool_check', wait: 'wait', finish: 'finish' },
  clearance: { bid: 'buy_now', authorize: 'delegate', revoke: 'cancel_delegation', pool_check: 'plan_check', wait: 'wait', finish: 'finish' },
};

export const toolNames = (harness) => (harness.relabel ? TOOL_NAMES.clearance : TOOL_NAMES.auction);

export function canonicalToolName(harness, name) {
  const names = toolNames(harness);
  return Object.keys(names).find((key) => names[key] === name) ?? null;
}

export function toolDefinitions(harness) {
  const n = toolNames(harness);
  const lot = harness.relabel ? 'item' : 'lot';
  const member = harness.relabel ? 'colleague' : 'member';
  const fn = (name, description, properties = {}, required = []) => ({
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } },
  });
  const planItem = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: [n.bid, n.authorize, n.revoke] },
      [lot]: { type: 'string' },
      [member]: { type: 'string' },
      max_price: { type: 'number' },
    },
    required: ['action'],
  };
  return [
    fn(n.bid, `Buy a ${lot} at its current price now.`, { [lot]: { type: 'string' } }, [lot]),
    fn(
      n.authorize,
      harness.relabel
        ? 'Delegate an item to a colleague with a maximum price. The max price is held on the account immediately.'
        : 'Authorize a member to buy a lot once its price is at or below max_price. max_price is reserved immediately.',
      { [member]: { type: 'string' }, [lot]: { type: 'string' }, max_price: { type: 'number' } },
      [member, lot, 'max_price'],
    ),
    fn(n.revoke, harness.relabel ? 'Cancel a colleague delegation.' : "Revoke a member's authorization.", { [member]: { type: 'string' } }, [member]),
    ...(harness.noCheck
      ? []
      : [
          fn(
            n.pool_check,
            'Simulate a list of your actions without changing anything. Free.',
            { plan: { type: 'array', items: planItem } },
            ['plan'],
          ),
        ]),
    fn(n.wait, 'End this turn and let time pass.', { n: { type: 'integer', minimum: 1, maximum: WAIT_MAX } }, ['n']),
    fn(n.finish, 'Stop acting; the rest of the session plays out without you.'),
  ];
}

// Canonical internal action from tool arguments, for both vocabularies.
export function canonicalArgs(harness, args) {
  if (!harness.relabel) return { lot: args?.lot, member: args?.member, max: args?.max_price };
  return { lot: args?.item, member: args?.colleague, max: args?.max_price };
}

export function canonicalPlanAction(harness, entry) {
  const type = canonicalToolName(harness, String(entry?.action ?? ''));
  const { lot, member, max } = canonicalArgs(harness, entry);
  return { type: type === 'pool_check' ? null : type, lot, member, max };
}

const KEY_MAP = {
  tick: 'hour',
  ticks_left: 'hours_left',
  lot: 'item',
  lots_on_clock: 'items_on_sale',
  upcoming_lots: 'upcoming_items',
  withdraw_at_tick: 'removed_at_hour',
  enters_at_tick: 'listed_at_hour',
  drop_per_tick: 'markdown_per_hour',
  faster_drop_from_tick: 'faster_markdown_from_hour',
  faster_drop_per_tick: 'faster_markdown_per_hour',
  members: 'colleagues',
  member: 'colleague',
  authorization: 'delegation',
  authorizations: 'delegations',
  pool: 'account',
  fill_tick: 'fill_hour',
  lapsed_orders: 'lapsed_delegations',
  next_lots: 'next_items',
  watched_by: 'wanted_by',
  finance_forecast: 'accounting_forecast',
  start_price: 'starting_tag',
  waited_ticks: 'waited_hours',
};

const VALUE_MAP = {
  SOLD: 'PURCHASED',
  WITHDRAWN: 'REMOVED',
  ROGUE_PURCHASE: 'UNAPPROVED_PURCHASE',
  ORDER_CANCELLED: 'DELEGATION_CANCELLED',
  ORDER_DROPPED: 'DELEGATION_DROPPED',
  UNKNOWN_LOT: 'UNKNOWN_ITEM',
  LOT_NOT_ON_CLOCK: 'ITEM_NOT_ON_SALE',
  MEMBER_ALREADY_AUTHORIZED: 'COLLEAGUE_ALREADY_DELEGATED',
  NO_AUTHORIZATION: 'NO_DELEGATION',
  UNKNOWN_MEMBER: 'UNKNOWN_COLLEAGUE',
  on_clock: 'on_sale',
  'lead bid': 'you',
  authorized: 'delegated',
  'revoke first': 'cancel the delegation first',
  'does not fill before the lot is withdrawn or the auction ends': 'does not fill before the item is removed or the clearance ends',
};

export function localize(harness, value) {
  if (!harness.relabel) return value;
  if (Array.isArray(value)) return value.map((v) => localize(harness, v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [KEY_MAP[k] ?? k, localize(harness, v)]));
  }
  if (typeof value === 'string') return VALUE_MAP[value] ?? value;
  return value;
}

export function terms(harness) {
  return harness.relabel
    ? { tick: 'hour', lot: 'item', pool: 'account', order: 'delegation', fine: 'compliance fine' }
    : { tick: 'tick', lot: 'lot', pool: 'pool', order: 'order', fine: 'compliance fine' };
}
