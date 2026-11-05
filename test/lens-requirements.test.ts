import { afterEach, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import type { assessLensRequirements } from '../src/lens-requirements';
import { __resetSensorStoreCacheForTests } from '../src/sensor-store';

type Assessment = ReturnType<typeof assessLensRequirements>;
const env: Env = { ENVIRONMENT: 'production', FOV_LIVE_BACKEND_ENABLED: 'true',
  FOV_LAMBDA_ENDPOINT: 'https://ia97wrz7ag.execute-api.us-west-2.amazonaws.com/default/fov', FOV_API_KEY: 'assessment-test' };
const baseArgs = { lens_sku: 'CIL353', sensorWidthMm: 6.287, sensorHeightMm: 4.712,
  requirements: { horizontal_fov_deg: { min: 68, max: 74 } } };
const baseLens = { partNum: 'CIL353', hfov: 72, vfov: 52, dfov: 93, image_circle: 10, efl: 4,
  mount: 'M12', weight: '8 g', max_diameter: '12 mm', distortion: '-2% typical', pixelpitchres: '1.55', resolution: '5MP' };

afterEach(() => { vi.unstubAllGlobals(); __resetSensorStoreCacheForTests(); });

function backend(lenses: Record<string, unknown>[] = [baseLens], extra: Record<string, unknown> = {}) {
  const fetcher = vi.fn(async () => Response.json({ count: lenses.length, lenses, ...extra }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
async function call(args: Record<string, unknown> = baseArgs, config = env, name = 'assess_lens_requirements') {
  const response = await worker.fetch(new Request('https://example.test/mcp', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }), config);
  return await response.json() as { result?: { structuredContent: Assessment; content: Array<{ text: string }> }; error?: { code: number; message: string } };
}

it('checks inclusive live FoV ranges, coverage, nominal mount and explicit source units', async () => {
  const fetcher = backend();
  const payload = await call({ ...baseArgs, requirements: {
    horizontal_fov_deg: { min: 72, max: 72 }, vertical_fov_deg: { min: 50, max: 52 }, diagonal_fov_deg: { min: 90, max: 95 },
    full_sensor_coverage: true, mount: 'S-mount', max_weight_g: 8, max_diameter_mm: 12,
  } });
  const report = payload.result!.structuredContent;
  expect(report.status).toBe('satisfies_requested_checks');
  expect(report.checks).toHaveLength(7);
  expect(report.checks.every(check => check.status === 'satisfied')).toBe(true);
  expect(report.missingData).toEqual([]);
  expect(report.sensor.source).toBe('custom');
  expect(report.provenance.sourceDataRevision).toBeNull();
  expect(report.provenance.adapterModelRevision).toBe('lambda-dynamodb-fov-0.1.0');
  expect(JSON.parse(payload.result!.content[0]!.text)).toEqual(report);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('preserves FoV values from calculate_field_of_view without changing calculations', async () => {
  backend();
  const assessment = (await call()).result!.structuredContent;
  const calculated = (await call({ lens_sku: 'CIL353', sensorWidthMm: 6.287, sensorHeightMm: 4.712 }, env, 'calculate_field_of_view')).result!.structuredContent;
  expect(assessment.optics).toMatchObject({ hfov_deg: 72, vfov_deg: 52, dfov_deg: 93, distortion_status: 'source_display_only' });
  for (const key of ['hfov_deg', 'vfov_deg', 'dfov_deg', 'coverage_ok', 'method', 'distortion_status'] as const) {
    expect(assessment.optics[key]).toEqual((calculated as unknown as Record<string, unknown>)[key]);
  }
});

it('returns explicit unknowns for unitless mechanics, display distortion and unpublished engineering evidence', async () => {
  backend([{ ...baseLens, weight: 8, max_diameter: '12', mtf: { private: 'unapproved' }, beta: 918273, alpha: 918274 }]);
  const payload = await call({ ...baseArgs, requirements: { ...baseArgs.requirements, max_weight_g: 10, max_diameter_mm: 15,
    distortion: { axis: 'horizontal', max_absolute_percent: 3 },
    require_evidence: ['mtf', 'cra', 'relative_illumination', 'spectral_transmission', 'mechanical_fit', 'environmental', 'depth_of_field'],
  } });
  const report = payload.result!.structuredContent;
  expect(report.status).toBe('needs_confirmation');
  expect(report.missingData).toHaveLength(10);
  expect(report.checks.filter(check => check.status === 'unknown').every(check => check.observed === null && check.source === null)).toBe(true);
  expect(report.checks.find(check => check.requirement === 'horizontal_fov_deg')?.status).toBe('satisfied');
  expect(JSON.stringify(payload)).not.toMatch(/918273|918274|unapproved|"alpha"|"beta"/);
});

it('fails out-of-range FoV, insufficient coverage and CS versus C mount without hiding missing evidence', async () => {
  backend([{ ...baseLens, image_circle: 5, mount: 'CS-mount' }]);
  const report = (await call({ ...baseArgs, requirements: { horizontal_fov_deg: { min: 59, max: 61 },
    full_sensor_coverage: true, mount: 'C FA', require_evidence: ['cra'],
  } })).result!.structuredContent;
  expect(report.status).toBe('fails_requested_requirements');
  expect(report.failedRequirements).toEqual(['horizontal_fov_deg', 'full_sensor_coverage', 'mount']);
  expect(report.missingData.map(item => item.requirement)).toEqual(['cra']);
});

it.each([
  ['horizontal', 3, 'satisfied'], ['horizontal', 2, 'failed'], ['vertical', 3, 'unknown'],
] as const)('uses absolute calculated distortion only on the requested %s axis (limit %s)', async (axis, max, status) => {
  backend([{ ...baseLens, horizontalDistortion: -3, diagonalDistortion: 1 }]);
  const report = (await call({ ...baseArgs, requirements: { distortion: { axis, max_absolute_percent: max } } })).result!.structuredContent;
  expect(report.checks[0]?.status).toBe(status);
  expect(report.optics.distortion_status).toBe('calculated');
});

it('labels sensor fixture fallback and requires confirmation even if the FoV check passes', async () => {
  backend();
  const report = (await call({ lens_sku: 'CIL353', sensor: 'IMX477', requirements: baseArgs.requirements })).result!.structuredContent;
  expect(report.sensor.source).toBe('fixture');
  expect(report.status).toBe('needs_confirmation');
  expect(report.limitations.join(' ')).toContain('reference fixture fallback');
});

it('uses the live sensor dimensions for the backend request and labels their source', async () => {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (String(url).startsWith('https://dynamodb.')) return Response.json({ Items: [{
      id: { S: 'IMX477' }, sensorhpix: { N: '4056' }, sensorvpix: { N: '3040' }, sensorpitch: { N: '1.55' },
    }] });
    bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return Response.json({ count: 1, lenses: [baseLens] });
  }));
  const report = (await call({ lens_sku: 'CIL353', sensor: 'IMX477', requirements: baseArgs.requirements }, {
    ...env, SENSOR_DDB_TABLE: 'AssessmentSensorData', SENSOR_DDB_REGION: 'us-west-2',
    AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE', AWS_SECRET_ACCESS_KEY: 'test-only',
  })).result!.structuredContent;
  expect(report.sensor.source).toBe('live');
  expect(report.status).toBe('satisfies_requested_checks');
  expect(report.sensor.activeAreaMm.width).toBeCloseTo(6.2868, 4);
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ partNums: ['CIL353'], sensor: { hsize: report.sensor.activeAreaMm.width, vsize: report.sensor.activeAreaMm.height } });
});

