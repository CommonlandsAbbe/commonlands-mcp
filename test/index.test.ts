import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/index';

const env: Env = {
  ENVIRONMENT: 'test',
  VERSION: '0.1.0-test',
  GIT_SHA: 'abc123',
};

type JsonObject = Record<string, unknown>;

interface ToolSummary {
  name: string;
  inputSchema: JsonObject;
}

interface LensSummary {
  sku: string;
  productUrl: string;
  mount: string;
  eflMm: number;
  projectionModel: string;
}

interface ResourceSummary {
  uri: string;
}

async function fetchWorker(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`https://mcp.commonlands.test${path}`, init), env);
}

async function rpc(
  method: string,
  params?: unknown,
  id: unknown = method,
): Promise<{ response: Response; body: JsonObject }> {
  const response = await fetchWorker('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });

  const body = (await response.json()) as JsonObject;
  return { response, body };
}

function getResult(body: JsonObject): JsonObject {
  expect(body.error).toBeUndefined();
  expect(body.result).toBeTypeOf('object');
  return body.result as JsonObject;
}

function getStructuredContent(body: JsonObject): JsonObject {
  const result = getResult(body);
  expect(result.structuredContent).toBeTypeOf('object');
  return result.structuredContent as JsonObject;
}

describe('Commonlands MCP Worker', () => {
  it('returns deploy metadata from /healthz', async () => {
    const response = await fetchWorker('/healthz');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      service: 'commonlands-mcp',
      environment: 'test',
      version: '0.1.0-test',
      gitSha: 'abc123',
    });
  });

  it('supports MCP initialize smoke test', async () => {
    const { response, body } = await rpc(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'vitest', version: '0.0.0' },
      },
      1,
    );

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'commonlands-mcp', version: '0.1.0' },
        capabilities: { tools: {}, resources: {} },
      },
    });
  });

  it('lists Phase 1 catalog tools', async () => {
    const { body } = await rpc('tools/list');
    const result = getResult(body);
    const tools = result.tools as ToolSummary[];

    expect(tools.map((tool) => tool.name)).toEqual([
      'search_lenses',
      'get_lens_details',
      'get_sensor_specs',
      'compute_fov',
      'match_lenses_to_sensor',
      'compare_lenses',
      'recommend_lenses_for_application',
    ]);
    expect(tools[0]?.inputSchema.type).toBe('object');
  });

  it('searches joined catalog snapshot and returns safe product summaries', async () => {
    const { body } = await rpc('tools/call', {
      name: 'search_lenses',
      arguments: { query: 'CIL078', limit: 3 },
    });
    const structuredContent = getStructuredContent(body);
    const results = structuredContent.results as LensSummary[];

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      sku: 'CIL078',
      productUrl: 'https://commonlands.com/products/cil078',
      mount: 'M12',
      eflMm: 2.8,
      projectionModel: 'projection_polynomial_theta_even_powers',
    });
    expect(JSON.stringify(getResult(body))).not.toContain('docsend');
  });

  it('returns lens details with validated mechanical drawing URL and no gated datasheet URL', async () => {
    const { body } = await rpc('tools/call', {
      name: 'get_lens_details',
      arguments: { sku: 'CIL250' },
    });
    const structuredContent = getStructuredContent(body);
    const lens = structuredContent.lens as JsonObject;

    expect(lens).toMatchObject({
      sku: 'CIL250',
      handle: 'cil250',
      mechanicalDrawingUrl: 'https://cdn.shopify.com/s/files/1/0624/5391/3805/files/CIL250.pdf',
    });
    expect(lens.datasheet).toEqual({
      gated: true,
      note: 'Datasheets are gated; use the product page for access instructions.',
    });
    expect(JSON.stringify(getResult(body))).not.toMatch(/docsend/i);
  });

  it('returns sensor specs by part number', async () => {
    const { body } = await rpc('tools/call', {
      name: 'get_sensor_specs',
      arguments: { partNumber: 'IMX477' },
    });
    const structuredContent = getStructuredContent(body);

    expect(structuredContent.sensor).toMatchObject({
      partNumber: 'IMX477',
      resolution: { widthPx: 4056, heightPx: 3040 },
      activeAreaMm: { width: 6.287, height: 4.712 },
    });
  });

  it('lists and reads catalog resources', async () => {
    const listed = await rpc('resources/list');
    const listedResult = getResult(listed.body);
    const resources = listedResult.resources as ResourceSummary[];
    expect(resources.map((resource) => resource.uri)).toContain('commonlands://catalog/lenses');

    const read = await rpc('resources/read', { uri: 'commonlands://catalog/lenses' });
    const readResult = getResult(read.body);
    const contents = readResult.contents as Array<JsonObject>;
    expect(contents[0]).toMatchObject({
      uri: 'commonlands://catalog/lenses',
      mimeType: 'application/json',
    });
    const parsed = JSON.parse(contents[0]?.text as string) as { lenses: LensSummary[] };
    expect(parsed.lenses.length).toBeGreaterThanOrEqual(5);
  });


  it('computes fixture-backed distortion-aware FoV and angular resolution', async () => {
    const { body } = await rpc('tools/call', {
      name: 'compute_fov',
      arguments: { lensSku: 'CIL250', sensorPartNumber: 'IMX477', workingDistanceMm: 1000 },
    });
    const structuredContent = getStructuredContent(body);

    expect(structuredContent).toMatchObject({
      schemaVersion: 'optics.fov.v1',
      modelVersion: 'fixture-polynomial-fov-0.1.0',
      correctionStatus: 'fixture_parity_scaffold',
      lens: { sku: 'CIL250', projectionModel: 'projection_polynomial_theta_even_powers' },
      sensor: { partNumber: 'IMX477' },
      imageCircle: { clipped: true, usedWidthMm: 5.761, usedHeightMm: 4.318 },
      fov: {
        horizontalDeg: 51.3,
        verticalDeg: 39.6,
        diagonalDeg: 61.9,
        sceneWidthMm: 960.4,
        sceneHeightMm: 720,
      },
      angularResolution: {
        horizontalPxPerDeg: 79.1,
        verticalPxPerDeg: 76.8,
      },
    });
    expect(structuredContent.assumptions).toContain(
      'Uses fixture coefficients until real AppSync/DynamoDB projection data is connected.',
    );
    expect((structuredContent.warnings as string[]).join(' ')).toMatch(/image circle/i);
  });

  it('reports image-circle clipping for sensors larger than lens coverage', async () => {
    const { body } = await rpc('tools/call', {
      name: 'compute_fov',
      arguments: { lensSku: 'CIL051', sensorPartNumber: 'IMX477', workingDistanceMm: 500 },
    });
    const structuredContent = getStructuredContent(body);

    expect(structuredContent).toMatchObject({
      lens: { sku: 'CIL051' },
      sensor: { partNumber: 'IMX477' },
      imageCircle: { clipped: true, usedDiagonalMm: 4.5 },
      fov: { diagonalDeg: 102.7 },
    });
    expect((structuredContent.warnings as string[]).join(' ')).toMatch(/image circle/i);
  });

  it('caps FoV when the raw diagonal exceeds lens max FoV', async () => {
    const { body } = await rpc('tools/call', {
      name: 'compute_fov',
      arguments: { lensSku: 'CIL121', sensorPartNumber: 'IMX477' },
    });
    const structuredContent = getStructuredContent(body);

    expect(structuredContent).toMatchObject({
      lens: { sku: 'CIL121' },
      sensor: { partNumber: 'IMX477' },
      imageCircle: { clipped: false, usedDiagonalMm: 7.857 },
      fov: { horizontalDeg: 19.3, verticalDeg: 14.6, diagonalDeg: 24 },
    });
    expect((structuredContent.warnings as string[]).join(' ')).toMatch(/maximum field/i);
  });

  it('rejects invalid FoV params without throwing', async () => {
    const missingLens = await rpc('tools/call', {
      name: 'compute_fov',
      arguments: { lensSku: 'NOPE', sensorPartNumber: 'IMX477' },
    });
    expect(missingLens.body).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32004, message: 'Lens not found: NOPE' },
    });

    const invalidDistance = await rpc('tools/call', {
      name: 'compute_fov',
      arguments: { lensSku: 'CIL250', sensorPartNumber: 'IMX477', workingDistanceMm: -1 },
    });
    expect(invalidDistance.body).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32602, message: 'Invalid params: workingDistanceMm must be positive when provided' },
    });
  });


  it('matches lenses to a sensor with deterministic ranked tradeoffs', async () => {
    const { body } = await rpc('tools/call', {
      name: 'match_lenses_to_sensor',
      arguments: { sensorPartNumber: 'IMX477', desiredHorizontalFovDeg: 50, maxResults: 3 },
    });
    const structuredContent = getStructuredContent(body);
    const recommendations = structuredContent.recommendations as Array<JsonObject>;

    expect(structuredContent).toMatchObject({
      schemaVersion: 'recommendations.v1',
      correctionStatus: 'fixture_recommendation_scaffold',
      sensor: { partNumber: 'IMX477' },
    });
    expect(recommendations).toHaveLength(3);
    expect(recommendations[0]).toMatchObject({
      rank: 1,
      lens: { sku: 'CIL250' },
      fit: 'good',
    });
    expect(recommendations[0]?.tradeoffs).toContain('Horizontal FoV is within 5° of target.');
    expect(JSON.stringify(structuredContent)).not.toMatch(/docsend/i);
  });

  it('compares selected lenses and ranks full image-circle coverage above clipped candidates when FoV is otherwise close', async () => {
    const { body } = await rpc('tools/call', {
      name: 'compare_lenses',
      arguments: { lensSkus: ['CIL078', 'CIL250', 'CIL121'], sensorPartNumber: 'IMX477' },
    });
    const structuredContent = getStructuredContent(body);
    const recommendations = structuredContent.recommendations as Array<JsonObject>;

    expect((recommendations[0]?.lens as JsonObject).sku).toBe('CIL121');
    expect(recommendations.map((item) => (item.lens as JsonObject).sku)).toContain('CIL078');
    expect(recommendations.map((item) => (item.lens as JsonObject).sku)).toContain('CIL250');
    expect(recommendations[0]).toMatchObject({
      rank: 1,
      lens: { sku: 'CIL121' },
      imageCircle: { clipped: false },
    });
    expect(recommendations.find((item) => (item.lens as JsonObject).sku === 'CIL078')).toMatchObject({
      lens: { sku: 'CIL078' },
      imageCircle: { clipped: true },
    });
  });

  it('recommends lenses for application preferences without requiring live stock data', async () => {
    const { body } = await rpc('tools/call', {
      name: 'recommend_lenses_for_application',
      arguments: {
        sensorPartNumber: 'IMX477',
        application: 'embedded robotics navigation',
        desiredHorizontalFovDeg: 100,
        preferLowDistortion: true,
        requireInStock: true,
        maxResults: 2,
      },
    });
    const structuredContent = getStructuredContent(body);
    const recommendations = structuredContent.recommendations as Array<JsonObject>;

    expect(recommendations).toHaveLength(2);
    expect(recommendations[0]).toMatchObject({ lens: { mount: 'M12' } });
    expect((recommendations[0]?.tradeoffs as string[]).join(' ')).toMatch(/M12 form factor/i);
    expect(structuredContent.assumptions).toContain(
      'Ranking is fixture-backed and excludes live Shopify stock, price breaks, MTF, CRA, and production coefficient parity until integrations are approved.',
    );
  });

  it('returns useful recommendation validation errors', async () => {
    const missingSensor = await rpc('tools/call', {
      name: 'match_lenses_to_sensor',
      arguments: { sensorPartNumber: 'NOPE' },
    });
    expect(missingSensor.body).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32004, message: 'Sensor not found: NOPE' },
    });

    const invalidCompare = await rpc('tools/call', {
      name: 'compare_lenses',
      arguments: { lensSkus: [], sensorPartNumber: 'IMX477' },
    });
    expect(invalidCompare.body).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32602, message: 'Invalid params: lensSkus must include 1-10 SKUs' },
    });
  });

  it('returns JSON-RPC errors for invalid tool calls without throwing', async () => {
    const { body } = await rpc('tools/call', { name: 'missing_tool', arguments: {} });

    expect(body).toEqual({
      jsonrpc: '2.0',
      id: 'tools/call',
      error: { code: -32601, message: 'Tool not found: missing_tool' },
    });
  });

  it('rejects non-json MCP requests before parsing', async () => {
    const response = await fetchWorker('/mcp', { method: 'POST', body: 'not json' });
    const body = await response.json();

    expect(response.status).toBe(415);
    expect(body).toEqual({ error: 'unsupported_media_type' });
  });

  it('returns safe 404 JSON for unknown paths', async () => {
    const response = await fetchWorker('/does-not-exist');
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'not_found' });
  });
});
