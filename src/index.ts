import {
  assertSafePublicCatalogUrls,
  CATALOG_SNAPSHOT,
  getLensBySku,
  getSensorByPartNumber,
  searchLenses,
  type LensCatalogItem,
} from './catalog';
import { computeFov } from './optics';
import {
  compareLenses,
  matchLensesToSensor,
  recommendLensesForApplication,
  type LensRecommendation,
} from './recommendations';

export interface Env {
  ENVIRONMENT?: string;
  VERSION?: string;
  GIT_SHA?: string;
}

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

interface JsonRpcError {
  code: number;
  message: string;
}

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const SERVER_INFO = {
  name: 'commonlands-mcp',
  version: '0.1.0',
} as const;

const PROTOCOL_VERSION = '2024-11-05';

const TOOLS: ToolDefinition[] = [
  {
    name: 'search_lenses',
    title: 'Search Commonlands lenses',
    description:
      'Search the joined Commonlands lens catalog snapshot by SKU, title, mount, or lens type.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SKU, title, mount, or lens type search text.' },
        limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_lens_details',
    title: 'Get lens details',
    description: 'Return safe public product and optical metadata for one Commonlands lens SKU.',
    inputSchema: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'Commonlands short part number, for example CIL250.' },
      },
      required: ['sku'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_sensor_specs',
    title: 'Get sensor specs',
    description: 'Return fixture-backed sensor dimensions and resolution for Phase 1 matching inputs.',
    inputSchema: {
      type: 'object',
      properties: {
        partNumber: { type: 'string', description: 'Sensor part number, for example IMX477.' },
      },
      required: ['partNumber'],
      additionalProperties: false,
    },
  },
  {
    name: 'compute_fov',
    title: 'Compute lens field of view',
    description:
      'Compute fixture-backed FoV, scene size, and angular resolution for a Commonlands lens and sensor pair.',
    inputSchema: {
      type: 'object',
      properties: {
        lensSku: { type: 'string', description: 'Commonlands short part number, for example CIL250.' },
        sensorPartNumber: { type: 'string', description: 'Sensor part number, for example IMX477.' },
        workingDistanceMm: {
          type: 'number',
          exclusiveMinimum: 0,
          description: 'Optional working distance used to estimate scene width and height.',
        },
      },
      required: ['lensSku', 'sensorPartNumber'],
      additionalProperties: false,
    },
  },
  {
    name: 'match_lenses_to_sensor',
    title: 'Match lenses to a sensor',
    description:
      'Rank fixture catalog lenses for one sensor using image-circle coverage, FoV target fit, and deterministic optical tradeoffs.',
    inputSchema: {
      type: 'object',
      properties: {
        sensorPartNumber: { type: 'string', description: 'Sensor part number, for example IMX477.' },
        desiredHorizontalFovDeg: { type: 'number', exclusiveMinimum: 0 },
        workingDistanceMm: { type: 'number', exclusiveMinimum: 0 },
        mount: { type: 'string', description: 'Optional mount filter, for example M12 or C-mount.' },
        maxResults: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
      },
      required: ['sensorPartNumber'],
      additionalProperties: false,
    },
  },
  {
    name: 'compare_lenses',
    title: 'Compare Commonlands lenses',
    description: 'Compare selected lens SKUs on the same sensor with the same deterministic scoring model.',
    inputSchema: {
      type: 'object',
      properties: {
        lensSkus: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: { type: 'string' },
        },
        sensorPartNumber: { type: 'string', description: 'Sensor part number, for example IMX477.' },
        workingDistanceMm: { type: 'number', exclusiveMinimum: 0 },
      },
      required: ['lensSkus', 'sensorPartNumber'],
      additionalProperties: false,
    },
  },
  {
    name: 'recommend_lenses_for_application',
    title: 'Recommend lenses for an application',
    description:
      'Rank fixture catalog lenses for an application note such as embedded robotics or machine-vision inspection.',
    inputSchema: {
      type: 'object',
      properties: {
        sensorPartNumber: { type: 'string', description: 'Sensor part number, for example IMX477.' },
        application: { type: 'string' },
        desiredHorizontalFovDeg: { type: 'number', exclusiveMinimum: 0 },
        workingDistanceMm: { type: 'number', exclusiveMinimum: 0 },
        mount: { type: 'string' },
        preferLowDistortion: { type: 'boolean', default: false },
        requireInStock: { type: 'boolean', default: false },
        maxResults: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
      },
      required: ['sensorPartNumber'],
      additionalProperties: false,
    },
  },
];

