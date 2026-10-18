import { afterEach, expect, it, vi } from 'vitest';
import worker from '../src/index';

afterEach(() => vi.unstubAllGlobals());

it.each(['commonlands://lenses/CIL250', 'commonlands://catalog/lenses'])('withholds fixture commerce from %s resources', async uri => {
  const response = await worker.fetch(new Request('https://example.test/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri } }),
  }), {});
  const payload = await response.json() as { result: { contents: Array<{ text: string }> } };
  const text = payload.result.contents[0]!.text;
  expect(text).toContain('CIL250');
  expect(text).not.toMatch(/"(?:alpha|beta)"/i);
  expect(text).not.toMatch(/"(?:price|priceUsd|price_range|availability)"|https:\/\/commonlands.com\/products\/cil250/);
});

it.each([
  ['get_lens_details', { sku: 'CIL250' }],
  ['get_product_page_details', { sku: 'CIL250' }],
  ['search_catalog', { catalog: { query: 'CIL250' } }],
  ['lookup_catalog', { catalog: { ids: ['CIL250'] } }],
  ['get_product', { catalog: { id: 'CIL250' } }],
  ['prepare_shopify_purchase_handoff', { sku: 'CIL250' }],
  ['get_purchase_route_options', { sku: 'CIL250' }],
])('withholds stale commerce in %s, including nested text payloads', async (name, args) => {
  const response = await worker.fetch(new Request('https://example.test/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }), {});
  const payload = await response.json() as { result: { structuredContent: Record<string, unknown>; content: Array<{ text: string }> } };
  expect(payload.result.structuredContent.commerceLookup).toMatchObject({ tool: 'read_shopify_products' });
  const text = payload.result.content[0]!.text;
  expect(JSON.parse(text)).toEqual(payload.result.structuredContent);
  expect(text).not.toMatch(/"(?:alpha|beta)"/i);
  expect(text).not.toMatch(/"(?:price|priceUsd|price_range|availability)"|https:\/\/commonlands.com\/products\/cil250/);
});

it.each(['match_lens_to_sensor', 'recommend_lenses_for_application'])('ranks the exact 60 degree AR0234 match first in %s', async name => {
  // Recorded FoVs from the live reproduction; all five previously scored 100.
  const candidates = [['CIL052', 58], ['CIL056', 59], ['CIL355', 63], ['CIL358', 59], ['CIL359', 60]] as const;
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    sensor: { partNumber: 'AR0234' }, count: candidates.length, errors: [],
    lenses: candidates.map(([partNum, hfov]) => ({ partNum, hfov, vfov: 40, dfov: 72, efl: 5,
      image_circle: 12, lens_type: 'Standard', mount: 'M12', f_num: 2, resolution: '5MP' })),
  })));
  const response = await worker.fetch(new Request('https://example.test/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name, arguments: { sensorPartNumber: 'AR0234', desiredHorizontalFovDeg: 60, maxResults: 3 },
    } }),
  }), { FOV_LIVE_BACKEND_ENABLED: 'true', FOV_LAMBDA_ENDPOINT: 'https://ia97wrz7ag.execute-api.us-west-2.amazonaws.com/default/fov', FOV_API_KEY: 'test-only' });
  const payload = await response.json() as { result: { structuredContent: { recommendations: Array<{ lens: { sku: string }; fov: { horizontalDeg: number }; rank: number }> } } };
  expect(payload.result.structuredContent.recommendations[0]).toMatchObject({ lens: { sku: 'CIL359' }, fov: { horizontalDeg: 60 }, rank: 1 });
  expect(payload.result.structuredContent.recommendations.map(item => item.lens.sku)).toEqual(['CIL359', 'CIL056', 'CIL358']);
});
