import { afterEach, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import { getPurchaseOptions, multiplyMoney, checkoutEstimate } from '../src/purchase-options';
import { mintCartToken } from '../src/cart-token';

const env: Env = { ENVIRONMENT: 'production', SHOPIFY_CLIENT_ID: 'purchase-phase-tests', SHOPIFY_CLIENT_SECRET: 'private-secret', SHOPIFY_SHOP_DOMAIN: 'commonlands-store.myshopify.com', SHOPIFY_SCOPES: 'read_products,read_inventory', ENABLE_CHECKOUT_MUTATION_TOOLS: 'true', SHOPIFY_CHECKOUT_MCP_ENDPOINT: 'https://commonlands.com/api/ucp/mcp', CART_TOKEN_SECRET: 'owner-secret' };
const sku = 'CIL250-F2.0-M12ANIR';
const variantId = 'gid://shopify/ProductVariant/123';
function node(overrides: Record<string, unknown> = {}) {
  return { id: variantId, sku, title: 'IR cut', price: '99.00', inventoryItem: { tracked: true }, inventoryQuantity: 30, sellableOnlineQuantity: 20,
    availableForSale: true, inventoryPolicy: 'DENY', selectedOptions: [{ name: 'Filter', value: 'IR cut' }],
    product: { id: 'gid://shopify/Product/456', title: 'CIL250 lens', handle: 'cil250', status: 'ACTIVE', onlineStoreUrl: 'https://commonlands.com/products/cil250' }, ...overrides };
}
function mock(nodes = [node()], currency: string | null = 'USD', checkout: unknown = null) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (String(url).includes('oauth')) return Response.json({ access_token: 'secret', expires_in: 86400 });
    if (String(url).endsWith('/api/ucp/mcp')) return Response.json({ result: { structuredContent: { checkout } } });
    return Response.json({ data: { shop: { currencyCode: currency }, productVariants: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } });
  });
}
function checkout() {
  return { id: 'gid://shopify/Checkout/checkout-123', status: 'incomplete', expires_at: new Date(Date.now() + 600000).toISOString(), currency: 'USD',
    line_items: [{ item: { id: variantId }, quantity: 2 }], totals: [{ type: 'shipping', amount: 1000 }, { type: 'tax', amount: 1600 }, { type: 'total', amount: 22400 }],
    buyer: { email: 'private@example.com' }, payment: { token: 'private-payment' } };
}
async function rpc(args: Record<string, unknown>) {
  return worker.fetch(new Request('https://mcp.commonlands.com/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_purchase_options', arguments: args } }) }), env);
}
afterEach(() => vi.restoreAllMocks());