const RESOURCES = [
  {
    uri: 'commonlands://catalog/lenses',
    name: 'Commonlands lens catalog snapshot',
    description: 'Fixture-backed Phase 1 joined lens catalog snapshot.',
    mimeType: 'application/json',
  },
  {
    uri: 'commonlands://catalog/sensors',
    name: 'Commonlands sensor fixture catalog',
    description: 'Fixture-backed Phase 1 sensor catalog for optics-tool inputs.',
    mimeType: 'application/json',
  },
];

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init.headers,
    },
  });
}

function methodNotAllowed(): Response {
  return json({ error: 'method_not_allowed' }, { status: 405, headers: { allow: 'GET, POST' } });
}

function health(env: Env): Response {
  return json({
    ok: true,
    service: SERVER_INFO.name,
    environment: env.ENVIRONMENT ?? 'unknown',
    version: env.VERSION ?? SERVER_INFO.version,
    gitSha: env.GIT_SHA ?? 'unknown',
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rpcResult(id: unknown, result: unknown): Response {
  return json({ jsonrpc: '2.0', id: id ?? null, result }, { status: 200 });
}

function rpcError(id: unknown, error: JsonRpcError): Response {
  return json({ jsonrpc: '2.0', id: id ?? null, error }, { status: 200 });
}

function validateRpcRequest(payload: unknown): JsonRpcRequest | JsonRpcError {
  if (!isRecord(payload)) {
    return { code: -32600, message: 'Invalid Request' };
  }

  if (payload.jsonrpc !== '2.0' || typeof payload.method !== 'string') {
    return { code: -32600, message: 'Invalid Request' };
  }

  return payload;
}

function initializeResponse(id: unknown): Response {
  return rpcResult(id, {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {
      tools: {},
      resources: {},
    },
    serverInfo: SERVER_INFO,
    instructions:
      'Commonlands MCP read-only catalog and optics endpoint. Catalog, FoV, and recommendations are fixture-backed until live DDB/Shopify adapters are configured.',
  });
}

function toolListResponse(id: unknown): Response {
  return rpcResult(id, { tools: TOOLS });
}

function resourceListResponse(id: unknown): Response {
  return rpcResult(id, { resources: RESOURCES });
}

function resourceReadResponse(id: unknown, params: unknown): Response {
  if (!isRecord(params) || typeof params.uri !== 'string') {
    return rpcError(id, { code: -32602, message: 'Invalid params: uri is required' });
  }

  if (params.uri === 'commonlands://catalog/lenses') {
    return rpcResult(id, {
      contents: [
        {
          uri: params.uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            schemaVersion: CATALOG_SNAPSHOT.schemaVersion,
            generatedAt: CATALOG_SNAPSHOT.generatedAt,
            lenses: CATALOG_SNAPSHOT.lenses.map(summarizeLens),
          }),
        },
      ],
    });
  }

  if (params.uri === 'commonlands://catalog/sensors') {
    return rpcResult(id, {
      contents: [
        {
          uri: params.uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            schemaVersion: CATALOG_SNAPSHOT.schemaVersion,
            generatedAt: CATALOG_SNAPSHOT.generatedAt,
            sensors: CATALOG_SNAPSHOT.sensors,
          }),
        },
      ],
    });
  }

  return rpcError(id, { code: -32602, message: `Unknown resource: ${params.uri}` });
}

