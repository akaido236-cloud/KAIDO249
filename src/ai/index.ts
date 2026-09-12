import { AIProvider, AIProviderError } from './provider.js';
import { GeminiProvider } from './gemini.js';
import { MockProvider } from './mock.js';

/**
 * Provider registry. Adding a provider is one entry here plus its class —
 * no call site changes. Selected via KAIDO_AI_PROVIDER (default: gemini).
 */
export function createProvider(id?: string): AIProvider {
  const which = (id ?? process.env.KAIDO_AI_PROVIDER ?? 'gemini').toLowerCase();
  switch (which) {
    case 'gemini':
      return new GeminiProvider();
    case 'mock':
      return new MockProvider();
    default:
      throw new AIProviderError(
        `Unknown AI provider "${which}". Supported: gemini, mock. Add a class in src/ai/ to extend.`,
        which,
        'UNKNOWN_PROVIDER',
      );
  }
}

export { GeminiProvider, MockProvider };
export type { AIProvider };
