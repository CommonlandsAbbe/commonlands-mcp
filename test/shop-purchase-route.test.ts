import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import { mintCartToken } from '../src/cart-token';
import { callShopifyCheckoutMcp } from '../src/shopify-checkout-mcp';
import { withShopPurchaseRoute } from '../src/shop-purchase-route';

const env: Env = {
  ENABLE_COMMERCE_MUTATION_TOOLS: 'true',
  SHOPIFY_CART_MCP_ENDPOINT: 'https://commonlands.com/api/ucp/mcp',
  CART_TOKEN_SECRET: 'test-only-shop-route-secret',
};
const cartId = 'gid://shopify/Cart/test?key=private-key';
const cart = { id: cartId, line_items: [{ quantity: 1, item: { id: 'gid://shopify/ProductVariant/123' } }] };
async function call(name: string, args: Record<string, unknown>, config = env) {
  const response = await worker.fetch(new Request('https://mcp.commonlands.com/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }), config);
  return await response.json() as { result: { isError?: boolean; structuredContent: Record<string, unknown> } };
}
afterEach(() => vi.unstubAllGlobals());

describe('buyer-authorized purchases through the separate Shop MCP connection', () => {
  it('returns exact cross-server cart conversion arguments without credentials or payment data', async () => {
    const fetchMock = vi.fn(async (_url: unknown) => Response.json({ result: { structuredContent: cart } }));
    vi.stubGlobal('fetch', fetchMock);
    const token = await mintCartToken(env.CART_TOKEN_SECRET!, cartId);
    for (const [name, args] of [
      ['create_cart', { cart: { line_items: cart.line_items } }],
      ['get_cart', { id: cartId, cart_access_token: token }],
      ['update_cart', { id: cartId, cart_access_token: token, cart: { line_items: cart.line_items } }],
    ] as const) {
      const result = await call(name, args);
      expect(result.result.isError).not.toBe(true);
      const route = result.result.structuredContent.agent_checkout;
      expect(route).toMatchObject({
        endpoint: 'https://mcp.shop.com/', protocol_version: '2026-07-28',
        authentication: { resource: 'https://mcp.shop.com', scope: 'personal_agent' },
        next_call: { tool: 'create_checkout', arguments: {
          shop: 'commonlands-camera-components.myshopify.com', checkout: { cart_id: cartId, line_items: [] },
        } },
        order_created: false, payment_attempted: false,
      });
      expect(JSON.stringify(route)).not.toContain(token);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) expect(String(call[0])).not.toContain('mcp.shop.com');
  });

  it('does not offer a purchase route for unowned or unavailable carts', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    for (const config of [env, { ...env, CART_TOKEN_SECRET: '' }]) {
      const result = await call('get_cart', { id: cartId, cart_access_token: 'forged' }, config);
      expect(result.result.isError).toBe(true);
      expect(result.result.structuredContent).not.toHaveProperty('agent_checkout');
    }
    expect(fetchMock).not.toHaveBeenCalled();
    for (const input of [
      { operation: 'get_cart', connector: { status: 'shopify_error' }, cart },
      { operation: 'cancel_cart', connector: { status: 'ok' }, cart },
      { connector: { status: 'ok' }, cart: { ...cart, line_items: [] } },
      { connector: { status: 'ok' }, cart: { ...cart, status: 'converted' } },
      { connector: { status: 'ok' }, cart: { ...cart, id: 'https://untrusted.example/cart' } },
    ]) expect(withShopPurchaseRoute(input)).not.toHaveProperty('agent_checkout');
  });

  it('cannot turn verification booleans into payment authorization even at the adapter boundary', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const result = await callShopifyCheckoutMcp({ ...env, SHOPIFY_CHECKOUT_MCP_ENDPOINT: 'https://commonlands.com/api/ucp/mcp' }, 'complete_checkout', {
      authentication: { buyerVerified: true, paymentAuthorized: true, cardAuthorized: true },
      checkout: { payment: { instruments: [{ credential: 'forged-payment' }] } },
    });
    expect(result.connector.status).toBe('invalid_request');
    expect(result.safety).toMatchObject({ completesCheckout: false, createsOrder: false, capturesPayment: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