function toolCallResponse(id: unknown, params: unknown): Response {
  if (!isRecord(params) || typeof params.name !== 'string') {
    return rpcError(id, { code: -32602, message: 'Invalid params: tool name is required' });
  }

  const args = isRecord(params.arguments) ? params.arguments : {};

  if (params.name === 'search_lenses') {
    const query = typeof args.query === 'string' ? args.query : '';
    const limit = typeof args.limit === 'number' ? args.limit : 10;
    const results = searchLenses(query, limit).map(summarizeLens);
    return toolResult(id, {
      schemaVersion: CATALOG_SNAPSHOT.schemaVersion,
      generatedAt: CATALOG_SNAPSHOT.generatedAt,
      results,
      count: results.length,
      source: 'fixture-backed joined catalog snapshot',
    });
  }

  if (params.name === 'get_lens_details') {
    if (typeof args.sku !== 'string') {
      return rpcError(id, { code: -32602, message: 'Invalid params: sku is required' });
    }

    const lens = getLensBySku(args.sku);
    if (!lens) {
      return rpcError(id, { code: -32004, message: `Lens not found: ${args.sku}` });
    }

    return toolResult(id, {
      schemaVersion: CATALOG_SNAPSHOT.schemaVersion,
      generatedAt: CATALOG_SNAPSHOT.generatedAt,
      lens,
    });
  }

  if (params.name === 'get_sensor_specs') {
    if (typeof args.partNumber !== 'string') {
      return rpcError(id, { code: -32602, message: 'Invalid params: partNumber is required' });
    }

    const sensor = getSensorByPartNumber(args.partNumber);
    if (!sensor) {
      return rpcError(id, { code: -32004, message: `Sensor not found: ${args.partNumber}` });
    }

    return toolResult(id, {
      schemaVersion: CATALOG_SNAPSHOT.schemaVersion,
      generatedAt: CATALOG_SNAPSHOT.generatedAt,
      sensor,
    });
  }

  if (params.name === 'compute_fov') {
    if (typeof args.lensSku !== 'string') {
      return rpcError(id, { code: -32602, message: 'Invalid params: lensSku is required' });
    }
    if (typeof args.sensorPartNumber !== 'string') {
      return rpcError(id, { code: -32602, message: 'Invalid params: sensorPartNumber is required' });
    }
    const distanceError = validateOptionalPositiveNumber(args.workingDistanceMm, 'workingDistanceMm');
    if (distanceError) return rpcError(id, distanceError);

    const lens = getLensBySku(args.lensSku);
    if (!lens) {
      return rpcError(id, { code: -32004, message: `Lens not found: ${args.lensSku}` });
    }

    const sensor = getSensorByPartNumber(args.sensorPartNumber);
    if (!sensor) {
      return rpcError(id, { code: -32004, message: `Sensor not found: ${args.sensorPartNumber}` });
    }

    const workingDistanceMm = typeof args.workingDistanceMm === 'number' ? args.workingDistanceMm : undefined;
    return toolResult(id, computeFov(lens, sensor, workingDistanceMm));
  }

  if (params.name === 'match_lenses_to_sensor') {
    const validation = validateRecommendationArgs(args);
    if (validation) return rpcError(id, validation);

    const input = buildRecommendationInput(args);
    try {
      const recommendations = matchLensesToSensor(input);
      return recommendationToolResult(id, input.sensorPartNumber, recommendations);
    } catch (error) {
      return recommendationError(id, error);
    }
  }

  if (params.name === 'compare_lenses') {
    if (!Array.isArray(args.lensSkus) || args.lensSkus.length < 1 || args.lensSkus.length > 10 || args.lensSkus.some((sku) => typeof sku !== 'string' || sku.trim() === '')) {
      return rpcError(id, { code: -32602, message: 'Invalid params: lensSkus must include 1-10 SKUs' });
    }
    if (typeof args.sensorPartNumber !== 'string') {
      return rpcError(id, { code: -32602, message: 'Invalid params: sensorPartNumber is required' });
    }
    const distanceError = validateOptionalPositiveNumber(args.workingDistanceMm, 'workingDistanceMm');
    if (distanceError) return rpcError(id, distanceError);

    const input = {
      lensSkus: args.lensSkus as string[],
      sensorPartNumber: args.sensorPartNumber,
      ...(typeof args.workingDistanceMm === 'number' ? { workingDistanceMm: args.workingDistanceMm } : {}),
    };
    try {
      const recommendations = compareLenses(input);
      return recommendationToolResult(id, input.sensorPartNumber, recommendations);
    } catch (error) {
      return recommendationError(id, error);
    }
  }

  if (params.name === 'recommend_lenses_for_application') {
    const validation = validateRecommendationArgs(args);
    if (validation) return rpcError(id, validation);
    if (args.application !== undefined && typeof args.application !== 'string') {
      return rpcError(id, { code: -32602, message: 'Invalid params: application must be a string when provided' });
    }
    if (args.preferLowDistortion !== undefined && typeof args.preferLowDistortion !== 'boolean') {
      return rpcError(id, { code: -32602, message: 'Invalid params: preferLowDistortion must be boolean when provided' });
    }
    if (args.requireInStock !== undefined && typeof args.requireInStock !== 'boolean') {
      return rpcError(id, { code: -32602, message: 'Invalid params: requireInStock must be boolean when provided' });
    }

    const input = {
      ...buildRecommendationInput(args),
      ...(typeof args.application === 'string' ? { application: args.application } : {}),
      ...(typeof args.preferLowDistortion === 'boolean' ? { preferLowDistortion: args.preferLowDistortion } : {}),
      ...(typeof args.requireInStock === 'boolean' ? { requireInStock: args.requireInStock } : {}),
    };
    try {
      const recommendations = recommendLensesForApplication(input);
      return recommendationToolResult(id, input.sensorPartNumber, recommendations);
    } catch (error) {
      return recommendationError(id, error);
    }
  }

  return rpcError(id, { code: -32601, message: `Tool not found: ${params.name}` });
}

