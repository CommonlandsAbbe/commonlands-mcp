import { BodyTooLargeError, fetchWithTimeout } from './http-safety';

/** For idempotent reads only. Never use this helper for carts, RFQs or checkout mutations. */
export async function fetchReadWithRetry(input: RequestInfo | URL, init: RequestInit, timeoutMs: number, maxBytes: number): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetchWithTimeout(input, init, timeoutMs, maxBytes);
      if (attempt === 0 && [502, 503, 504].includes(response.status)) continue;
      return response;
    } catch (error) {
      if (attempt > 0 || error instanceof BodyTooLargeError || init.signal?.aborted) throw error;
    }
  }
}

export function readFailureCategory(error: unknown): string {
  if (error instanceof BodyTooLargeError) return 'response_too_large';
  return error instanceof Error && /timed out|abort/i.test(error.message) ? 'timeout' : 'network';
}
