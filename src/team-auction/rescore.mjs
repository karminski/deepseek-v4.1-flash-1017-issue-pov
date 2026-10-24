// Recompute episode metrics from a saved transcript with the current regex.
// The engine is deterministic, so replaying the recorded tool calls reproduces the episode.
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import * as probe from '../probes/team-auction.mjs';

const HARNESS = {
  'a0-baseline': {},
  'a1-no-notice': { noNotice: true },
  'a2-priced': { priced: true },
  'a3-warned': { warned: true },
  'a4-no-check': { noCheck: true },
  'a5-relabeled': { relabel: true },
};

export async function rescoreTranscript(file, { variant, seed }) {
  const world = probe.create({ seed, harness: HARNESS[variant] ?? {} });
  const lines = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (event.event === 'cycle_start') world.nextCycle();
    else if (event.event === 'assistant') world.onAssistant({ reasoning: event.reasoning, content: event.content });
    else if (event.event === 'tool') world.handleCall(event.name, event.args ?? {});
    else if (event.event === 'cycle_timeout') world.onCycleTimeout();
  }
  return world.metrics();
}
