import { promises as fsp, createWriteStream } from 'node:fs';
import { dirname } from 'node:path';
import type { ProgressInfo } from '../types/events.js';
import type { Logger } from '../utils/logger.js';
import { ensureDir, removeIfExists } from '../utils/fs.js';

export interface DownloadOptions {
  url: string;
  dest: string;
  logger?: Logger;
  signal?: AbortSignal;
  onProgress?: (info: ProgressInfo) => void;
  /** Maximum number of attempts for transient failures. Default 3. */
  maxRetries?: number;
  /** Base delay between retries in ms. Default 500. */
  retryDelayMs?: number;
  /** Request timeout in ms. Default 60_000. */
  timeoutMs?: number;
  /** Optional request headers. */
  headers?: Record<string, string>;
}

export interface DownloadResult {
  path: string;
  size: number;
  contentType: string | null;
}

/**
 * Download a URL to disk with progress events, retries, and abort support.
 */
export async function download(opts: DownloadOptions): Promise<DownloadResult> {
  const { url, dest } = opts;
  const maxRetries = opts.maxRetries ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 60_000;

  await ensureDir(dirname(dest));
  await removeIfExists(dest);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await downloadOnce(opts, timeoutMs);
    } catch (err) {
      lastErr = err;
      if (opts.signal?.aborted) throw err;
      const transient = isTransientError(err);
      if (!transient || attempt === maxRetries) {
        throw err;
      }
      const backoff = retryDelayMs * Math.pow(2, attempt - 1);
      opts.logger?.warn('download retry', {
        url,
        attempt,
        nextDelayMs: backoff,
        error: (err as Error).message,
      });
      await sleep(backoff, opts.signal);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function downloadOnce(opts: DownloadOptions, timeoutMs: number): Promise<DownloadResult> {
  const { url, dest } = opts;

  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (opts.signal) {
    if (opts.signal.aborted) {
      throw new Error('Download aborted');
    }
    opts.signal.addEventListener('abort', onAbort, { once: true });
  }
  const timeoutId = setTimeout(() => ac.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, { signal: ac.signal, headers: opts.headers });
  } finally {
    clearTimeout(timeoutId);
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  if (!res.body) {
    throw new Error(`Empty body for ${url}`);
  }

  const total = parseContentLength(res.headers.get('content-length'));
  const contentType = res.headers.get('content-type');
  let received = 0;

  const ws = createWriteStream(dest);
  const reader = res.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (!ws.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => ws.once('drain', () => resolve()));
      }
      if (opts.onProgress) {
        opts.onProgress({
          phase: 'download',
          current: received,
          total: total ?? received,
          unit: 'bytes',
          message: url,
        });
      }
    }
  } finally {
    reader.releaseLock();
  }

  await new Promise<void>((resolve, reject) => {
    ws.on('finish', () => resolve());
    ws.on('error', reject);
    ws.end();
  });

  const stat = await fsp.stat(dest);
  return { path: dest, size: stat.size, contentType };
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function isTransientError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes('aborted')) return false;
  if (msg.startsWith('http 4')) return false; // 4xx is not transient
  if (msg.startsWith('http 5')) return true;
  if (msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('eai_again')) return true;
  return false;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(t);
        reject(new Error('Sleep aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export async function fetchBuffer(opts: {
  url: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}): Promise<Buffer> {
  const res = await fetch(opts.url, { signal: opts.signal, headers: opts.headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${opts.url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
