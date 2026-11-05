import { afterEach, expect, it, vi } from 'vitest';
import { readShopifyProducts } from '../src/shopify-read-adapter';
import { parsePublicValue, pairPublicFields } from '../src/public-specifications';

afterEach(() => vi.restoreAllMocks());
const env = { SHOPIFY_CLIENT_ID: 'inventory-phase-tests', SHOPIFY_CLIENT_SECRET: 'private', SHOPIFY_SHOP_DOMAIN: 'commonlands-store.myshopify.com', SHOPIFY_SCOPES: 'read_products,read_inventory' };
it('fetches inventory again on every call and never substitutes old stock on failure', async () => {
  let stock = 18;
  let fail = false;
  const queries: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).includes('oauth')) return Response.json({ access_token: 'test-token', expires_in: 86400 });
    queries.push(String(init?.body));
    if (fail) return new Response('', { status: 503 });
    return Response.json({ data: { shop: { currencyCode: 'USD' }, productVariants: {
      pageInfo: { hasNextPage: true, endCursor: 'nextcursor' },
      nodes: [{ id: 'gid://shopify/ProductVariant/1', sku: 'CIL039-F2.0', price: '59.00',
        inventoryItem: { tracked: true }, inventoryQuantity: stock + 5, sellableOnlineQuantity: stock,
        availableForSale: true, inventoryPolicy: 'DENY', selectedOptions: [{ name: 'Filter', value: 'IR cut' }],
        product: { id: 'gid://shopify/Product/1', handle: 'cil039', status: 'ACTIVE', onlineStoreUrl: 'https://commonlands.com/products/cil039',
          metafields: { pageInfo: { hasNextPage: false }, nodes: [{ namespace: 'custom', key: 'compatible_resolution', type: 'single_line_text_field', value: '5MP' }] } } }],
    } } });
  });
  const first = await readShopifyProducts(env, { sku: 'CIL039', includeMetafields: true });
  expect(first.products[0]?.variants[0]).toMatchObject({ availableQuantity: 18, websiteStockQuantity: 23, selectedOptions: [{ name: 'Filter', value: 'IR cut' }] });
  expect(first.products[0]?.metafields[0]).toMatchObject({ value: '5MP', valueStatus: 'complete' });
  expect(first.currencyCode).toBe('USD');
  expect(first.products[0]?.metafieldsComplete).toBe(true);
  stock = 2;
  const second = await readShopifyProducts(env, { sku: 'CIL039', after: first.pageInfo.endCursor });
  expect(second.products[0]?.variants[0]?.availableQuantity).toBe(2);
  expect(JSON.parse(queries[1]!).variables.after).toBe('nextcursor');
  fail = true;
  const failed = await readShopifyProducts(env, { sku: 'CIL039' });
  expect(failed.connector.status).toBe('shopify_error');
  expect(failed.products).toEqual([]);
  expect(queries).toHaveLength(3);
});

it('returns whole typed arrays and never partial JSON', () => {
  const answers = Array.from({ length: 12 }, (_, index) => `Full answer ${index} with all engineering context intact.`);
  expect(parsePublicValue('list.single_line_text_field', JSON.stringify(answers))).toEqual({ value: answers, valueStatus: 'complete', truncated: false });
  expect(parsePublicValue('json', '["partial')).toMatchObject({ value: null, valueStatus: 'invalid' });
  expect(parsePublicValue('json', JSON.stringify(['x'.repeat(17000)]))).toMatchObject({ value: null, valueStatus: 'too_large', truncated: true });
  expect(parsePublicValue('number_decimal', '3.14').value).toBe(3.14);
  expect(parsePublicValue('weight', '{"value":8,"unit":"g"}').value).toEqual({ value: 8, unit: 'g' });
});

it('requires equal complete arrays before pairing FAQs or compatibility', () => {
  const field = (key: string, values: string[]) => ({ key, ...parsePublicValue('list.single_line_text_field', JSON.stringify(values)) });
  expect(pairPublicFields([field('q', ['Q1', 'Q2']), field('a', ['A1'])], 'q', 'a')).toEqual({ status: 'invalid_or_incomplete', pairs: [] });
  expect(pairPublicFields([field('q', ['Q1']), field('a', ['A1'])], 'q', 'a')).toEqual({ status: 'complete', pairs: [{ q: 'Q1', a: 'A1' }] });
});

it('keeps restricted documents, secrets and optical coefficients out of typed values', () => {
  const parsed = parsePublicValue('json', JSON.stringify({ beta: 1, alpha: 2, access_token: 'private', document: 'https://docsend.com/view/private', public: 'https://cdn.shopify.com/drawing.pdf' }));
  expect(JSON.stringify(parsed)).not.toMatch(/docsend|private|beta|alpha|access_token/);
  expect(JSON.stringify(parsed)).toContain('https://cdn.shopify.com/drawing.pdf');
});
