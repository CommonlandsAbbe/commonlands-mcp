import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { __resetLensCatalogCacheForTests } from '../src/index';
import { lensSpecifications } from '../src/lens-specifications';

afterEach(() => {
  vi.unstubAllGlobals();
  __resetLensCatalogCacheForTests();
});

const specs = { weight: 12.5, pixelpitchres: '1.85', flange_dist: 0, mbfl: '3.25', max_diameter: 18 };

describe.each([
  { sku: 'CIL250', mount: 'M12', ttl: '30', flange_dist: 20, reference: 'front_to_image_plane', total: 30 },
  { sku: 'CIL514', mount: 'C FA', ttl: 44, flange_dist: '17.52', reference: 'front_to_mounting_flange', total: 61.52 },
])('$mount lens', ({ sku, mount, ttl, flange_dist, reference, total }) => {
  it.each([
    ['search_lens_catalog', { query: sku }, 'results'],
    ['calculate_field_of_view', { lensSku: sku, sensorPartNumber: 'IMX477' }, 'lenses'],
    ['compute_fov', { lensSku: sku, sensorPartNumber: 'IMX477' }, 'lenses'],
    ['compute_fov_catalog', { sensorPartNumber: 'IMX477' }, 'lenses'],
    ['match_lens_to_sensor', { sensorPartNumber: 'IMX477' }, 'recommendations'],
    ['recommend_lenses_for_application', { sensorPartNumber: 'IMX477' }, 'recommendations'],
    ['compare_lenses', { lensSkus: [sku, 'CIL078'], sensorPartNumber: 'IMX477' }, 'recommendations'],
    ['get_lens_distortion_profile', { lens_sku: sku }, 'profile'],
  ] as const)('preserves DynamoDB specifications through %s', async (name, args, collection) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      sensor: { partNumber: 'IMX477', alpha: 918273.125, beta: 918273.625 }, count: 2,
      errors: [{ partNum: 'CIL250', message: 'alpha=918273.125 beta=918273.625' }],
      lenses: [sku, 'CIL078'].map(partNum => ({ partNum, hfov: 60, vfov: 40, dfov: 72,
        image_circle: 12, efl: 5, f_num: 2, mount, ...specs, ttl, flange_dist, privateField: 'must not leak',
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
    expect(record).toMatchObject({ ...specs, ttl, flange_dist, ttlReference: reference, totalTrackLengthMm: total });
    expect(JSON.parse(payload.result.content[0]!.text)).toEqual(sc);
    expect(JSON.stringify(sc)).not.toContain('must not leak');
    // Check the entire wire response, including text content and backend errors.
    expect(JSON.stringify(payload)).not.toMatch(/"(?:alpha|beta)"|918273\.(?:125|625)/i);
  });
});

it('omits absent or invalid specifications and preserves numeric zero', () => {
  expect(lensSpecifications({})).toEqual({ totalTrackLengthMm: null });
  expect(lensSpecifications({ weight: NaN, mbfl: Infinity, pixelpitchres: '', flange_dist: 0, max_diameter: ' '.repeat(201) }))
    .toEqual({ flange_dist: 0, totalTrackLengthMm: null });
});

it('keeps unresolved track lengths unknown and never substitutes MBFL or a standard flange distance', () => {
  for (const fields of [
    { mount: 'C FA', ttl: 44, mbfl: 7.2 }, { mount: 'C-mount', ttl: 44, flange_dist: 0 },
    { mount: 'C-mount', ttl: 44, flange_dist: '17 cm' }, { mount: 'CS-mount', ttl: 44, flange_dist: 12.5 },
    { ttl: 44, flange_dist: 17.52 }, { mount: 'M12', ttl: '25–30 mm' }, { mount: 'M12', ttl: -1 },
    { mount: 'M12', ttl: Infinity }, { mount: 'M12', ttl: 0 }, { mount: 'M12', totalTrackLengthMm: 999 },
  ]) expect(lensSpecifications(fields).totalTrackLengthMm).toBeNull();
  expect(lensSpecifications({ mount: 'c-mount', ttl: '44 mm' })).toMatchObject({
    ttl: '44 mm', ttlReference: 'front_to_mounting_flange', totalTrackLengthMm: null,
  });
  expect(lensSpecifications({ mount: 'm12', ttl: '30 mm' }).totalTrackLengthMm).toBe(30);
  expect(lensSpecifications({ mount: 'C-mount', ttl: '44 mm', flange_dist: '17.5 mm' })
    .totalTrackLengthMm).toBe(61.5);
  expect(lensSpecifications({ mount: 'C FA', ttl: 44, flange_dist: 17.52, ttlReference: 'unknown' })
    .totalTrackLengthMm).toBeNull();
  expect(lensSpecifications({ mount: 'C FA', ttl: 61.5, ttlReference: 'front_to_image_plane', flange_dist: 17.5 })
    .totalTrackLengthMm).toBe(61.5);
});
