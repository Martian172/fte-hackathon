/** Small HTTP utilities: timeouts, retries and typed errors for all external calls. */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number = 500,
    public readonly detail?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const DEFAULT_TIMEOUT_MS = 12_000;

/** fetch() that aborts after `timeoutMs` — every external call in this app goes through this. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiError(`Request timed out after ${timeoutMs / 1000}s`, 504, url);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  /** Return true if the error is worth retrying (e.g. 5xx / network, not 401). */
  shouldRetry?: (err: unknown) => boolean;
}

/** Run `fn` with exponential backoff. Defaults: 2 retries, 500ms base delay. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 2, baseDelayMs = 500, shouldRetry = () => true } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries || !shouldRetry(err)) break;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastError;
}

/** True for transient failures (timeouts, 429, 5xx) that deserve a retry. */
export function isTransient(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 429 || err.status >= 500;
  return true; // network-level errors (DNS, reset) are transient
}
