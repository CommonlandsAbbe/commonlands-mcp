export interface FetchJsonOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

const DEFAULT_FETCH_TIMEOUT_MS = 4_000;
const DEFAULT_JSON_MAX_BYTES = 256 * 1024;

export class BodyTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Body exceeded ${maxBytes} byte limit`);
    this.name = 'BodyTooLargeError';
  }
}

// Count bytes before decoding or retaining chunks, and cancel as soon as the
// limit is crossed. Content-Length is only an early rejection hint.
export async function readTextWithLimit(message: Request | Response, maxBytes: number, signal?: AbortSignal): Promise<string> {
  const contentLength = message.headers.get('content-length');
  if (contentLength && Number(contentLength) > maxBytes) {
    void message.body?.cancel().catch(() => {});
    throw new BodyTooLargeError(maxBytes);
  }
  if (signal?.aborted) throw signal.reason;
  if (!message.body) return '';

  const reader = message.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw signal.reason;
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        cancel();
        throw new BodyTooLargeError(maxBytes);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

// These adapters consume bounded JSON responses, so finish reading the body
// under the same deadline as the headers before handing it to the caller.
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  maxBytes = DEFAULT_JSON_MAX_BYTES,
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init.signal ?? (input instanceof Request ? input.signal : undefined);
  const relayAbort = () => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener('abort', relayAbort, { once: true });
  if (callerSignal?.aborted) relayAbort();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(`Request timed out after ${timeoutMs} ms`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(input, { ...init, signal: controller.signal });
        const hasBody = response.body !== null;
        const text = await readTextWithLimit(response, maxBytes, controller.signal);
        return new Response(hasBody ? text : null, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', relayAbort);
  }
}

export async function readJsonWithLimit<T>(
  response: Response,
  context: string,
  options: FetchJsonOptions = {},
): Promise<{ data: T } | { error: string }> {
  const maxBytes = options.maxBytes ?? DEFAULT_JSON_MAX_BYTES;
  let text: string;
  try {
    text = await readTextWithLimit(response, maxBytes);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return { error: `${context} response exceeded ${maxBytes} byte limit` };
    return { error: `${context} response could not be read: ${errorMessage(error)}` };
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
