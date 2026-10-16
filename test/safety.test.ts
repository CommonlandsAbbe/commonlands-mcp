import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import { BodyTooLargeError, fetchWithTimeout, readJsonWithLimit, readTextWithLimit } from '../src/http-safety';
import { __resetSensorStoreCacheForTests, getLiveSensorByPartNumber } from '../src/sensor-store';

const encoder = new TextEncoder();
const analytics: Array<{ blobs?: string[] }> = [];
const baseEnv: Env = { MCP_ANALYTICS: { writeDataPoint: point => { analytics.push(point); } } };
const shopifyEnv: Env = {
  SHOPIFY_CLIENT_ID: 'safety-test', SHOPIFY_CLIENT_SECRET: 'test-only-secret',
  SHOPIFY_SHOP_DOMAIN: 'commonlands-store.myshopify.com', SHOPIFY_SCOPES: 'read_products',
};

async function callTool(name: string, args: Record<string, unknown>, env: Env = {}) {
  const response = await worker.fetch(new Request('https://mcp.example.test/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }), { ...baseEnv, ...env });
  return await response.json() as {
    result: { isError?: boolean; structuredContent: Record<string, unknown> };
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  analytics.length = 0;
  __resetSensorStoreCacheForTests();
});

describe('bounded HTTP reads', () => {
  it('cancels an oversized response before consuming the remaining chunks', async () => {
    let pulls = 0;
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) { pulls += 1; controller.enqueue(new Uint8Array(8)); }, cancel,
    }, { highWaterMark: 0 }));
    const result = await readJsonWithLimit(response, 'test', { maxBytes: 10 });
    expect(result).toEqual({ error: 'test response exceeded 10 byte limit' });
    expect(pulls).toBe(2);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels from Content-Length before reading and preserves UTF-8 at the exact limit', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 }), {
      headers: { 'content-length': '100' },
    });
    await expect(readTextWithLimit(response, 10)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(cancel).toHaveBeenCalledOnce();
    const bytes = encoder.encode('é');
    const split = new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(bytes.slice(0, 1)); controller.enqueue(bytes.slice(1)); controller.close();
    } }));
    expect(await readTextWithLimit(split, 2)).toBe('é');
  });

  it('keeps the deadline active after headers and cancels a stalled body', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init: RequestInit) => {
      signal = init.signal;
      return new Response(new ReadableStream<Uint8Array>({ cancel }));
    }));
    const pending = fetchWithTimeout('https://example.test', {}, 20);
    const assertion = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(21);
    await assertion;
    expect(signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds upstream responses before returning them, including error responses', async () => {
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(12)); }, cancel,
    }, { highWaterMark: 0 }), { status: 503 })));
    await expect(fetchWithTimeout('https://example.test', {}, 100, 10)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('preserves bodyless responses and clears completed deadlines', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    expect((await fetchWithTimeout('https://example.test')).status).toBe(204);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out sensor scans and permits the next request to retry', async () => {
    vi.useFakeTimers();
    const sensorEnv = { SENSOR_DDB_TABLE: 'test', SENSOR_DDB_REGION: 'us-west-2', AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test' };
    const cancel = vi.fn();
    let headersArrived!: () => void;
    const started = new Promise<void>(resolve => { headersArrived = resolve; });
    vi.stubGlobal('fetch', vi.fn(async () => {
      headersArrived();
      return new Response(new ReadableStream<Uint8Array>({ cancel }));
    }));
    const pending = getLiveSensorByPartNumber(sensorEnv, 'TEST123');
    const assertion = expect(pending).rejects.toThrow('timed out');
    await started;
    await vi.advanceTimersByTimeAsync(4001);
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ Items: [{
      id: { S: 'TEST123' }, sensorhpix: { N: '1000' }, sensorvpix: { N: '500' }, sensorpitch: { N: '2' },
    }] })));
    expect(await getLiveSensorByPartNumber(sensorEnv, 'TEST123')).toMatchObject({ partNumber: 'TEST123' });
  });
});

describe('public product publication', () => {
  it.each(['handle', 'search'] as const)('filters unpublished ACTIVE products in %s lookups', async route => {
    const privateProduct = {
      id: 'gid://shopify/Product/11', handle: 'private-prototype', title: 'Private prototype', status: 'ACTIVE', onlineStoreUrl: null,
      variants: { nodes: [{ id: 'gid://shopify/ProductVariant/21', sku: 'PRIVATE', price: '100' }] },
    };
    const publicProduct = {
      ...privateProduct, id: 'gid://shopify/Product/12', handle: 'public-lens', title: 'Public lens',
      onlineStoreUrl: 'https://commonlands.com/products/public-lens',
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/oauth/')) return Response.json({ access_token: 'test-token' });
      return Response.json({ data: route === 'handle' ? { productByHandle: privateProduct } : {
        productVariants: { nodes: [privateProduct, publicProduct].map(product => ({ id: 'gid://shopify/ProductVariant/21', product })) },
      } });
    }));
    const result = await callTool('read_shopify_products', route === 'handle' ? { handle: privateProduct.handle } : { query: 'lens' }, shopifyEnv);
    const products = result.result.structuredContent.products as Array<Record<string, unknown>>;
    expect(products).toHaveLength(route === 'handle' ? 0 : 1);
    expect(JSON.stringify(products)).not.toContain('private-prototype');
    if (route === 'search') expect(products[0]?.productUrl).toBe(publicProduct.onlineStoreUrl);
  });
});

