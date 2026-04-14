import type { ChatCompletion, ChatMessage, LLMClient } from './types.js';

type OllamaChatResponse = {
  message?: { role?: string; content?: string };
  error?: string;
};

export function createOllamaClient(params: { baseUrl?: string; model: string }): LLMClient {
  return {
    provider: 'ollama',
    model: params.model,
    async chat(messages: ChatMessage[], options): Promise<ChatCompletion> {
      if (!params.baseUrl) {
        throw new Error('Ollama base URL is not configured');
      }

      const url = `${params.baseUrl.replace(/\/$/, '')}/api/chat`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: params.model,
          messages,
          stream: false,
          options: {
            temperature: options?.temperature ?? 0.2
          }
        })
      });

      const raw = await res.text();
      let json: OllamaChatResponse | null = null;
      try {
        json = JSON.parse(raw) as OllamaChatResponse;
      } catch {
        // ignore
      }

      if (!res.ok) {
        const msg = json?.error ?? raw;
        const err = new Error(`ollama error (${res.status}): ${msg}`);
        (err as any).status = res.status;
        throw err;
      }

      const content = (json?.message?.content ?? '').trim();
      if (!content) {
        throw new Error('ollama returned an empty response');
      }

      return { content, provider: 'ollama', model: params.model };
    }
  };
}
