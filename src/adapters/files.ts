import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { isAbsolute, join, normalize, resolve, relative, sep } from 'node:path';
import { Adapter, AdapterResult, Capability } from './types.js';

export type FileEntry = { path: string; size: number; modified: string; isDirectory: boolean };

/**
 * Filesystem adapter, scoped to a root directory.
 *
 * The scope is not advisory: every path is resolved and then checked to be
 * inside the root, so `../../etc/passwd` and absolute escapes are refused.
 * This is the containment that makes a file tool safe to hand to an agent.
 */
export class FilesAdapter implements Adapter {
  readonly id = 'files';
  readonly label = 'Files (scoped)';
  readonly capabilities: Capability[] = ['files'];

  private readonly root: string;

  constructor(root: string, private readonly maxBytes = 1_000_000) {
    this.root = resolve(root);
  }

  async probe(): Promise<{ state: 'MOUNTED' | 'NOT_MOUNTED' | 'UNAVAILABLE'; detail?: string }> {
    return existsSync(this.root)
      ? { state: 'MOUNTED', detail: `Scoped to ${this.root}` }
      : { state: 'UNAVAILABLE', detail: `Root does not exist: ${this.root}` };
  }

  /** Resolve a user/agent-supplied path and confirm it stays inside the root. */
  private safePath(input: string): { ok: true; abs: string } | { ok: false; error: string } {
    if (isAbsolute(input)) {
      return { ok: false, error: 'Absolute paths are not permitted; use a path relative to the project root.' };
    }
    const abs = resolve(this.root, normalize(input));
    const rel = relative(this.root, abs);
    if (rel.startsWith('..') || (rel !== '' && rel.split(sep)[0] === '..')) {
      return { ok: false, error: 'Path escapes the permitted root directory.' };
    }
    return { ok: true, abs };
  }

  async read(path: string): Promise<AdapterResult<{ path: string; content: string; truncated: boolean }>> {
    const p = this.safePath(path);
    if (!p.ok) return { ok: false, code: 'PATH_REFUSED', error: p.error };
    try {
      const stat = await fs.stat(p.abs);
      if (stat.isDirectory()) {
        return { ok: false, code: 'IS_DIRECTORY', error: 'That path is a directory.' };
      }
      const truncated = stat.size > this.maxBytes;
      const handle = await fs.open(p.abs, 'r');
      try {
        const length = truncated ? this.maxBytes : stat.size;
        const buf = Buffer.alloc(length);
        await handle.read(buf, 0, length, 0);
        return { ok: true, data: { path, content: buf.toString('utf8'), truncated } };
      } finally {
        await handle.close();
      }
    } catch (err) {
      return { ok: false, code: 'READ_FAILED', error: err instanceof Error ? err.message : String(err) };
    }
  }

  async list(directory = '.'): Promise<AdapterResult<FileEntry[]>> {
    const p = this.safePath(directory);
    if (!p.ok) return { ok: false, code: 'PATH_REFUSED', error: p.error };
    try {
      const names = await fs.readdir(p.abs);
      const entries: FileEntry[] = [];
      for (const name of names.slice(0, 500)) {
        const abs = join(p.abs, name);
        try {
          const s = await fs.stat(abs);
          entries.push({
            path: relative(this.root, abs),
            size: s.size,
            modified: s.mtime.toISOString(),
            isDirectory: s.isDirectory(),
          });
        } catch {
          /* skip entries we cannot stat */
        }
      }
      return { ok: true, data: entries };
    } catch (err) {
      return { ok: false, code: 'LIST_FAILED', error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Search by filename substring. Read-only; never follows out of the root. */
  async search(query: string, limit = 100): Promise<AdapterResult<FileEntry[]>> {
    if (!query || query.length < 2) {
      return { ok: false, code: 'QUERY_TOO_SHORT', error: 'Search query must be at least 2 characters.' };
    }
    const needle = query.toLowerCase();
    const results: FileEntry[] = [];
    const skip = new Set(['node_modules', '.git', 'dist', '.next', 'build']);
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 6 || results.length >= limit) return;
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch {
        return;
      }
      for (const name of names) {
        if (results.length >= limit) return;
        if (skip.has(name)) continue;
        const abs = join(dir, name);
        if (name.toLowerCase().includes(needle)) {
          try {
            const s = await fs.stat(abs);
            results.push({
              path: relative(this.root, abs),
              size: s.size,
              modified: s.mtime.toISOString(),
              isDirectory: s.isDirectory(),
            });
          } catch {
            /* ignore */
          }
        }
        try {
          const s = await fs.stat(abs);
          if (s.isDirectory()) await walk(abs, depth + 1);
        } catch {
          /* ignore */
        }
      }
    };
    await walk(this.root, 0);
    return { ok: true, data: results };
  }

  /** Write text to a file inside the root, creating parent directories. */
  async write(path: string, content: string): Promise<AdapterResult<{ path: string; bytes: number }>> {
    const p = this.safePath(path);
    if (!p.ok) return { ok: false, code: 'PATH_REFUSED', error: p.error };
    try {
      const dir = p.abs.slice(0, p.abs.lastIndexOf(sep));
      if (dir && dir.length >= this.root.length) {
        await fs.mkdir(dir, { recursive: true });
      }
      await fs.writeFile(p.abs, content, 'utf8');
      return { ok: true, data: { path, bytes: Buffer.byteLength(content, 'utf8') } };
    } catch (err) {
      return { ok: false, code: 'WRITE_FAILED', error: err instanceof Error ? err.message : String(err) };
    }
  }
}