describe('application outcome telemetry', () => {
  it.each([
    ['read_shopify_products', { sku: 'CIL250' }, {}, 'not_configured'],
    ['submit_rfq', {}, {}, 'invalid_request'],
    ['submit_rfq', { email: 'buyer@example.test', message: 'Test request', confirm: true }, {
      SENDGRID_API_KEY: 'test-secret', RFQ_TO_EMAIL: 'sales@example.test', RFQ_FROM_EMAIL: 'mcp@example.test',
    }, 'delivery_failed'],
    ['read_shopify_products', { sku: 'CIL250' }, { ...shopifyEnv, SHOPIFY_CLIENT_ID: 'failing-token' }, 'shopify_error'],
  ] as const)('marks %s %s as a tool failure', async (name, args, env, status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    const result = await callTool(name, args, env);
    expect(result.result.isError).toBe(true);
    expect(analytics[0]?.blobs?.[4]).toBe(`tool_error_${status}`);
    expect(JSON.stringify(analytics)).not.toMatch(/buyer@|test-secret|Test request|CIL250/);
  });

  it('keeps successful reads and RFQ previews successful', async () => {
    const read = await callTool('get_sensor_specs', { partNumber: 'IMX477' });
    const preview = await callTool('submit_rfq', { email: 'buyer@example.test', message: 'Preview only' });
    expect(read.result.isError).not.toBe(true);
    expect(preview.result.structuredContent.status).toBe('pending_confirmation');
    expect(preview.result.isError).not.toBe(true);
    expect(analytics.map(point => point.blobs?.[4])).toEqual(['ok', 'ok']);
  });

  it.each(['create_cart', 'create_checkout'])('does not hide upstream isError for %s', async name => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ result: { isError: true, content: [{ type: 'text', text: 'private upstream error' }] } })));
    const items = { line_items: [{ quantity: 1, item: { id: 'gid://shopify/ProductVariant/1' } }] };
    const result = await callTool(name, name === 'create_cart' ? { cart: items } : { checkout: items }, {
      ENABLE_COMMERCE_MUTATION_TOOLS: 'true', ENABLE_CHECKOUT_MUTATION_TOOLS: 'true',
      SHOPIFY_CART_MCP_ENDPOINT: 'https://commonlands.com/api/mcp', SHOPIFY_CHECKOUT_MCP_ENDPOINT: 'https://commonlands.com/api/ucp/mcp',
    });
    expect(result.result.isError).toBe(true);
    expect(analytics[0]?.blobs?.[4]).toBe('tool_error_shopify_error');
    expect(JSON.stringify(result)).not.toContain('private upstream error');
  });
});

describe('request abuse controls', () => {
  it.each([
    ['application/json', '{'], ['text/plain', 'invalid'], ['application/json', 'x'.repeat(70000)],
  ])('charges the global limiter before validation (%s)', async (contentType, body) => {
    const limit = vi.fn(async () => ({ success: false }));
    const response = await worker.fetch(new Request('https://mcp.example.test/mcp', {
      method: 'POST', headers: { 'content-type': contentType }, body,
    }), { ...baseEnv, MCP_RATE_LIMITER: { limit } });
    expect(response.status).toBe(429);
    expect(limit).toHaveBeenCalledOnce();
    expect(analytics[0]?.blobs?.[4]).toBe('http_4xx');
  });

  it('charges the global budget only once for a valid request', async () => {
    const limit = vi.fn(async () => ({ success: true }));
    await callTool('get_sensor_specs', { partNumber: 'IMX477' }, { MCP_RATE_LIMITER: { limit } });
    expect(limit).toHaveBeenCalledOnce();
  });

  it('cancels an oversized inbound stream without consuming its remainder', async () => {
    const cancel = vi.fn();
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { pulls += 1; controller.enqueue(new Uint8Array(32768)); }, cancel,
    }, { highWaterMark: 0 });
    const init: RequestInit & { duplex: string } = { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' };
    const response = await worker.fetch(new Request('https://mcp.example.test/mcp', init), baseEnv);
    expect(response.status).toBe(413);
    expect(pulls).toBe(3);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
