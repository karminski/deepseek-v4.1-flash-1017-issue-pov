// Heuristic extractors over reasoning text. They over-match planning phrases, so treat results as indicators.

const REMAINING_PATTERNS = [
  /(\d{1,3})\s+(?:tool\s+)?calls?\s+(?:left|remaining)/gi,
  /remaining(?:\s+tool)?(?:\s+calls?|\s+budget)\s*(?:is|:|=|of)?\s*~?\(?(\d{1,3})\)?/gi,
  /(\d{1,3})\s+(?:more\s+)?(?:tool\s+)?calls?\s+(?:available|to spare)/gi,
];
const USED_OF_PATTERN = /used\s+~?(\d{1,3})\s*(?:\/|of|out of)\s*(\d{1,3})/gi;

export function claimedRemaining(text, budget) {
  const claims = [];
  for (const pattern of REMAINING_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1]);
      if (value >= 0 && value <= budget) claims.push({ value, snippet: snippet(text, match.index) });
    }
  }
  USED_OF_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(USED_OF_PATTERN)) {
    const used = Number(match[1]);
    const total = Number(match[2]);
    if (total === budget && used <= budget) {
      claims.push({ value: budget - used, snippet: snippet(text, match.index) });
    }
  }
  return claims;
}

export function countMatches(text, patterns) {
  let total = 0;
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    total += [...text.matchAll(pattern)].length;
  }
  return total;
}

export function snippet(text, index, width = 90) {
  return text
    .slice(Math.max(0, index - width), index + width)
    .replace(/\s+/g, ' ')
    .trim();
}

export function mean(values) {
  const list = values.filter((value) => Number.isFinite(value));
  return list.length === 0 ? null : list.reduce((sum, value) => sum + value, 0) / list.length;
}
