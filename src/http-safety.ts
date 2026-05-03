export interface FetchJsonOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

const DEFAULT_FETCH_TIMEOUT_MS = 4_000;
const DEFAULT_JSON_MAX_BYTES = 256 * 1024;

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function readJsonWithLimit<T>(
  response: Response,
  context: string,
  options: FetchJsonOptions = {},
): Promise<{ data: T } | { error: string }> {
  const maxBytes = options.maxBytes ?? DEFAULT_JSON_MAX_BYTES;
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number.isFinite(Number(contentLength)) && Number(contentLength) > maxBytes) {
    return { error: `${context} response exceeded ${maxBytes} byte limit` };
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return { error: `${context} response could not be read: ${errorMessage(error)}` };
  }

  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return { error: `${context} response exceeded ${maxBytes} byte limit` };
  }

  try {
    return { data: JSON.parse(text) as T };
  } catch (error) {
    return { error: `${context} returned invalid JSON: ${errorMessage(error)}` };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
