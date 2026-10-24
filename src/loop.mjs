import fs from 'node:fs';
import { chatCompletion } from './client.mjs';

const NUDGE = 'Continue: act by calling one of the tools.';

// Each cycle starts from a fresh [system, user] context, like silicon-conductor-bench decision cycles.
export async function runEpisode({ config, probe, variant, seed, transcriptPath }) {
  const world = probe.create({ seed, harness: variant.harness ?? {} });
  const addendum = variant.addendum?.(probe.id) ?? '';
  const system = addendum ? `${world.system}\n\n${addendum}` : world.system;
  const usage = { requests: 0, promptTokens: 0, completionTokens: 0, reasoningChars: 0, ms: 0 };
  const write = (event) => fs.appendFileSync(transcriptPath, `${JSON.stringify(event)}\n`);

  write({ event: 'episode_start', probe: probe.id, variant: variant.id, seed, system });
  let cycle = 0;
  while (!world.isDone()) {
    const user = world.nextCycle();
    if (user === null) break;
    cycle += 1;
    write({ event: 'cycle_start', cycle, user });
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
    let ended = false;
    let nudged = false;
    for (let round = 1; round <= world.maxRoundsPerCycle && !ended; round += 1) {
      const response = await chatCompletion(config, { messages, tools: world.tools });
      usage.requests += 1;
      usage.ms += response.ms;
      usage.promptTokens += response.usage?.prompt_tokens ?? 0;
      usage.completionTokens += response.usage?.completion_tokens ?? 0;
      const message = response.message;
      const reasoning = message.reasoning_content ?? message.reasoning ?? '';
      const toolCalls = message.tool_calls ?? [];
      usage.reasoningChars += reasoning.length;
      write({
        event: 'assistant',
        cycle,
        round,
        finishReason: response.finishReason,
        reasoning,
        content: message.content ?? '',
        toolCalls: toolCalls.map((call) => ({ name: call.function?.name, arguments: call.function?.arguments })),
      });
      world.onAssistant?.({ reasoning, content: message.content ?? '', toolCalls, round, cycle });
      messages.push({
        role: 'assistant',
        content: message.content ?? '',
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        ...(config.replayReasoning && reasoning ? { reasoning_content: reasoning } : {}),
      });

      if (toolCalls.length === 0) {
        if (nudged) break;
        nudged = true;
        messages.push({ role: 'user', content: NUDGE });
        continue;
      }
      for (const call of toolCalls) {
        const name = call.function?.name ?? '';
        let args = null;
        try {
          args = JSON.parse(call.function?.arguments || '{}');
        } catch {
          args = null;
        }
        let result;
        if (ended) result = { content: { error: 'CYCLE_ALREADY_ENDED' } };
        else if (args === null) result = { content: { error: 'INVALID_JSON_ARGUMENTS' } };
        else result = world.handleCall(name, args);
        const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
        messages.push({ role: 'tool', tool_call_id: call.id, content });
        write({ event: 'tool', cycle, round, name, args, result: result.content });
        if (result.endCycle || world.isDone()) ended = true;
      }
    }
    if (!ended) {
      world.onCycleTimeout?.();
      write({ event: 'cycle_timeout', cycle });
    }
  }
  const metrics = world.metrics();
  write({ event: 'episode_end', metrics, usage });
  return { metrics, usage };
}
