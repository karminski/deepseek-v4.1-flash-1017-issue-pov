const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class RetryableError extends Error {}

export async function chatCompletion(config, { messages, tools }) {
  const body = {
    model: config.model,
    max_tokens: config.maxTokens,
    messages,
    tools,
    tool_choice: 'auto',
  };
  if (config.temperature !== undefined) body.temperature = config.temperature;
  if (config.thinkingType) body.thinking = { type: config.thinkingType };
  if (config.reasoningEffort) body.reasoning_effort = config.reasoningEffort;

  let lastError;
  for (let attempt = 1; attempt <= config.maxRetries; attempt += 1) {
    const started = Date.now();
    try {
      const response = await fetch(`${config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      const text = await response.text();
      if (!response.ok) {
        const message = `HTTP ${response.status}: ${text.slice(0, 300)}`;
        if (response.status === 429 || response.status >= 500) throw new RetryableError(message);
        throw new Error(message);
      }
      const json = JSON.parse(text);
      const choice = json.choices?.[0] ?? {};
      return {
        message: choice.message ?? {},
        finishReason: choice.finish_reason ?? null,
        usage: json.usage ?? null,
        ms: Date.now() - started,
      };
    } catch (error) {
      const retryable =
        error instanceof RetryableError ||
        error?.name === 'TimeoutError' ||
        error?.name === 'AbortError' ||
        error instanceof SyntaxError ||
        error?.cause?.code !== undefined;
      if (!retryable) throw error;
      lastError = error;
      await sleep(Math.min(30_000, 2_000 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}