function toolResult(id: unknown, structuredContent: unknown): Response {
  return rpcResult(id, {
    structuredContent,
    content: [
      {
        type: 'text',
        text: JSON.stringify(structuredContent),
      },
    ],
  });
}


function buildRecommendationInput(args: Record<string, unknown>): {
  sensorPartNumber: string;
  desiredHorizontalFovDeg?: number;
  workingDistanceMm?: number;
  mount?: string;
  maxResults?: number;
} {
  if (typeof args.sensorPartNumber !== 'string') {
    throw new Error('Invalid params: sensorPartNumber is required');
  }
  return {
    sensorPartNumber: args.sensorPartNumber,
    ...(typeof args.desiredHorizontalFovDeg === 'number' ? { desiredHorizontalFovDeg: args.desiredHorizontalFovDeg } : {}),
    ...(typeof args.workingDistanceMm === 'number' ? { workingDistanceMm: args.workingDistanceMm } : {}),
    ...(typeof args.mount === 'string' ? { mount: args.mount } : {}),
    ...(typeof args.maxResults === 'number' ? { maxResults: args.maxResults } : {}),
  };
}

function recommendationToolResult(
  id: unknown,
  sensorPartNumber: string,
  recommendations: LensRecommendation[],
): Response {
  return toolResult(id, {
    schemaVersion: 'recommendations.v1',
    correctionStatus: 'fixture_recommendation_scaffold',
    sensor: { partNumber: sensorPartNumber.trim().toUpperCase() },
    recommendations,
    assumptions: [
      'Ranking is fixture-backed and excludes live Shopify stock, price breaks, MTF, CRA, and production coefficient parity until integrations are approved.',
      'Scores are deterministic engineering heuristics for shortlist generation, not final optical design approval.',
    ],
  });
}

