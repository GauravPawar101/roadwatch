export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export type ChatMessage = {
  role: ChatRole;
  content: string;
  // OpenAI-compatible tool role support.
  name?: string;
  tool_call_id?: string;
};

export type ToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    // JSON Schema (Draft 7-ish) as accepted by OpenAI-compatible /v1/chat/completions.
    parameters: Record<string, any>;
  };
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: unknown;
};

export type ChatCompletion = {
  content: string;
  provider: 'gemini' | 'ollama' | 'llamacpp';
  model?: string;
  toolCalls?: ToolCall[];
};

export type LLMClient = {
  provider: ChatCompletion['provider'];
  model?: string;
  chat(messages: ChatMessage[], options?: { temperature?: number }): Promise<ChatCompletion>;
  chatWithTools?: (
    messages: ChatMessage[],
    tools: ToolDefinition[],
    options?: { temperature?: number }
  ) => Promise<ChatCompletion>;
};
