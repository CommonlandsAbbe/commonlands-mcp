import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { __resetLensCatalogCacheForTests, type Env } from '../src/index';
import { resolveLiveProduct, normalizeMountText } from '../src/product-resolver';
import { fetchReadWithRetry } from '../src/upstream-read';

export const liveEnv: Env = {
  ENVIRONMENT: 'production', FOV_LIVE_BACKEND_ENABLED: 'true',
  FOV_LAMBDA_ENDPOINT: 'https://ia97wrz7ag.execute-api.us-west-2.amazonaws.com/default/fov',
  FOV_API_KEY: 'private-test-key', FOV_BACKEND_SCANS_FULL_CATALOG: 'true',
};
export const shopEnv: Env = {
  ENVIRONMENT: 'production', SHOPIFY_CLIENT_ID: 'live-truth-tests', SHOPIFY_CLIENT_SECRET: 'private-test-secret',
  SHOPIFY_SHOP_DOMAIN: 'commonlands-store.myshopify.com', SHOPIFY_SCOPES: 'read_products,read_inventory',
};
export async function callTool(name: string, args: Record<string, unknown>, env = liveEnv) {
  const response = await worker.fetch(new Request('https://mcp.commonlands.com/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'test', method: 'tools/call', params: { name, arguments: args } }),
  }), env);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper inspects heterogeneous RPC payloads
  return response.json() as Promise<Record<string, any>>; // test-only JSON RPC inspection
}
export function shopVariant(sku = 'CIL250-F2.0', id = '123') {
  return { id: `gid://shopify/ProductVariant/${id}`, sku, title: 'F2.0', price: '99.00',
    product: { id: 'gid://shopify/Product/456', title: 'CIL250', handle: 'cil250', status: 'ACTIVE', onlineStoreUrl: 'https://commonlands.com/products/cil250', metafields: { nodes: [] } } };
}
export function mockShop(nodes: unknown[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => String(url).includes('oauth')
    ? Response.json({ access_token: 'test-token', expires_in: 86400 })
    : Response.json({ data: { productVariants: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } }));
}
afterEach(() => { vi.restoreAllMocks(); __resetLensCatalogCacheForTests(); });

describe('live product truth', () => {
  it('resolves a recommended lens absent from fixtures and requires a full variant SKU', async () => {
    mockShop([shopVariant('CIL359-F2.0'), shopVariant('CIL359-F2.4', '124'), shopVariant('CIL3590-F2.0', '125')]);
    const family = await resolveLiveProduct(shopEnv, 'CIL359');
    expect(family.selectionStatus).toBe('requires_variant_selection');
    expect(family.selectedVariant).toBeNull();
    expect(family.products[0]!.variants).toHaveLength(2);
    const exact = await resolveLiveProduct(shopEnv, 'CIL359-F2.0');
    expect(exact.selectedVariant?.sku).toBe('CIL359-F2.0');
    expect(exact.products[0]!.variants).toHaveLength(1);
  });
  it('routes old product calls to live price and full SKU', async () => {
    mockShop([shopVariant()]);
    const result = await callTool('get_product', { catalog: { id: 'CIL250' } }, shopEnv);
    expect(result.result.structuredContent.products[0].variants[0].price).toBe('99.00');
    expect(JSON.stringify(result)).not.toMatch(/fixture|F2.4|private-test-secret/);
  });
  it.each(['search_lens_catalog', 'get_lens_distortion_profile'])( '%s never falls through to fixtures after live failure', async name => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('secret internal endpoint'));
    const result = await callTool(name, { query: 'CIL250', lens_sku: 'CIL250' });
    expect(result.error.code).toBe(-32603);
    expect(result.error.data.category).toBe('network');
    expect(JSON.stringify(result)).not.toMatch(/secret internal|private-test-key|fixture/);
  });
  it('does not silently enter fixture mode when production configuration is missing', async () => {
    const result = await callTool('search_lens_catalog', { query: 'CIL250' }, { ENVIRONMENT: 'production' });
    expect(result.error.code).toBe(-32603);
  });
  it('fails closed for named-lens calculate_field_of_view in unconfigured production', async () => {
    const result = await callTool('calculate_field_of_view', { lens_sku: 'CIL250', sensor: 'IMX477' }, { ENVIRONMENT: 'production' });
    expect(result.error.code).toBe(-32603);
    expect(result).not.toHaveProperty('result');
  });
  it('normalizes aliases without conflating CS-mount', () => {
    expect(normalizeMountText('C-mount')).toBe(normalizeMountText('C FA'));
    expect(normalizeMountText('C mount')).toBe('cmount');
    expect(normalizeMountText('S-mount')).toBe('m12');
    expect(normalizeMountText('CS-mount')).not.toBe('cmount');
  });
  it('recovers from one transient read failure and never retries auth failures', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(Response.json({ ok: true }));
    expect((await fetchReadWithRetry('https://example.com', {}, 100, 1024)).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockReset().mockResolvedValue(new Response('', { status: 401 }));
    expect((await fetchReadWithRetry('https://example.com', {}, 100, 1024)).status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
