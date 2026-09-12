import { AIProvider, ChatMessage, ChatOptions, ChatResponse, AIProviderError } from './provider.js';

/**
 * Google Gemini provider (the default for KAIDO).
 * Uses the public Generative Language REST API. Key read from GEMINI_API_KEY.
 */
export class GeminiProvider implements AIProvider {
  readonly id = 'gemini';
  readonly label = 'Google Gemini';

  constructor(
    private readonly apiKey: string | undefined = process.env.GEMINI_API_KEY,
    private readonly baseUrl: string = 'https://generativelanguage.googleapis.com/v1beta',
  ) {}

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse> {
    if (!this.isConfigured()) {
      throw new AIProviderError('GEMINI_API_KEY is not set.', this.id, 'NOT_CONFIGURED');
    }
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.4,
        maxOutputTokens: options.maxTokens ?? 2048,
        ...(options.json ? { responseMimeType: 'application/json' } : {}),
      },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    const url = `${this.baseUrl}/models/${encodeURIComponent(options.model)}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new AIProviderError(
        `Gemini API returned ${res.status}: ${text.slice(0, 300)}`,
        this.id,
        `HTTP_${res.status}`,
      );
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const content =
      json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    return {
      content,
      model: options.model,
      provider: this.id,
      usage: {
        promptTokens: json.usageMetadata?.promptTokenCount,
        completionTokens: json.usageMetadata?.candidatesTokenCount,
      },
    };
  }
}
