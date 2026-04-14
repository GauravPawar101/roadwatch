export interface PromptTemplate<TInput, TOutput> {
  id: string;
  version: string;
  role: string;
  network: 'online' | 'offline' | 'both';
  model: 'gemini' | 'mlkit' | 'any';
  maxTokens: number;
  temperature: number;
  build(input: TInput): string;
  parse(raw: string): Result<TOutput, ParseError>;
  validate(output: TOutput): ValidationResult;
}

export interface Result<T, E> {
  ok: boolean;
  value?: T;
  error?: E;
}

export interface ParseError {
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}
