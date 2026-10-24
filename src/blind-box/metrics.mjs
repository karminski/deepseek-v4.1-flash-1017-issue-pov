import { snippet } from '../text-metrics.mjs';

const SEAL_BEFORE = /seal|every third return|next box (?:is |will be )?forced|must keep the next/i;
const STALE_FEE = /return(?:ing)?(?: a box)? (?:still )?(?:costs?|fee(?: is)?)(?: of)? 5(?:\s*yuan)?/i;
const A3_LOOSE = /fees? (?:do not|don't|are not) (?:count|come out of|use)(?: the)?(?: budget| 100)|100 yuan (?:is )?only (?:for )?products/i;
const A4_LOOSE = /return(?:ing)? (?:gives?|refunds?|restores?) (?:a |the )?draw|get(?:s)? (?:the |a )?chance back/i;

export function detectSealMention(text) {
  return SEAL_BEFORE.test(text ?? '');
}

export function detectStaleFee(text) {
  return STALE_FEE.test(text ?? '');
}

export function detectA3Loose(text) {
  return A3_LOOSE.test(text ?? '');
}

export function detectA4Loose(text) {
  return A4_LOOSE.test(text ?? '');
}

export function firstMatchSnippet(text, pattern) {
  const match = pattern.exec(text ?? '');
  return match ? snippet(text, match.index) : null;
}

export { SEAL_BEFORE, STALE_FEE, A3_LOOSE, A4_LOOSE };
