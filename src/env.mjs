import fs from 'node:fs';

// Values are never logged: callers only receive the parsed config object.
export function parseEnvFile(path) {
  const text = fs.readFileSync(path, 'utf8');
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted) {
      value = value.slice(1, -1);
    } else {
      const comment = value.indexOf(' #');
      if (comment >= 0) value = value.slice(0, comment).trim();
    }
    out[match[1]] = value;
  }
  return out;
}

function optionalNumber(value) {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function modelConfigFromEnv(env, overrides = {}) {
  const config = {
    apiKey: env.OPENAI_API_KEY ?? '',
    baseURL: (env.OPENAI_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
    model: env.OPENAI_MODEL ?? '',
    maxTokens: optionalNumber(env.OPENAI_MAX_TOKENS) ?? 32768,
    timeoutMs: overrides.timeoutMs ?? Math.max(optionalNumber(env.OPENAI_TIMEOUT_MS) ?? 0, 300_000),
    temperature: optionalNumber(env.OPENAI_TEMPERATURE),
    thinkingType: env.OPENAI_THINKING || undefined,
    reasoningEffort: env.OPENAI_REASONING_EFFORT || undefined,
    replayReasoning: (env.OPENAI_REPLAY_REASONING_CONTENT ?? 'true').toLowerCase() === 'true',
    maxRetries: overrides.maxRetries ?? 4,
  };
  if (!config.apiKey || !config.model) {
    throw new Error('OPENAI_API_KEY and OPENAI_MODEL must be set in the env file');
  }
  return config;
}
