import { getEnv } from '../env.js';
import { createGeminiClient } from './llm/geminiClient.js';
import { createOllamaClient } from './llm/ollamaClient.js';
import { createOpenAICompatClient } from './llm/openaiCompatClient.js';
import { createSwappableLLM } from './llm/swappableLLM.js';
import { createRoadWatchAgentGraph } from './roadwatchGraph.js';

export function createAgent() {
  const env = getEnv();

  const gemini = createGeminiClient({
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
    apiBaseUrl: env.GEMINI_API_BASE_URL
  });

  const ollama = createOllamaClient({
    baseUrl: env.OLLAMA_BASE_URL,
    model: env.OLLAMA_MODEL
  });

  const llamacpp = createOpenAICompatClient({
    provider: 'llamacpp',
    baseUrl: env.LLAMACPP_BASE_URL,
    model: env.LLAMACPP_MODEL
  });

  const llm = createSwappableLLM({
    order: env.LLM_FALLBACK_ORDER,
    clients: {
      gemini,
      ollama: env.OLLAMA_BASE_URL ? ollama : undefined,
      llamacpp: env.LLAMACPP_BASE_URL ? llamacpp : undefined
    }
  });

  const agent = createRoadWatchAgentGraph(llm);

  return { agent };
}
