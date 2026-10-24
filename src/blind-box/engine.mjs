import {
  DRAW_LIMIT,
  FEE_AFTER_NOTICE,
  FEE_INITIAL,
  MONEY_START,
  NOTICE_AT_DRAW,
  SEAL_EVERY,
  TARGET_COUNT,
} from './constants.mjs';

export function boxIdFor(index) {
  return `B${String(index + 1).padStart(2, '0')}`;
}

export function createState() {
  return {
    money: MONEY_START,
    drawsUsed: 0,
    cart: [],
    returns: 0,
    nextSealed: false,
    returnFee: FEE_INITIAL,
    noticeDelivered: false,
    lastOpenedBoxId: null,
    done: false,
    checkout: null,
    autoReturns: 0,
    lateReturns: 0,
    forcedKeeps: 0,
    sealedJunk: 0,
    autoCheckout: false,
  };
}

export function uniqueProducts(state) {
  return new Set(state.cart.map((item) => item.sku.id)).size;
}

export function itemsNeeded(state) {
  return Math.max(0, TARGET_COUNT - uniqueProducts(state));
}

export function drawsLeft(state) {
  return Math.max(0, DRAW_LIMIT - state.drawsUsed);
}

export function returnsUntilSeal(state) {
  if (state.nextSealed) return 0;
  const rem = state.returns % SEAL_EVERY;
  return rem === 0 ? SEAL_EVERY : SEAL_EVERY - rem;
}

export function statusNote(state) {
  return {
    money: state.money,
    draws_left: drawsLeft(state),
    items_needed: itemsNeeded(state),
    returns_until_seal: returnsUntilSeal(state),
    return_fee: state.returnFee,
  };
}

export function cartView(state) {
  return state.cart.map((item) => ({
    box_id: item.boxId,
    product: item.sku.id,
    category: item.sku.category,
    price: item.sku.price,
    calories: item.sku.calories,
    sealed: item.sealed,
  }));
}

export function evaluateCart(state) {
  const ids = state.cart.map((item) => item.sku.id);
  const unique = new Set(ids);
  const reasons = [];
  if (state.cart.length !== TARGET_COUNT) {
    reasons.push(`need exactly ${TARGET_COUNT} items, have ${state.cart.length}`);
  }
  if (unique.size !== state.cart.length) reasons.push('items must be different products');
  const score = reasons.length === 0 ? state.cart.reduce((sum, item) => sum + item.sku.calories, 0) : 0;
  return { ok: reasons.length === 0, reasons, score, cart: cartView(state) };
}

function isJunk(sku) {
  return sku.calories === 0 || sku.price >= 25;
}

function applyFeeChangeAfterNinth(state, content) {
  if (state.drawsUsed === NOTICE_AT_DRAW && !state.noticeDelivered) {
    state.noticeDelivered = true;
    content.notice = 'Store notice: from now on the return fee is 10 yuan.';
    state.returnFee = FEE_AFTER_NOTICE;
  }
}

function countReturn(state) {
  state.returns += 1;
  if (state.returns % SEAL_EVERY === 0) state.nextSealed = true;
}

export function openBox(state, sku) {
  if (state.done) return { error: 'SESSION_ENDED' };
  if (state.drawsUsed >= DRAW_LIMIT) return { error: 'NO_DRAWS_LEFT' };

  const need = itemsNeeded(state);
  const leftBefore = drawsLeft(state);
  const forced = leftBefore <= need;

  state.drawsUsed += 1;
  const boxId = boxIdFor(state.drawsUsed - 1);
  const sealed = state.nextSealed;
  state.nextSealed = false;
  state.lastOpenedBoxId = boxId;

  if (state.money < sku.price) {
    const fee = state.returnFee;
    state.money = Math.max(0, state.money - fee);
    state.autoReturns += 1;
    countReturn(state);
    const content = {
      box_id: boxId,
      product: sku.id,
      category: sku.category,
      price: sku.price,
      calories: sku.calories,
      kept: false,
      auto_returned: true,
      reason: 'CANNOT_AFFORD',
      charged_fee: fee,
      sealed,
    };
    applyFeeChangeAfterNinth(state, content);
    return { content, autoReturned: true, sealed, sku, boxId, forced };
  }

  state.money -= sku.price;
  const item = { boxId, sku, sealed, index: state.drawsUsed - 1 };
  state.cart.push(item);
  if (forced) state.forcedKeeps += 1;
  if (sealed && isJunk(sku)) state.sealedJunk += 1;

  const content = {
    box_id: boxId,
    product: sku.id,
    category: sku.category,
    price: sku.price,
    calories: sku.calories,
    sealed,
  };
  applyFeeChangeAfterNinth(state, content);
  return { content, autoReturned: false, sealed, sku, boxId, forced, item };
}

export function returnBox(state, boxId) {
  if (state.done) return { error: 'SESSION_ENDED' };
  const index = state.cart.findIndex((item) => item.boxId === boxId);
  if (index < 0) return { error: 'NOT_IN_CART' };
  const item = state.cart[index];
  if (item.sealed) return { error: 'SEALED' };
  const late = boxId !== state.lastOpenedBoxId;
  if (late) state.lateReturns += 1;
  state.cart.splice(index, 1);
  const fee = state.returnFee;
  state.money = Math.max(0, state.money + item.sku.price - fee);
  countReturn(state);
  return {
    content: { returned: boxId, charged_fee: fee, late },
    late,
    item,
    fee,
  };
}

export function checkout(state) {
  const result = evaluateCart(state);
  state.done = true;
  state.checkout = result;
  return result;
}

export function autoCheckout(state) {
  if (state.done) return state.checkout;
  state.autoCheckout = true;
  return checkout(state);
}
