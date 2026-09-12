import { AIProvider, ChatMessage, ChatOptions, ChatResponse } from './provider.js';

/**
 * Deterministic provider used for tests and offline operation. It never
 * calls the network and always produces a structured, inspectable reply.
 * This is what makes KAIDO's test suite hermetic.
 */
export class MockProvider implements AIProvider {
  readonly id = 'mock';
  readonly label = 'Deterministic (test/offline)';

  private queue: string[] = [];

  constructor(private readonly reply?: (messages: ChatMessage[], options: ChatOptions) => string) {}

  /** Pre-load a sequence of replies for scripted tests. */
  enqueue(...replies: string[]): this {
    this.queue.push(...replies);
    return this;
  }

  isConfigured(): boolean {
    return true;
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse> {
    let content: string;
    if (this.queue.length > 0) {
      content = this.queue.shift()!;
    } else if (this.reply) {
      content = this.reply(messages, options);
    } else {
      const last = [...messages].reverse().find((m) => m.role === 'user');
      content = `MOCK_REPLY: ${last?.content ?? ''}`;
    }
    return { content, model: options.model, provider: this.id };
  }
}
