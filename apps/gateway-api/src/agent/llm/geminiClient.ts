import type { ChatCompletion, ChatMessage, LLMClient } from './types.js';

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string; status?: string; code?: number };
};

function toGeminiContents(messages: ChatMessage[]) {
  // Gemini's API uses a role+parts shape. Keep it simple.
  // Map roles: system/user/assistant -> user/model, but preserve system as a prefix.
  const systemPrefix = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
    .trim();

  const nonSystem = messages.filter((m) => m.role !== 'system');

  const contents = nonSystem.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  if (systemPrefix) {
    // Prepend to the first user message (lowest-common-denominator behavior across models).
    const firstUserIndex = contents.findIndex((c) => c.role === 'user');
    if (firstUserIndex >= 0) {
      const current = contents[firstUserIndex];
      if (current) {
        const prev = current.parts[0]?.text ?? '';
        contents[firstUserIndex] = {
          role: current.role,
          parts: [{ text: `${systemPrefix}\n\n${prev}` }]
        };
      }
    } else {
      contents.unshift({ role: 'user', parts: [{ text: systemPrefix }] });
    }
  }

  return contents;
}

function extractText(resp: GeminiGenerateContentResponse): string {
  const text = resp.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  return text.trim();
}

function isQuotaOrRateLimit(status: number, message: string | undefined) {
  if (status === 429) return true;
  const msg = (message ?? '').toLowerCase();
  return msg.includes('quota') || msg.includes('rate') || msg.includes('resource exhausted');
}

export function createGeminiClient(params: {
  apiKey?: string;
  model: string;
  apiBaseUrl: string;
}): LLMClient {
  return {
    provider: 'gemini',
    model: params.model,
    async chat(messages, options): Promise<ChatCompletion> {
      if (!params.apiKey) {
        throw new Error('Gemini API key is not configured');
      }

      const url = `${params.apiBaseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(params.apiKey)}`;

      const body = {
        contents: toGeminiContents(messages),
        generationConfig: {
          temperature: options?.temperature ?? 0.2
        }
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const text = await res.text();
      let json: GeminiGenerateContentResponse | null = null;
      try {
        json = JSON.parse(text) as GeminiGenerateContentResponse;
      } catch {
        // non-json response
      }

      if (!res.ok) {
        const errMsg = json?.error?.message ?? text;
        const err = new Error(`Gemini error (${res.status}): ${errMsg}`);
        (err as any).status = res.status;
        (err as any).isQuotaOrRateLimit = isQuotaOrRateLimit(res.status, errMsg);
        throw err;
      }

      const content = json ? extractText(json) : '';
      if (!content) {
        throw new Error('Gemini returned an empty response');
      }

      return { content, provider: 'gemini', model: params.model };
    }
  };
}
