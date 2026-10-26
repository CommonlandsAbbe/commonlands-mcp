import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import { mintCartToken } from '../src/cart-token';

const env: Env = {
  ENABLE_COMMERCE_MUTATION_TOOLS: 'true', ENABLE_CHECKOUT_MUTATION_TOOLS: 'true',
  SHOPIFY_CART_MCP_ENDPOINT: 'https://commonlands.com/api/ucp/mcp',
  SHOPIFY_CHECKOUT_MCP_ENDPOINT: 'https://commonlands.com/api/ucp/mcp',
  CART_TOKEN_SECRET: 'test-only-commerce-secret',
};
const cartId = 'gid://shopify/Cart/test?key=cart-key';
const checkoutId = 'gid://shopify/Checkout/test?key=checkout-key';
const items = [{ quantity: 1, item: { id: 'gid://shopify/ProductVariant/123' } }];
const rpc = async (name: string, args: Record<string, unknown>, config = env) => {
  const response = await worker.fetch(new Request('https://mcp.commonlands.com/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }), config);
  return { status: response.status, body: await response.json() as { result: { isError?: boolean; structuredContent: { checkout: { id: string; status: string }; checkout_access_token?: string } } } };
};
afterEach(() => vi.unstubAllGlobals());

describe('current Shopify UCP cart and checkout handoff', () => {
  it('publishes negotiable cart/checkout versions only when enabled', async () => {
    const response = await worker.fetch(new Request('https://mcp.commonlands.com/.well-known/ucp'), env);
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    const profile = await response.json() as { ucp: { version: string; capabilities: Record<string, unknown> } };
    expect(profile.ucp.version).toBe('2026-08-25');
    expect(profile.ucp).toMatchObject({ services: { 'dev.ucp.shopping': [{ version: '2026-08-25', transport: 'mcp' }] }, payment_handlers: {} });
    expect(profile.ucp.capabilities['dev.ucp.shopping.cart']).toEqual([{ version: '2026-08-25' }]);
    expect(profile.ucp.capabilities['dev.ucp.shopping.checkout']).toEqual([{ version: '2026-08-25' }]);
    const disabled = await worker.fetch(new Request('https://mcp.commonlands.com/.well-known/ucp'), {});
    expect(JSON.stringify(await disabled.json())).not.toContain('"dev.ucp.shopping.checkout"');
  });

  it('converts an owned cart, parses a flat checkout, and issues a separate owner token', async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.params.arguments).toEqual({
        meta: { 'ucp-agent': { profile: 'https://mcp.commonlands.com/.well-known/ucp' } },
        checkout: { cart_id: cartId, line_items: [] },
      });
      return Response.json({ result: { structuredContent: {
        id: checkoutId, status: 'requires_escalation', continue_url: 'https://commonlands.com/checkouts/test',
        buyer: { email: 'private@example.com' }, payment: { token: 'private-payment' },
        fulfillment: { address: 'private address' }, totals: [{ type: 'total', amount: 1000 }],
      } } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const cartToken = await mintCartToken(env.CART_TOKEN_SECRET!, cartId);
    const result = await rpc('create_checkout', { checkout: { cart_id: cartId }, cart_access_token: cartToken });
    expect(result.body.result.isError).not.toBe(true);
    const data = result.body.result.structuredContent;
    expect(data.checkout.id).toBe(checkoutId);
    expect(data.checkout.status).toBe('requires_escalation');
    expect(data.checkout_access_token).toBe(await mintCartToken(env.CART_TOKEN_SECRET!, `checkout:${checkoutId}`));
    expect(data.checkout_access_token).not.toBe(cartToken);
    expect(JSON.stringify(data)).not.toContain('private');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects unowned cart conversion and checkout reads without an upstream request', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    for (const token of [undefined, 'wrong', await mintCartToken(env.CART_TOKEN_SECRET!, 'gid://shopify/Cart/other')]) {
      expect((await rpc('create_checkout', { checkout: { cart_id: cartId }, cart_access_token: token })).body.result.isError).toBe(true);
    }
    for (const token of [undefined, 'wrong', await mintCartToken(env.CART_TOKEN_SECRET!, checkoutId)]) {
      expect((await rpc('get_checkout', { id: checkoutId, checkout_access_token: token })).body.result.isError).toBe(true);
    }
    expect((await rpc('create_checkout', { checkout: { line_items: items } }, { ...env, CART_TOKEN_SECRET: '' })).body.result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes a full cart replacement, preserves line ids, and accepts clearing the cart', async () => {
    const payloads: Array<{ cart: { line_items: unknown[] } }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      payloads.push(JSON.parse(String(init?.body)).params.arguments);
      return Response.json({ result: { structuredContent: { cart: { id: cartId, line_items: [] } } } });
    }));
    const token = await mintCartToken(env.CART_TOKEN_SECRET!, cartId);
    const line = { ...items[0], id: 'gid://shopify/CartLine/line1', quantity: 2 };
    for (const lines of [[line], []]) {
      const result = await rpc('update_cart', { id: cartId, cart_access_token: token, cart: { line_items: lines } });
      expect(result.body.result.isError).not.toBe(true);
      expect(payloads.at(-1)?.cart.line_items).toEqual(lines);
      expect(payloads.at(-1)).not.toHaveProperty('cart_access_token');
    }
    const legacy = await rpc('update_cart', { id: cartId, cart_access_token: token, cart: { update_items: [{ id: line.id, quantity: 3 }] } });
    expect(legacy.body.result.isError).toBe(true);
    expect(payloads).toHaveLength(2);
  });

  it('rejects fractional quantities instead of silently changing the requested amount', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    for (const name of ['create_cart', 'create_checkout']) {
      const args = { [name === 'create_cart' ? 'cart' : 'checkout']: { line_items: [{ ...items[0], quantity: 1.5 }] } };
      expect((await rpc(name, args)).body.result.isError).toBe(true);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rate limits checkout creation before Shopify is contacted', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const result = await rpc('create_checkout', { checkout: { line_items: items } }, {
      ...env, CART_RATE_LIMITER: { limit: async () => ({ success: false }) },
    });
    expect(result.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
