import { Adapter, AdapterResult, Capability } from './types.js';

export type SearchResult = { title: string; url: string; snippet: string };
export type ExtractedPage = { url: string; title: string; text: string };

/**
 * Web adapter — a real implementation, not a stub.
 *
 * Search has no key-free provider that is reliable enough to hard-code, so it
 * reports UNAVAILABLE with a clear reason unless a provider is configured.
 * Extraction is implemented properly: it fetches, strips scripts/styles/tags,
 * caps the size, and returns text. Critically, the result is returned as
 * UNTRUSTED content — see the tool layer, which wraps it before a model sees it.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BYTES = 2_000_000;
const MAX_TEXT = 20_000;

/** Block obvious SSRF targets: loopback, link-local, private ranges, metadata. */
export function isBlockedUrl(url: string): { blocked: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { blocked: true, reason: 'Not a valid absolute URL.' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { blocked: true, reason: `Protocol "${parsed.protocol}" is not permitted.` };
  }
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0') {
    return { blocked: true, reason: 'Localhost targets are not permitted.' };
  }
  if (host === '169.254.169.254' || host.startsWith('169.254.')) {
    return { blocked: true, reason: 'Link-local / cloud metadata addresses are not permitted.' };
  }
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) {
    return { blocked: true, reason: 'Private network addresses are not permitted.' };
  }
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return { blocked: true, reason: 'Private network addresses are not permitted.' };
  }
  if (host === '[::1]' || host === '::1') {
    return { blocked: true, reason: 'IPv6 loopback is not permitted.' };
  }
  return { blocked: false };
}

/** Strip HTML to readable text. Conservative — drops script/style entirely. */
export function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]!.trim()) : '';
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text: decodeEntities(text).slice(0, MAX_TEXT) };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–');
}

export class WebAdapter implements Adapter {
  readonly id = 'web';
  readonly label = 'Web (fetch + extract)';
  readonly capabilities: Capability[] = ['web'];

  constructor(
    private readonly searchEndpoint: string | undefined = process.env.KAIDO_WEB_SEARCH_URL,
    private readonly searchKey: string | undefined = process.env.KAIDO_WEB_SEARCH_KEY,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async probe(): Promise<{ state: 'MOUNTED' | 'NOT_MOUNTED' | 'UNAVAILABLE'; detail?: string }> {
    return { state: 'MOUNTED', detail: 'HTTP extraction available; search needs a provider.' };
  }

  /** Fetch and extract page text. Never logs the body. */
  async extract(url: string): Promise<AdapterResult<ExtractedPage>> {
    const guard = isBlockedUrl(url);
    if (guard.blocked) {
      return { ok: false, code: 'URL_BLOCKED', error: guard.reason ?? 'URL not permitted.' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'user-agent': 'KAIDO/0.1 (+personal agent)', accept: 'text/html,*/*' },
      });
      if (!res.ok) {
        return { ok: false, code: `HTTP_${res.status}`, error: `The site returned ${res.status}.` };
      }
      const ctype = res.headers.get('content-type') ?? '';
      if (!/text\/html|text\/plain|application\/xhtml/i.test(ctype)) {
        return {
          ok: false,
          code: 'UNSUPPORTED_CONTENT',
          error: `Content type "${ctype || 'unknown'}" cannot be extracted as text.`,
        };
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) {
        return { ok: false, code: 'TOO_LARGE', error: 'Page exceeds the 2 MB extraction limit.' };
      }
      const html = new TextDecoder('utf-8').decode(buf);
      const { title, text } = htmlToText(html);
      return { ok: true, data: { url, title, text } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        code: message.includes('abort') ? 'TIMEOUT' : 'FETCH_FAILED',
        error: `Could not fetch the page: ${message}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Search requires an explicitly configured provider — never a hard-coded one. */
  async search(query: string): Promise<AdapterResult<SearchResult[]>> {
    if (!this.searchEndpoint) {
      return {
        ok: false,
        code: 'SEARCH_NOT_CONFIGURED',
        error:
          'Web search needs a provider. Set KAIDO_WEB_SEARCH_URL (and KAIDO_WEB_SEARCH_KEY if required) to enable it. Extraction works without one.',
      };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = `${this.searchEndpoint}${this.searchEndpoint.includes('?') ? '&' : '?'}q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: this.searchKey ? { authorization: `Bearer ${this.searchKey}` } : {},
      });
      if (!res.ok) {
        return { ok: false, code: `HTTP_${res.status}`, error: `Search provider returned ${res.status}.` };
      }
      const json = (await res.json()) as { results?: SearchResult[] };
      const results = (json.results ?? []).slice(0, 10).map((r) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: (r.snippet ?? '').slice(0, 500),
      }));
      return { ok: true, data: results };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, code: 'SEARCH_FAILED', error: `Search failed: ${message}` };
    } finally {
      clearTimeout(timer);
    }
  }
}