function validateRecommendationArgs(args: Record<string, unknown>): JsonRpcError | undefined {
  if (typeof args.sensorPartNumber !== 'string') {
    return { code: -32602, message: 'Invalid params: sensorPartNumber is required' };
  }
  const desiredError = validateOptionalPositiveNumber(args.desiredHorizontalFovDeg, 'desiredHorizontalFovDeg');
  if (desiredError) return desiredError;
  const distanceError = validateOptionalPositiveNumber(args.workingDistanceMm, 'workingDistanceMm');
  if (distanceError) return distanceError;
  if (args.maxResults !== undefined && (typeof args.maxResults !== 'number' || !Number.isFinite(args.maxResults) || args.maxResults < 1 || args.maxResults > 10)) {
    return { code: -32602, message: 'Invalid params: maxResults must be between 1 and 10 when provided' };
  }
  if (args.mount !== undefined && typeof args.mount !== 'string') {
    return { code: -32602, message: 'Invalid params: mount must be a string when provided' };
  }
  return undefined;
}

function validateOptionalPositiveNumber(value: unknown, field: string): JsonRpcError | undefined {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
    return { code: -32602, message: `Invalid params: ${field} must be positive when provided` };
  }
  return undefined;
}

function recommendationError(id: unknown, error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Recommendation failed';
  if (message.startsWith('Sensor not found:') || message.startsWith('Lens not found:')) {
    return rpcError(id, { code: -32004, message });
  }
  return rpcError(id, { code: -32603, message: 'Internal recommendation error' });
}

function summarizeLens(lens: LensCatalogItem): Omit<LensCatalogItem, 'source'> {
  const summary: Omit<LensCatalogItem, 'source' | 'fixtureDistortion'> = {
    sku: lens.sku,
    title: lens.title,
    handle: lens.handle,
    productUrl: lens.productUrl,
    priceUsd: lens.priceUsd,
    availability: lens.availability,
    mount: lens.mount,
    lensType: lens.lensType,
    eflMm: lens.eflMm,
    fNumber: lens.fNumber,
    imageCircleMm: lens.imageCircleMm,
    maxFovDeg: lens.maxFovDeg,
    projectionModel: lens.projectionModel,
    coefficientCount: lens.coefficientCount,
    datasheet: lens.datasheet,
  };

  if (lens.mechanicalDrawingUrl) {
    summary.mechanicalDrawingUrl = lens.mechanicalDrawingUrl;
  }

  return summary;
}

async function handleMcp(request: Request): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return json({ error: 'unsupported_media_type' }, { status: 415 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return rpcError(null, { code: -32700, message: 'Parse error' });
  }

  const parsed = validateRpcRequest(payload);
  if ('code' in parsed) {
    const id = isRecord(payload) ? payload.id : null;
    return rpcError(id, parsed);
  }

  if (parsed.method === 'initialize') return initializeResponse(parsed.id);
  if (parsed.method === 'tools/list') return toolListResponse(parsed.id);
  if (parsed.method === 'tools/call') return toolCallResponse(parsed.id, parsed.params);
  if (parsed.method === 'resources/list') return resourceListResponse(parsed.id);
  if (parsed.method === 'resources/read') return resourceReadResponse(parsed.id, parsed.params);

  return rpcError(parsed.id, {
    code: -32601,
    message: `Method not found: ${parsed.method}`,
  });
}

assertSafePublicCatalogUrls();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/healthz') {
      if (request.method !== 'GET') return methodNotAllowed();
      return health(env);
    }

    if (url.pathname === '/mcp') {
      if (request.method !== 'POST') return methodNotAllowed();
      return handleMcp(request);
    }

    return json({ error: 'not_found' }, { status: 404 });
  },
};
