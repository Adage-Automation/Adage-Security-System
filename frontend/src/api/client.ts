// Thin fetch wrapper. Always sends cookies (session auth) and never lets
// the caller supply a client-side timestamp for movements — the server is
// authoritative (spec §20, §46).
const BASE_URL = '/api';

// A genuinely hung request (dead connection, misbehaving proxy) previously
// left a "Sending…"/"Saving…" button stuck forever with no way out but
// reloading — found in the 2026-09-09 audit. 20s comfortably covers the
// slowest real request (report generation via Puppeteer) with margin.
const REQUEST_TIMEOUT_MS = 20_000;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class ApiTimeoutError extends Error {
  constructor() {
    super('Request timed out. Please check your connection and try again.');
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiTimeoutError();
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      // Nest's ValidationPipe returns `message` as string[] on a 400 —
      // passing that straight into ApiError/React renders it mashed
      // together with no separators (e.g. "email must be an emailusername
      // should not be empty"). Found in the 2026-09-04 audit.
      if (Array.isArray(body.message)) {
        message = body.message.join(', ');
      } else if (typeof body.message === 'string') {
        message = body.message;
      }
    } catch {
      // ignore — no JSON body
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
};
