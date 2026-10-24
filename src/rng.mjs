// Deterministic randomness keyed by (seed, labels) so the hidden world does not shift with model actions.
export function hashUnit(...parts) {
  let h = 2166136261;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hashInt(lo, hi, ...parts) {
  return lo + Math.floor(hashUnit(...parts) * (hi - lo + 1));
}

export function hashPick(items, ...parts) {
  return items[Math.floor(hashUnit(...parts) * items.length)];
}