it('returns exact-variant current stock and extended base price, without inventing a volume quote', async () => {
  mock();
  expect(await getPurchaseOptions(env, { sku, quantity: 100 })).toMatchObject({ status: 'ok', bindingQuote: false, reservesInventory: false,
    selection: { sku, variantId, options: [{ name: 'Filter', value: 'IR cut' }] },
    pricing: { unitPrice: { amount: '99.00', currency: 'USD' }, extendedBasePrice: { amount: '9900.00', currency: 'USD' }, quantityPricing: { status: 'requires_quote', applicableTier: null } },
    availability: { availableQuantity: 20, websiteStockQuantity: 30, canSupplyFromOnlineStock: false, backorderRequired: true, backorderAllowed: false, leadTime: null }, nextSteps: { createCart: null },
  });
});
it('does not confuse backorders or untracked inventory with available stock', async () => {
  mock([node({ inventoryPolicy: 'CONTINUE' })]);
  expect(await getPurchaseOptions(env, { sku, quantity: 100 })).toMatchObject({ availability: { canSupplyFromOnlineStock: false, backorderAllowed: true }, nextSteps: { createCart: { arguments: { cart: { line_items: [{ quantity: 100, item: { id: variantId } }] } } } } });
  vi.restoreAllMocks(); mock([node({ inventoryItem: { tracked: false } })]);
  expect(await getPurchaseOptions(env, { sku, quantity: 1 })).toMatchObject({ availability: { availableQuantity: null, canSupplyFromOnlineStock: null } });
});
it('rejects fractional quantities, ambiguous family selection and mismatched variant IDs', async () => {
  const fetch = mock();
  expect(await getPurchaseOptions(env, { sku, quantity: 1.5 })).toMatchObject({ status: 'invalid_request' });
  expect(fetch).not.toHaveBeenCalled();
  expect(await getPurchaseOptions(env, { sku: 'CIL250', quantity: 2 })).toMatchObject({ status: 'requires_variant_selection' });
  expect(await getPurchaseOptions(env, { sku, quantity: 2, variant_id: 'gid://shopify/ProductVariant/999' })).toMatchObject({ status: 'variant_mismatch' });
});
it('does not invent a currency and computes money without float rounding', async () => {
  mock([node()], null);
  expect(await getPurchaseOptions(env, { sku, quantity: 1 })).toMatchObject({ pricing: { unitPrice: null, extendedBasePrice: null } });
  expect(multiplyMoney({ amount: '0.10', currency: 'USD' }, 3)).toEqual({ amount: '0.30', currency: 'USD' });
  expect(multiplyMoney({ amount: '99', currency: 'JPY' }, 3)).toEqual({ amount: '297', currency: 'JPY' });
  expect(multiplyMoney({ amount: '1.005', currency: 'KWD' }, 2)).toEqual({ amount: '2.010', currency: 'KWD' });
});
it('never recycles product truth after an upstream failure', async () => {
  const fetch = mock();
  expect(await getPurchaseOptions(env, { sku, quantity: 1 })).toMatchObject({ status: 'ok' });
  fetch.mockRejectedValue(new Error('private upstream URL'));
  const failed = await getPurchaseOptions(env, { sku, quantity: 1 });
  expect(failed).toMatchObject({ status: 'unavailable' });
  expect(JSON.stringify(failed)).not.toMatch(/private upstream|99.00|"unitPrice"/);
});
it('reads checkout totals only with the matching owner credential and selection', async () => {
  const read = checkout();
  const fetch = mock([node()], 'USD', read);
  const missingOwner = await (await rpc({ sku, quantity: 2, checkout_id: read.id })).json();
  expect(missingOwner).toMatchObject({ result: { structuredContent: { fulfillment: { status: 'checkout_unavailable' } } } });
  expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/api/ucp/mcp'))).toBe(false);
  const token = await mintCartToken(env.CART_TOKEN_SECRET!, `checkout:${read.id}`);
  const owned = await (await rpc({ sku, quantity: 2, checkout_id: read.id, checkout_access_token: token })).json();
  expect(owned).toMatchObject({ result: { structuredContent: { fulfillment: { status: 'shopify_checkout_estimate', shipping: { amountMinor: 1000, currency: 'USD', estimated: true }, total: { amountMinor: 22400 } } } } });
  expect(JSON.stringify(owned)).not.toMatch(/private@example|private-payment|owner-secret/);
  expect(JSON.stringify(owned)).not.toContain(token);
});
it('rejects expired and mismatched checkout totals', () => {
  expect(checkoutEstimate({ ...checkout(), expires_at: '2020-01-01T00:00:00Z' }, variantId, 2)).toMatchObject({ status: 'checkout_expired', total: null });
  expect(checkoutEstimate(checkout(), variantId, 3)).toMatchObject({ status: 'checkout_selection_mismatch', total: null });
  expect(checkoutEstimate({ ...checkout(), expires_at: null }, variantId, 2)).toMatchObject({ status: 'checkout_expiry_unknown' });
});
it('serves no-store public GET records from the same Shopify adapter and honors rate limits', async () => {
  const fetch = mock([node(), node({ product: { status: 'DRAFT', onlineStoreUrl: null } })]);
  const response = await worker.fetch(new Request('https://mcp.commonlands.com/catalog?limit=2'), env);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ products: [{ variants: [{ sku, variantId }] }], pageInfo: { hasNextPage: false }, currencyCode: 'USD' });
  const markdown = await worker.fetch(new Request(`https://mcp.commonlands.com/products/${sku}?format=markdown`), env);
  expect(markdown.headers.get('content-type')).toContain('text/markdown');
  expect(await markdown.text()).toContain('Online sellable quantity: 20');
  fetch.mockClear();
  const limited = await worker.fetch(new Request('https://mcp.commonlands.com/catalog'), { ...env, MCP_RATE_LIMITER: { limit: async () => ({ success: false }) } });
  expect(limited.status).toBe(429);
  expect(fetch).not.toHaveBeenCalled();
});

it('uses live truth for production resource reads and nested legacy aliases', async () => {
  mock();
  const request = async (method: string, params: unknown) => {
    const response = await worker.fetch(new Request('https://mcp.commonlands.com/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), env);
    return response.json();
  };
  const resource = await request('resources/read', { uri: 'commonlands://lenses/CIL250' });
  expect(JSON.stringify(resource)).toContain(sku);
  expect(JSON.stringify(resource)).not.toContain('fixture');
  expect(await request('tools/call', { name: 'lookup_catalog', arguments: { catalog: { ids: ['CIL250'] } } })).toMatchObject({ result: { structuredContent: { resolutions: [{ selectionStatus: 'requires_variant_selection' }] } } });
  expect(await request('tools/call', { name: 'search_catalog', arguments: { catalog: { query: 'CIL250', limit: 1 } } })).toMatchObject({ result: { structuredContent: { connector: { status: 'ok' } } } });
});
