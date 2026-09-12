/**
 * Provider-agnostic AI interface. No provider is hard-coded and no API key
 * ever lives in source — every key is read from the environment at call time.
 */

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
};

export type ChatOptions = {
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** JSON schema hint when the caller needs structured output. */
  json?: boolean;
};

export type ChatResponse = {
  content: string;
  model: string;
  provider: string;
  usage?: { promptTokens?: number; completionTokens?: number };
};

export interface AIProvider {
  readonly id: string;
  readonly label: string;
  isConfigured(): boolean;
  chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse>;
  stream?(
    messages: ChatMessage[],
    options: ChatOptions,
    onChunk: (chunk: string) => void,
  ): Promise<ChatResponse>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly code: string = 'PROVIDER_ERROR',
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

/** Strip markdown code fences that models sometimes wrap JSON in. */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf('{');
  const startArr = body.indexOf('[');
  const from =
    start === -1 ? startArr : startArr === -1 ? start : Math.min(start, startArr);
  if (from === -1) return body.trim();
  const isArray = body[from] === '[';
  const end = isArray ? body.lastIndexOf(']') : body.lastIndexOf('}');
  return end === -1 ? body.slice(from).trim() : body.slice(from, end + 1).trim();
}
