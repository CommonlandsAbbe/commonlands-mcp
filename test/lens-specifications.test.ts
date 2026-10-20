import { afterEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { lensSpecifications } from '../src/lens-specifications';

afterEach(() => vi.unstubAllGlobals());

const specs = { weight: 12.5, pixelpitchres: '1.85', flange_dist: 0, mbfl: '3.25', max_diameter: 18 };

it.each([
  ['search_lens_catalog', { query: 'CIL250' }, 'results'],
  ['calculate_field_of_view', { lensSku: 'CIL250', sensorPartNumber: 'IMX477' }, 'lenses'],
  ['compute_fov', { lensSku: 'CIL250', sensorPartNumber: 'IMX477' }, 'lenses'],
  ['compute_fov_catalog', { sensorPartNumber: 'IMX477' }, 'lenses'],
  ['match_lens_to_sensor', { sensorPartNumber: 'IMX477' }, 'recommendations'],
  ['recommend_lenses_for_application', { sensorPartNumber: 'IMX477' }, 'recommendations'],
  ['compare_lenses', { lensSkus: ['CIL250', 'CIL078'], sensorPartNumber: 'IMX477' }, 'recommendations'],
  ['get_lens_distortion_profile', { lens_sku: 'CIL250' }, 'profile'],
] as const)('preserves DynamoDB specifications through %s', async (name, args, collection) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    sensor: { partNumber: 'IMX477', alpha: 918273.125, beta: 918273.625 }, count: 2,
    errors: [{ partNum: 'CIL250', message: 'alpha=918273.125 beta=918273.625' }],
    lenses: ['CIL250', 'CIL078'].map(partNum => ({ partNum, hfov: 60, vfov: 40, dfov: 72,
      image_circle: 12, efl: 5, f_num: 2, mount: 'M12', ...specs, privateField: 'must not leak',
      alpha: 918273.125, beta: 918273.625, Alpha: 918273.125, Beta: 918273.625,
      coefficients: { alpha: 918273.125, beta: 918273.625 } })),
  })));
  const response = await worker.fetch(new Request('https://example.test/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }), { FOV_LIVE_BACKEND_ENABLED: 'true', FOV_LAMBDA_ENDPOINT: 'https://ia97wrz7ag.execute-api.us-west-2.amazonaws.com/default/fov', FOV_API_KEY: `spec-test-${name}` });
  const payload = await response.json() as { result: { structuredContent: Record<string, unknown>; content: Array<{ text: string }> } };
  const sc = payload.result.structuredContent;
  const container = name === 'calculate_field_of_view' ? sc.details as Record<string, unknown> : sc;
  const entries = container[collection] as Array<Record<string, unknown>>;
  const record = collection === 'profile' ? entries : collection === 'recommendations' ? entries[0]!.lens : entries[0];
  expect(record).toMatchObject(specs);
  expect(JSON.parse(payload.result.content[0]!.text)).toEqual(sc);
  expect(JSON.stringify(sc)).not.toContain('must not leak');
  // Check the entire wire response, including text content and backend errors.
  expect(JSON.stringify(payload)).not.toMatch(/"(?:alpha|beta)"|918273\.(?:125|625)/i);
});

it('omits absent or invalid specifications and preserves numeric zero', () => {
  expect(lensSpecifications({})).toEqual({});
  expect(lensSpecifications({ weight: NaN, mbfl: Infinity, pixelpitchres: '', flange_dist: 0, max_diameter: ' '.repeat(201) }))
    .toEqual({ flange_dist: 0 });
});
