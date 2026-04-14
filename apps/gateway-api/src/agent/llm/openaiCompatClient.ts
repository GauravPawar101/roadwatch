import type { ChatCompletion, LLMClient, ToolCall, ToolDefinition } from './types.js';

type OpenAIChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
      tool_calls?: Array<{
        id: string;
        type?: string;
        function?: { name: string; arguments: string };
      }>;
    };
  }>;
  error?: { message?: string; type?: string; code?: string | number };
};

function parseToolCalls(resp: OpenAIChatCompletionResponse): ToolCall[] {
  const raw = resp.choices?.[0]?.message?.tool_calls ?? [];
  const out: ToolCall[] = [];
  for (const tc of raw) {
    const name = tc.function?.name;
    const argsRaw = tc.function?.arguments;
    if (!tc.id || !name || typeof argsRaw !== 'string') continue;
    let parsed: unknown = {};
    try {
      parsed = argsRaw ? JSON.parse(argsRaw) : {};
    } catch {
      parsed = { __raw: argsRaw };
    }
    out.push({ id: tc.id, name, arguments: parsed });
  }
  return out;
}

export function createOpenAICompatClient(params: {
  provider: 'ollama' | 'llamacpp';
  baseUrl?: string;
  model: string;
  apiKey?: string;
}): LLMClient {
  return {
    provider: params.provider,
    model: params.model,
    async chat(messages, options): Promise<ChatCompletion> {
      if (!params.baseUrl) {
        throw new Error(`${params.provider} base URL is not configured`);
      }

      const url = `${params.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: params.model,
          messages,
          temperature: options?.temperature ?? 0.2
        })
      });

      const raw = await res.text();
      let json: OpenAIChatCompletionResponse | null = null;
      try {
        json = JSON.parse(raw) as OpenAIChatCompletionResponse;
      } catch {
        // ignore
      }

      if (!res.ok) {
        const msg = json?.error?.message ?? raw;
        const err = new Error(`${params.provider} error (${res.status}): ${msg}`);
        (err as any).status = res.status;
        throw err;
      }

      const content = (json?.choices?.[0]?.message?.content ?? '').trim();
      if (!content) {
        throw new Error(`${params.provider} returned an empty response`);
      }

      return { content, provider: params.provider, model: params.model };
    },
    async chatWithTools(messages, tools, options): Promise<ChatCompletion> {
      if (!params.baseUrl) {
        throw new Error(`${params.provider} base URL is not configured`);
      }

      const url = `${params.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: params.model,
          messages,
          tools: tools as ToolDefinition[],
          tool_choice: 'auto',
          temperature: options?.temperature ?? 0.2
        })
      });

      const raw = await res.text();
      let json: OpenAIChatCompletionResponse | null = null;
      try {
        json = JSON.parse(raw) as OpenAIChatCompletionResponse;
      } catch {
        // ignore
      }

      if (!res.ok) {
        const msg = json?.error?.message ?? raw;
        const err = new Error(`${params.provider} error (${res.status}): ${msg}`);
        (err as any).status = res.status;
        throw err;
      }

      const content = (json?.choices?.[0]?.message?.content ?? '').trim();
      const toolCalls = json ? parseToolCalls(json) : [];

      // OpenAI may return tool calls with empty content; that's valid.
      if (!content && !toolCalls.length) {
        throw new Error(`${params.provider} returned an empty response`);
      }

      return { content, toolCalls, provider: params.provider, model: params.model };
    }
  };
}
