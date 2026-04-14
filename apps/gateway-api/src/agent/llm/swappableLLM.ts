import type { ChatCompletion, ChatMessage, LLMClient, ToolDefinition } from './types.js';

function parseOrder(order: string): Array<ChatCompletion['provider']> {
  const parts = order
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const normalized: Array<ChatCompletion['provider']> = [];
  for (const p of parts) {
    if (p === 'gemini' || p === 'ollama' || p === 'llamacpp') normalized.push(p);
  }

  return normalized.length ? normalized : ['gemini', 'ollama', 'llamacpp'];
}

function shouldFallback(err: unknown) {
  const anyErr = err as any;
  if (anyErr?.isQuotaOrRateLimit) return true;
  const status = typeof anyErr?.status === 'number' ? anyErr.status : undefined;
  if (status === 429 || status === 503) return true;

  const msg = String(anyErr?.message ?? '').toLowerCase();
  if (msg.includes('not configured') || msg.includes('missing')) return true;
  return msg.includes('quota') || msg.includes('rate limit') || msg.includes('resource exhausted');
}

export function createSwappableLLM(params: {
  order: string;
  clients: Partial<Record<ChatCompletion['provider'], LLMClient>>;
}): LLMClient {
  const orderedProviders = parseOrder(params.order);

  return {
    provider: 'gemini',
    async chat(messages: ChatMessage[], options) {
      let lastError: unknown;

      for (const provider of orderedProviders) {
        const client = params.clients[provider];
        if (!client) continue;

        try {
          return await client.chat(messages, options);
        } catch (err) {
          lastError = err;
          if (!shouldFallback(err)) throw err;
        }
      }

      throw lastError ?? new Error('No LLM providers configured');
    },
    async chatWithTools(messages: ChatMessage[], tools: ToolDefinition[], options) {
      let lastError: unknown;

      for (const provider of orderedProviders) {
        const client = params.clients[provider];
        if (!client?.chatWithTools) continue;

        try {
          return await client.chatWithTools(messages, tools, options);
        } catch (err) {
          lastError = err;
          if (!shouldFallback(err)) throw err;
        }
      }

      // Graceful fallback: run plain chat (no tools) if tool-calling isn't available.
      for (const provider of orderedProviders) {
        const client = params.clients[provider];
        if (!client) continue;
        try {
          return await client.chat(messages, options);
        } catch (err) {
          lastError = err;
          if (!shouldFallback(err)) throw err;
        }
      }

      throw lastError ?? new Error('No LLM providers configured');
    }
  };
}