it('does not pick the first returned lens when another part precedes the requested part', async () => {
  backend([{ ...baseLens, partNum: 'CIL344A', hfov: 81 }, baseLens]);
  expect((await call()).result!.structuredContent.optics.hfov_deg).toBe(72);
});

it.each([
  { lenses: [] }, { lenses: [{ ...baseLens, partNum: 'CIL344A' }] }, { lenses: [baseLens, baseLens] },
  { lenses: [baseLens], count: 11 }, { lenses: [baseLens], errors: [{ partNum: 'CIL353', error: 'private beta=918273' }] },
])('refuses absent, ambiguous or incomplete upstream records: %j', async fixture => {
  const { lenses, ...extra } = fixture;
  backend(lenses, extra);
  const payload = await call();
  expect(payload.error?.code).toBe(-32603);
  expect(payload.result).toBeUndefined();
  expect(JSON.stringify(payload)).not.toContain('918273');
});

it.each([401, 503])('fails closed on upstream HTTP %s rather than creating a fixture assessment', async status => {
  const fetcher = vi.fn(async () => new Response('', { status }));
  vi.stubGlobal('fetch', fetcher);
  const payload = await call();
  expect(payload.error).toBeDefined();
  expect(payload.result).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(status === 503 ? 2 : 1);
});

it('requires the live backend even in development', async () => {
  const fetcher = backend();
  expect((await call(baseArgs, {})).error?.code).toBe(-32603);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  {}, { horizontal_fov_deg: { min: 80, max: 70 } }, { horizontal_fov_deg: { min: 0, max: 70 } },
  { horizontal_fov_deg: { min: '60', max: 70 } }, { horizontal_fov_deg: { min: 60, max: 400 } },
  { horizontal_fov_deg: { min: 60, max: 70, tolerance: 10 } },
  { full_sensor_coverage: false }, { mount: 'not a mount' }, { max_weight_g: -1 }, { max_diameter_mm: '12' },
  { distortion: { max_absolute_percent: 3 } }, { distortion: { axis: 'horizontal', max_absolute_percent: -3 } },
  { require_evidence: [] }, { require_evidence: ['mtf', 'mtf'] }, { require_evidence: ['invented'] },
  { caller_verified: true },
])('rejects invalid requirements before any upstream fetch: %j', async requirements => {
  const fetcher = backend();
  expect((await call({ ...baseArgs, requirements })).error?.code).toBe(-32602);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  { ...baseArgs, sensor: 'IMX477' }, { ...baseArgs, sensorWidthMm: '6' }, { ...baseArgs, sensorHeightMm: null },
  { lens_sku: 'CIL353', widthPx: 100.5, heightPx: 100, pixelSizeUm: 2, requirements: baseArgs.requirements },
  { lens_sku: 'CIL353', requirements: baseArgs.requirements }, { ...baseArgs, beta: 1 }, { ...baseArgs, lens_sku: '../private' },
])('rejects conflicting/malformed sensor inputs or unsupported arguments: %j', async args => {
  const fetcher = backend();
  expect((await call(args)).error?.code).toBe(-32602);
  expect(fetcher).not.toHaveBeenCalled();
});
