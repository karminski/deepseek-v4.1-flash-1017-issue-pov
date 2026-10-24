import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as blindBox from './probes/blind-box.mjs';
import * as teamAuction from './probes/team-auction.mjs';

export const PROBES = [blindBox, teamAuction];
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VARIANT_DIR = path.join(ROOT, 'variants');

export function findProbe(id) {
  const probe = PROBES.find((p) => p.id === id);
  if (!probe) throw new Error(`Unknown probe ${id}. Known: ${PROBES.map((p) => p.id).join(', ')}`);
  return probe;
}

export function listVariantIds() {
  return fs
    .readdirSync(VARIANT_DIR)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => name.replace(/\.mjs$/, ''))
    .sort();
}

export async function loadVariant(id) {
  const file = path.join(VARIANT_DIR, `${id}.mjs`);
  if (!fs.existsSync(file)) throw new Error(`Unknown variant ${id}. Known: ${listVariantIds().join(', ')}`);
  const variant = (await import(pathToFileURL(file).href)).default;
  return { ...variant, id };
}
