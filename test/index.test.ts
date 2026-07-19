import { afterEach, describe, expect, it } from 'vitest';
import worker, { __resetLensCatalogCacheForTests, type Env } from '../src/index';
import { signDynamoRequest } from '../src/aws-sigv4';
import { __resetSensorStoreCacheForTests } from '../src/sensor-store';

const env: Env = {
  ENVIRONMENT: 'test',
  VERSION: '0.1.0-test',
  GIT_SHA: 'abc123',
};

const shopifyReadonlyEnv: Env = {
  ...env,
  SHOPIFY_CLIENT_ID: 'client-id-test',
  SHOPIFY_CLIENT_SECRET: 'client-secret-test',
  SHOPIFY_SHOP_DOMAIN: 'commonlands-store.myshopify.com',
  SHOPIFY_SCOPES:
    'read_files,read_inventory,read_online_store_navigation,read_online_store_pages,read_product_feeds,read_product_listings,read_products,read_content',
};

const shopifyCartEnv: Env = {
  ...shopifyReadonlyEnv,
  ENABLE_COMMERCE_MUTATION_TOOLS: 'true',
  SHOPIFY_CART_MCP_ENDPOINT: 'https://commonlands.com/api/mcp',
  SHOPIFY_UCP_AGENT_PROFILE: 'https://mcp.commonlands.com/.well-known/ucp',
};

const shopifyCheckoutBasicEnv: Env = {
  ...shopifyCartEnv,
  ENABLE_CHECKOUT_MUTATION_TOOLS: 'true',
  SHOPIFY_CHECKOUT_MCP_ENDPOINT: 'https://commonlands.com/api/ucp/mcp',
};

const shopifyCheckoutEnv: Env = {
  ...shopifyCheckoutBasicEnv,
  ENABLE_EXTRA_CHECKOUT_MUTATION_TOOLS: 'true',
};

type JsonObject = Record<string, unknown>;

interface ToolSummary {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JsonObject;
  outputSchema?: JsonObject;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    destructiveHint?: boolean;
  };
}

interface LensSummary {
  sku: string;
  productUrl: string;
  mount: string;
  eflMm: number;
  projectionModel: string;
}

interface ShopifyUcpReadiness {
  schemaVersion: string;
  generatedAt: string;
  compatibilityTarget: {
    shopifyStorefrontMcp: string;
    ucpCatalogVersion: string;
  };
  readiness: {
    status: string;
    liveConnectors: string;
    cartCheckout: string;
    customerAccounts: string;
  };
  ucpCatalog: {
    compatibleTools: string[];
    missingRequiredFields: string[];
    productCount: number;
    variantCount: number;
  };
  differentiators: string[];
}


interface SourceWarning {
  severity: string;
  code: string;
  text: string;
}

interface UcpCatalogResult {
  schemaVersion: string;
  ucp: { version: string; capability: string; transport: string };
  catalog: { products: Array<Record<string, unknown>> };
  messages: Array<{ type: string; code: string; text: string }>;
  sourceWarning?: SourceWarning;
}

interface ShopifyPurchaseHandoff {
  schemaVersion: string;
  correctionStatus: string;
  quantity: number;
  product: { sku: string; productUrl: string; variantId: string; selectedVariantIdSource?: string };
  transaction: { mode: string; cartCheckout: string; createsCart: boolean; requiresApprovalBeforeLiveMutation: boolean };
  warnings: string[];
  sourceWarning?: SourceWarning;
}

interface PurchaseRouteOptions {
  schemaVersion: string;
  correctionStatus: string;
  product: { sku: string; productUrl: string; variantId: string };
  sourceWarning?: SourceWarning;
  context: { buyerIntent: string; agentType?: string; sensorPartNumber?: string; quantity: number };
  routes: Array<{ channel: string; status: string; recommendedFor: string[]; actions: Record<string, unknown> }>;
  requiredBeforeLiveTransaction: string[];
  transactionSafety: { createsCart: boolean; createsCheckout: boolean; writesShopify: boolean; writesCommonlandsOrder: boolean; requiresHumanApprovalBeforeMutation: boolean };
  warnings: string[];
}

interface CatalogSnapshotStatus {
  schemaVersion: string;
  generatedAt: string;
  counts: {
    lenses: number;
    sensors: number;
    joins: number;
    missingCommerce: number;
    missingOptical: number;
    unsafeUrls: number;
  };
  validation: {
    ok: boolean;
    errors: string[];
    warnings: string[];
  };
  sourceWarning?: SourceWarning;
  sources: {
    optical: string;
    commerce: string;
  };
  refresh: {
    mode: string;
    liveConnectors: string;
  };
}

interface ResourceSummary {
  uri: string;
  name?: string;
  description?: string;
}

async function fetchWorker(path: string, init?: RequestInit, requestEnv: Env = env): Promise<Response> {
  return worker.fetch(new Request(`https://mcp.commonlands.test${path}`, init), requestEnv);
}

async function rpc(
  method: string,
  params?: unknown,
  id: unknown = method,
  requestEnv: Env = env,
): Promise<{ response: Response; body: JsonObject }> {
  const response = await fetchWorker('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  }, requestEnv);

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

function metafield(namespace: string, key: string, type: string, value: string): JsonObject {
  return { namespace, key, type, value, reference: null };
}

function shopifyProductVariantNode(input: {
  productId: string;
  handle: string;
  title: string;
  sku: string;
  variantId: string;
  price: string;
  inventoryQuantity: number;
  metafields: JsonObject[];
}): JsonObject {
  return {
    id: input.variantId,
    sku: input.sku,
    title: input.sku,
    price: input.price,
    inventoryQuantity: input.inventoryQuantity,
    inventoryItem: { id: `${input.variantId}/InventoryItem`, tracked: true },
    metafields: { nodes: [] },
    product: {
      id: input.productId,
      handle: input.handle,
      title: input.title,
      status: 'ACTIVE',
      productType: 'Lens',
      vendor: 'Commonlands',
      tags: [],
      onlineStoreUrl: null,
      metafields: { nodes: input.metafields },
      media: { nodes: [] },
    },
  };
}

describe('Commonlands MCP Worker', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    __resetSensorStoreCacheForTests();
    __resetLensCatalogCacheForTests();
  });

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
      telemetry: {
        analyticsEngine: 'disabled',
      },
    });
  });

  it('reports Analytics Engine telemetry as configured when the binding exists', async () => {
    const response = await fetchWorker('/healthz', undefined, {
      ...env,
      MCP_ANALYTICS: {
        writeDataPoint() {},
      },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      telemetry: {
        analyticsEngine: 'configured',
      },
    });
  });

  it('supports MCP initialize smoke test', async () => {
    const { response, body } = await rpc(
      'initialize',
      {
        protocolVersion: '2025-11-25',
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
        protocolVersion: '2025-11-25',
        serverInfo: { name: 'commonlands-mcp', version: '0.3.2' },
        capabilities: { tools: {}, resources: {}, prompts: {} },
      },
    });
  });

  it('negotiates stale initialize protocol requests to the latest Streamable HTTP revision', async () => {
    const { body } = await rpc(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'legacy-smoke', version: '0.0.0' },
      },
      'legacy-initialize',
    );

    expect(getResult(body)).toMatchObject({
      protocolVersion: '2025-11-25',
    });
  });


  it('writes privacy-safe MCP telemetry when Analytics Engine binding is present', async () => {
    const writes: Array<{ blobs?: string[]; doubles?: number[]; indexes?: string[] }> = [];
    const requestEnv: Env = {
      ...env,
      MCP_ANALYTICS: {
        writeDataPoint(dataPoint) {
          writes.push(dataPoint);
        },
      },
    };

    const { response, body } = await rpc(
      'tools/call',
      { name: 'get_sensor_specs', arguments: { partNumber: 'IMX477', secretLike: 'do-not-log' } },
      'telemetry-tool-call',
      requestEnv,
    );

    expect(response.status).toBe(200);
    expect(getStructuredContent(body)).toMatchObject({ sensor: { partNumber: 'IMX477' } });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      blobs: ['POST', '/mcp', 'tools/call', 'get_sensor_specs', 'ok', 'unknown', 'test', '0.1.0-test'],
      indexes: ['tools/call'],
    });
    expect(writes[0]?.doubles?.[0]).toBe(200);
    expect(JSON.stringify(writes)).not.toContain('IMX477');
    expect(JSON.stringify(writes)).not.toContain('do-not-log');
  });

  it('records JSON-RPC tool errors in telemetry without logging request arguments', async () => {
    const writes: Array<{ blobs?: string[]; doubles?: number[]; indexes?: string[] }> = [];
    const requestEnv: Env = {
      ...env,
      MCP_ANALYTICS: {
        writeDataPoint(dataPoint) {
          writes.push(dataPoint);
        },
      },
    };

    const { body } = await rpc(
      'tools/call',
      { name: 'create_checkout', arguments: { variantId: 'gid://shopify/ProductVariant/secret-ish' } },
      'telemetry-disabled-checkout',
      requestEnv,
    );

    expect(body).toMatchObject({ error: { code: -32601, message: 'Tool not found: create_checkout' } });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.blobs).toEqual(['POST', '/mcp', 'tools/call', 'create_checkout', 'jsonrpc_error_-32601', 'unknown', 'test', '0.1.0-test']);
    expect(JSON.stringify(writes)).not.toContain('secret-ish');
  });

  it('lists the public intent-named optics tools with anti-DIY schemas', async () => {
    const { body } = await rpc('tools/list');
    const result = getResult(body);
    const tools = result.tools as ToolSummary[];
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual([
      'calculate_field_of_view',
      'match_lens_to_sensor',
      'search_lens_catalog',
      'get_lens_distortion_profile',
      'get_sensor_specs',
      'compare_lenses',
      'get_product_page_details',
      'get_catalog_snapshot_status',
      'get_shopify_ucp_readiness',
      'get_shopify_readonly_config_status',
      'read_shopify_products',
      'search_catalog',
      'lookup_catalog',
      'get_product',
      'prepare_shopify_purchase_handoff',
      'get_purchase_route_options',
      'recommend_lenses_for_application',
      'submit_rfq',
    ]);
    expect(toolNames).not.toContain('search_lenses');
    expect(toolNames).not.toContain('get_lens_details');
    expect(toolNames).not.toContain('compute_fov');
    expect(toolNames).not.toContain('compute_fov_catalog');
    expect(toolNames).not.toContain('match_lenses_to_sensor');
    expect(toolNames).not.toContain('complete_checkout');
    expect(toolNames).not.toContain('update_checkout');
    expect(toolNames).not.toContain('cancel_checkout');
    expect(tools[0]?.inputSchema.type).toBe('object');

    const fovTool = tools.find((tool) => tool.name === 'calculate_field_of_view');
    expect(fovTool?.inputSchema).toMatchObject({
      anyOf: expect.arrayContaining([
        { required: ['lens_sku'] },
        { required: ['lensSku'] },
        { required: ['focal_length_mm'] },
        { required: ['focalLengthMm'] },
      ]),
    });
    expect((fovTool?.inputSchema.properties as JsonObject).lens_sku).toBeTypeOf('object');
    expect((fovTool?.inputSchema.properties as JsonObject).focal_length_mm).toBeTypeOf('object');
    expect((fovTool?.inputSchema.properties as JsonObject).working_distance_mm).toBeTypeOf('object');
    expect(fovTool?.outputSchema).toMatchObject({
      required: expect.arrayContaining([
        'hfov_deg',
        'vfov_deg',
        'dfov_deg',
        'method',
        'distortion_model',
        'image_circle_mm',
        'sensor_diagonal_mm',
        'coverage_ok',
        'rectilinear_comparison',
      ]),
      properties: {
        rectilinear_comparison: {
          required: ['dfov_deg', 'delta_deg'],
        },
      },
    });

    const metadataText = tools.map((tool) => `${tool.title ?? ''} ${tool.description ?? ''}`).join(' ');
    expect(metadataText).toMatch(/M12 lenses/i);
    expect(metadataText).toMatch(/C-mount lenses/i);
    expect(metadataText).toMatch(/field of view/i);
    expect(metadataText).toMatch(/HFOV/i);
    expect(metadataText).toMatch(/VFOV/i);
    expect(metadataText).toMatch(/DFOV/i);
    expect(metadataText).toMatch(/AR0234/i);
    expect(metadataText).toMatch(/IMX290/i);
    expect(metadataText).toMatch(/IMX477/i);
    expect(metadataText).toMatch(/lens for/i);
    expect(metadataText).toMatch(/read_shopify_products/i);
    expect(metadataText).toMatch(/live backend/i);
    expect(metadataText).toMatch(/distortion model\/status/i);
    expect(metadataText).toMatch(/live stock/i);
    expect(metadataText).toMatch(/MTF\/CRA\/BFL/i);
    expect(metadataText).toMatch(/Do not use naive rectilinear fallback/i);
    expect(metadataText).toMatch(/focal-length-only math/i);
  });

  it('annotates every visible tool with display title and risk hints', async () => {
    const { body } = await rpc('tools/list', undefined, 'annotated-tools', shopifyCartEnv);
    const tools = getResult(body).tools as ToolSummary[];

    expect(tools.length).toBeGreaterThanOrEqual(20);
    expect(tools.map((tool) => tool.name)).not.toContain('read_shopify_metaobjects');
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({
        title: tool.title,
        readOnlyHint: expect.any(Boolean),
        idempotentHint: expect.any(Boolean),
        openWorldHint: false,
        destructiveHint: expect.any(Boolean),
      });
    }

    const fovTool = tools.find((tool) => tool.name === 'calculate_field_of_view');
    expect(fovTool?.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
      destructiveHint: false,
    });

    // get_cart is a read: read-only and idempotent, never destructive. create_cart
    // writes new state but destroys nothing. update_cart overwrites existing state.
    const getCart = tools.find((tool) => tool.name === 'get_cart');
    expect(getCart?.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
    });
    const createCart = tools.find((tool) => tool.name === 'create_cart');
    expect(createCart?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    const updateCart = tools.find((tool) => tool.name === 'update_cart');
    expect(updateCart?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });

  it('never references hidden tool names inside visible tool descriptions', async () => {
    const { body } = await rpc('tools/list', undefined, 'visible-descriptions', shopifyCartEnv);
    const tools = getResult(body).tools as ToolSummary[];
    const visibleNames = new Set(tools.map((tool) => tool.name));
    const hiddenNames = [
      'compute_fov_catalog',
      'compute_fov',
      'match_lenses_to_sensor',
      'search_lenses',
      'get_lens_details',
    ].filter((name) => !visibleNames.has(name));

    for (const tool of tools) {
      for (const hidden of hiddenNames) {
        expect(
          `${tool.description ?? ''}`.includes(hidden),
          `visible tool ${tool.name} description references hidden tool ${hidden}`,
        ).toBe(false);
      }
    }
  });


  it('returns MCP initialize instructions with usage, SEO, and security metadata', async () => {
    const { body } = await rpc(
      'initialize',
      {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'vitest', version: '0.0.0' },
      },
      'initialize-metadata',
    );
    const result = getResult(body);
    const instructions = result.instructions as string;

    expect(instructions).toMatch(/https:\/\/mcp\.commonlands\.com\/mcp/i);
    expect(instructions).toMatch(/M12 lenses/i);
    expect(instructions).toMatch(/C-mount lenses/i);
    expect(instructions).toMatch(/lens field of view/i);
    expect(instructions).toMatch(/Use read_shopify_products/i);
    expect(instructions).toMatch(/insufficient to compute field of view on a specific sensor/i);
    expect(instructions).toMatch(/prefer match_lens_to_sensor/i);
    expect(instructions).toMatch(/calculate_field_of_view/i);
    expect(instructions).toMatch(/Do not pass arbitrary URLs/i);
    expect(instructions).toMatch(/not accept client-supplied downstream tokens/i);
    expect(instructions).toMatch(/Do not run DIY optics math/i);
    expect(instructions).toMatch(/label every optical or commerce claim with its source/i);
  });

  it('only lists commerce mutation tools when explicitly enabled', async () => {
    const cartList = await rpc('tools/list', undefined, 'cart-tools', shopifyCartEnv);
    const cartNames = ((getResult(cartList.body).tools as ToolSummary[]).map((tool) => tool.name));
    expect(cartNames).toEqual(expect.arrayContaining(['create_cart', 'get_cart', 'update_cart']));
    expect(cartNames).not.toContain('cancel_cart');
    expect(cartNames).not.toContain('create_checkout');
    expect(cartNames).not.toContain('complete_checkout');

    const checkoutList = await rpc('tools/list', undefined, 'checkout-tools', shopifyCheckoutBasicEnv);
    const checkoutNames = ((getResult(checkoutList.body).tools as ToolSummary[]).map((tool) => tool.name));
    expect(checkoutNames).toEqual(expect.arrayContaining(['create_checkout', 'get_checkout']));
    expect(checkoutNames).not.toContain('update_checkout');
    expect(checkoutNames).not.toContain('complete_checkout');
    expect(checkoutNames).not.toContain('cancel_checkout');
  });

  it('lists cancel_cart only for validated UCP cart endpoints', async () => {
    const ucpCartList = await rpc('tools/list', undefined, 'ucp-cart-tools', {
      ...shopifyCartEnv,
      SHOPIFY_CART_MCP_ENDPOINT: 'https://commonlands-camera-components.myshopify.com/api/ucp/mcp',
    });
    const ucpCartNames = ((getResult(ucpCartList.body).tools as ToolSummary[]).map((tool) => tool.name));
    expect(ucpCartNames).toEqual(expect.arrayContaining(['create_cart', 'get_cart', 'update_cart', 'cancel_cart']));
  });

  it('blocks commerce mutation tool calls unless explicitly enabled', async () => {
    const blocked = await rpc('tools/call', { name: 'create_cart', arguments: { lines: [] } });
    expect(blocked.body).toMatchObject({
      error: { code: -32601, message: 'Tool not found: create_cart' },
    });

    const extraCheckout = await rpc('tools/call', { name: 'complete_checkout', arguments: {} }, 'complete-disabled', shopifyCheckoutBasicEnv);
    expect(extraCheckout.body).toMatchObject({
      error: { code: -32601, message: 'Tool not found: complete_checkout' },
    });
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

  it('matches multi-word queries by token regardless of word order', async () => {
    // Phrase/substring matching used to miss this: the title is
    // "CIL350 M12 telephoto lens", so "telephoto M12" (words not adjacent in
    // that order) returned empty. Tokenized AND matching must find it.
    const { body } = await rpc('tools/call', {
      name: 'search_lenses',
      arguments: { query: 'telephoto M12', limit: 10 },
    });
    const results = getStructuredContent(body).results as LensSummary[];
    const skus = results.map((r) => r.sku);

    expect(results.length).toBeGreaterThan(0);
    expect(skus).toContain('CIL350');
    // Plain "M12" still matches the M12 lenses.
    const { body: m12 } = await rpc('tools/call', {
      name: 'search_lenses',
      arguments: { query: 'M12', limit: 10 },
    });
    expect((getStructuredContent(m12).results as LensSummary[]).length).toBeGreaterThan(0);
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
    expect(resources.map((resource) => resource.uri)).toContain('commonlands://server/connection');
    expect(resources.map((resource) => resource.uri)).toContain('commonlands://catalog/lenses');
    expect(resources.map((resource) => resource.uri)).toContain('commonlands://catalog/snapshot-status');
    expect(resources.map((resource) => resource.uri)).toContain('commonlands://compatibility/shopify-ucp');
    expect(resources.map((resource) => resource.uri)).toContain('commonlands://sensors/AR0234');
    expect(resources.map((resource) => resource.uri)).toContain('commonlands://lenses/CIL250');
    const resourceMetadataText = resources.map((resource) => `${resource.name ?? ''} ${resource.description ?? ''}`).join(' ');
    expect(resourceMetadataText).toMatch(/https:\/\/mcp\.commonlands\.com\/mcp/i);
    expect(resourceMetadataText).toMatch(/M12 lenses/i);
    expect(resourceMetadataText).toMatch(/C-mount lenses/i);
    expect(resourceMetadataText).toMatch(/lens field of view/i);

    const read = await rpc('resources/read', { uri: 'commonlands://catalog/lenses' });
    const readResult = getResult(read.body);
    const contents = readResult.contents as Array<JsonObject>;
    expect(contents[0]).toMatchObject({
      uri: 'commonlands://catalog/lenses',
      mimeType: 'application/json',
    });
    const parsed = JSON.parse(contents[0]?.text as string) as { lenses: LensSummary[] };
    expect(parsed.lenses.length).toBeGreaterThanOrEqual(5);

    const sensorRead = await rpc('resources/read', { uri: 'commonlands://sensors/AR0234' });
    const sensorContents = getResult(sensorRead.body).contents as Array<JsonObject>;
    const sensorParsed = JSON.parse(sensorContents[0]?.text as string) as JsonObject;
    expect(sensorParsed).toMatchObject({
      schemaVersion: 'commonlands.sensor_resource.v1',
      sensor: { partNumber: 'AR0234' },
    });

    const lensRead = await rpc('resources/read', { uri: 'commonlands://lenses/CIL250' });
    const lensContents = getResult(lensRead.body).contents as Array<JsonObject>;
    const lensParsed = JSON.parse(lensContents[0]?.text as string) as JsonObject;
    expect(lensParsed).toMatchObject({
      schemaVersion: 'commonlands.lens_resource.v1',
      lens: { sku: 'CIL250' },
      distortionProfile: {
        lens_sku: 'CIL250',
        distortion_status: 'source_display_only',
      },
    });
  });

  it('lists and returns the lens-selection MCP prompt', async () => {
    const listed = await rpc('prompts/list');
    const prompts = getResult(listed.body).prompts as Array<JsonObject>;
    expect(prompts.map((prompt) => prompt.name)).toContain('select_lens_for_sensor_fov_working_distance');
    const prompt = prompts.find((entry) => entry.name === 'select_lens_for_sensor_fov_working_distance') as JsonObject;
    expect(prompt.arguments).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'sensor', required: true }),
      expect.objectContaining({ name: 'target_fov', required: true }),
      expect.objectContaining({ name: 'working_distance', required: true }),
      expect.objectContaining({ name: 'mount', required: false }),
      expect.objectContaining({ name: 'constraints', required: false }),
    ]));

    const got = await rpc('prompts/get', {
      name: 'select_lens_for_sensor_fov_working_distance',
      arguments: {
        sensor: 'AR0234',
        target_fov: 'HFOV 60 deg',
        working_distance: '500 mm',
        mount: 'M12',
        constraints: 'low distortion, in stock',
      },
    });
    const result = getResult(got.body);
    const messages = result.messages as Array<JsonObject>;
    expect(messages[0]).toMatchObject({ role: 'user', content: { type: 'text' } });
    expect(JSON.stringify(messages[0])).toMatch(/calculate_field_of_view/);
    expect(JSON.stringify(messages[0])).toMatch(/match_lens_to_sensor/);
    expect(JSON.stringify(messages[0])).toMatch(/Do not use naive rectilinear fallback/i);
  });

  it('reports Shopify Storefront/UCP compatibility readiness without live connectors', async () => {
    const { body } = await rpc('tools/call', { name: 'get_shopify_ucp_readiness', arguments: {} });
    const structuredContent = getStructuredContent(body) as unknown as ShopifyUcpReadiness;

    expect(structuredContent).toMatchObject({
      schemaVersion: 'shopify.ucp_readiness.v1',
      compatibilityTarget: {
        shopifyStorefrontMcp: 'storefront-mcp',
        ucpCatalogVersion: '2026-04-08',
      },
      readiness: {
        status: 'catalog_fixture_ready_live_shopify_read_and_cart_proxy_configured_separately',
        liveConnectors: 'shopify_read_only_configured_separately',
        cartCheckout: 'cart_proxy_create_get_update_when_enabled_checkout_hidden',
        customerAccounts: 'not_implemented_requires_oauth_and_protected_customer_data',
      },
      ucpCatalog: {
        compatibleTools: ['search_catalog', 'lookup_catalog', 'get_product'],
        missingRequiredFields: [],
        productCount: 5,
        variantCount: 5,
      },
    });
    expect(structuredContent.differentiators).toContain('distortion-aware FoV and angular-resolution tools');
    expect(JSON.stringify(structuredContent)).not.toMatch(/docsend|shpat|shpss|xox|AKIA|signedUrl|accessToken/i);
  });

  it('reports sanitized Shopify read-only configuration status without exposing secrets', async () => {
    const { body } = await rpc(
      'tools/call',
      { name: 'get_shopify_readonly_config_status', arguments: {} },
      'shopify-readonly-status',
      shopifyReadonlyEnv,
    );
    const structuredContent = getStructuredContent(body);

    expect(structuredContent).toMatchObject({
      schemaVersion: 'shopify.readonly_config_status.v1',
      mode: 'read_only_configuration_check',
      credentialModel: 'shopify_dev_dashboard_client_credentials',
      configured: true,
      bindings: {
        clientId: 'present',
        clientSecret: 'present',
        shopDomain: 'present',
        scopes: 'present',
      },
      shopDomain: {
        configured: true,
        normalizedDomain: 'commonlands-store.myshopify.com',
        format: 'myshopify_domain',
      },
      safety: {
        readOnly: true,
        writesShopify: false,
        createsCart: false,
        createsCheckout: false,
        readsCustomers: false,
        readsOrders: false,
        mutatesInventory: false,
        touchesInventorySync: false,
        exposesSecrets: false,
      },
    });
    expect(structuredContent.scopes).toMatchObject({
      deniedMutationScopes: [],
      unapprovedScopes: [],
      missingApprovedReadScopes: [],
    });
    expect(JSON.stringify(getResult(body))).not.toMatch(/client-secret-test|client-id-test|shpat|shpss|accessToken/i);
  });

  it('keeps Shopify read-only config incomplete and safe when bindings are missing', async () => {
    const { body } = await rpc('tools/call', { name: 'get_shopify_readonly_config_status', arguments: {} });
    const structuredContent = getStructuredContent(body);

    expect(structuredContent).toMatchObject({
      configured: false,
      bindings: {
        clientId: 'missing',
        clientSecret: 'missing',
        shopDomain: 'missing',
        scopes: 'missing',
      },
      safety: {
        readOnly: true,
        writesShopify: false,
        mutatesInventory: false,
        exposesSecrets: false,
      },
    });
    expect(structuredContent.nextRequired).toContain('Add SHOPIFY_CLIENT_SECRET as a Cloudflare secret.');
  });

  it('flags Shopify mutation scopes as unsafe for the read-only adapter', async () => {
    const { body } = await rpc(
      'tools/call',
      { name: 'get_shopify_readonly_config_status', arguments: {} },
      'shopify-readonly-status-mutation',
      {
        ...shopifyReadonlyEnv,
        SHOPIFY_SCOPES: `${shopifyReadonlyEnv.SHOPIFY_SCOPES},write_products`,
      },
    );
    const structuredContent = getStructuredContent(body);

    expect(structuredContent).toMatchObject({
      configured: false,
      scopes: { deniedMutationScopes: ['write_products'] },
      safety: { readOnly: false, writesShopify: false },
    });
  });

  it('keeps live Shopify product reads safe when configuration is missing', async () => {
    const { body } = await rpc('tools/call', {
      name: 'read_shopify_products',
      arguments: { sku: 'CIL250', limit: 1 },
    });
    const structuredContent = getStructuredContent(body);

    expect(structuredContent).toMatchObject({
      schemaVersion: 'shopify.live_read.v1',
      mode: 'shopify_admin_graphql_read_only',
      configured: false,
      query: { kind: 'product_variants', sku: 'CIL250', limit: 1 },
      connector: { status: 'not_configured', source: 'not_connected' },
      products: [],
      safety: {
        readOnly: true,
        writesShopify: false,
        createsCart: false,
        createsCheckout: false,
        readsCustomers: false,
        readsOrders: false,
        mutatesInventory: false,
        touchesInventorySync: false,
        exposesSecrets: false,
      },
    });
    expect(JSON.stringify(getResult(body))).not.toMatch(/client-secret-test|client-id-test|shpat|shpss|accessToken|Authorization|Bearer/i);
  });

  it('falls back from exact SKU filter to safe text search when Shopify SKU indexing misses short part numbers', async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith('/admin/oauth/access_token')) {
        return Response.json({ access_token: 'shpat_fallback_token_never_return', expires_in: 86400, scope: shopifyReadonlyEnv.SHOPIFY_SCOPES });
      }
      if (url.endsWith('/admin/api/2026-04/graphql.json')) {
        const body = String(init?.body ?? '');
        calls.push(body);
        expect(body).toContain('productVariants');
        expect(body).not.toMatch(/mutation|customer|order/i);
        const variables = JSON.parse(body).variables as { query: string };
        if (variables.query === 'sku:CIL250') {
          return Response.json({ data: { productVariants: { nodes: [] } } });
        }
        expect(variables.query).toBe('CIL250');
        return Response.json({
          data: {
            productVariants: {
              nodes: [
                {
                  id: 'gid://shopify/ProductVariant/123',
                  sku: 'NOT-CIL250-SKU',
                  title: 'Default Title',
                  price: '34.00',
                  inventoryQuantity: 42,
                  inventoryItem: { id: 'gid://shopify/InventoryItem/456', tracked: true },
                  metafields: {
                    nodes: [
                      { namespace: 'mm-google-shopping', key: 'mpn', type: 'single_line_text_field', value: 'CIL250' },
                    ],
                  },
                  product: {
                    id: 'gid://shopify/Product/789',
                    handle: 'telephoto-25mm-m12-lens-cil250',
                    title: 'IR Corrected 25mm M12 Lens',
                    status: 'ACTIVE',
                    productType: 'Lens',
                    vendor: 'Commonlands',
                    tags: ['M12'],
                    onlineStoreUrl: 'https://commonlands.com/products/telephoto-25mm-m12-lens-cil250',
                    metafields: {
                      nodes: [
                        { namespace: 'custom', key: 'short_partnumber', type: 'single_line_text_field', value: 'CIL250' },
                      ],
                    },
                    media: { nodes: [] },
                  },
                },
              ],
            },
          },
        });
      }
      return new Response('unexpected fetch', { status: 500 });
    }) as typeof fetch;

    const { body } = await rpc(
      'tools/call',
      { name: 'read_shopify_products', arguments: { sku: 'CIL250', limit: 1, includeMetafields: true } },
      'read-shopify-products-sku-fallback',
      { ...shopifyReadonlyEnv, SHOPIFY_CLIENT_ID: 'client-id-fallback-test' },
    );
    const structuredContent = getStructuredContent(body);

    expect(structuredContent).toMatchObject({
      connector: {
        status: 'ok',
        source: 'live_shopify_admin_graphql',
        messages: [
          'Exact Shopify SKU search returned no results; retried as safe text search for short part number/MPN metafields.',
          'Shopify returned the requested limit of 1 variant record(s); results may be truncated. Retry with a higher limit (maximum 25) before treating the variant set as complete.',
        ],
      },
      products: [
        {
          handle: 'telephoto-25mm-m12-lens-cil250',
          title: 'IR Corrected 25mm M12 Lens',
          metafields: [{ namespace: 'custom', key: 'short_partnumber', valuePreview: 'CIL250' }],
          variants: [
            {
              sku: 'NOT-CIL250-SKU',
              // mm-google-shopping is not a public namespace: the Shopify-side
              // MPN text search still matches, but the metafield itself is
              // filtered out by the public allowlist.
              metafields: [],
              recommendedCreateCartPayload: {
                cart: {
                  line_items: [
                    { quantity: 1, item: { id: 'gid://shopify/ProductVariant/123' } },
                  ],
                },
              },
            },
          ],
        },
      ],
    });
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(getResult(body))).not.toMatch(/shpat_fallback_token_never_return|client-secret-test|client-id-fallback-test|Authorization|Bearer/i);
  });

  it('returns live product truth fields for arbitrary Shopify products without adding workflow tools', async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith('/admin/oauth/access_token')) {
        return Response.json({ access_token: 'shpat_live_truth_token_never_return', expires_in: 86400 });
      }
      if (url.endsWith('/admin/api/2026-04/graphql.json')) {
        return Response.json({
          data: {
            productVariants: {
              nodes: [
                shopifyProductVariantNode({
                  productId: 'gid://shopify/Product/1',
                  handle: 'arbitrary-product-a',
                  title: 'Arbitrary Product A',
                  sku: 'ABC123-F1.8-M12A650',
                  variantId: 'gid://shopify/ProductVariant/111',
                  price: '49.00',
                  inventoryQuantity: 10,
                  metafields: [metafield('custom', 'short_partnumber', 'single_line_text_field', 'ABC123')],
                }),
                shopifyProductVariantNode({
                  productId: 'gid://shopify/Product/2',
                  handle: 'arbitrary-product-b',
                  title: 'Arbitrary Product B',
                  sku: 'XYZ789-F4.0-C',
                  variantId: 'gid://shopify/ProductVariant/222',
                  price: '79.00',
                  inventoryQuantity: 0,
                  metafields: [metafield('custom', 'short_partnumber', 'single_line_text_field', 'XYZ789')],
                }),
              ],
            },
          },
        });
      }
      return new Response('unexpected fetch', { status: 500 });
    }) as typeof fetch;

    const { body } = await rpc(
      'tools/call',
      { name: 'read_shopify_products', arguments: { query: 'arbitrary', includeMetafields: true, limit: 5 } },
      'live-product-truth',
      { ...shopifyReadonlyEnv, SHOPIFY_CLIENT_ID: 'client-id-live-truth-test' },
    );
    const structuredContent = getStructuredContent(body);

    expect(structuredContent.source).toMatchObject({
      mode: 'live_shopify_admin_graphql_readonly',
      productTruth: true,
      readOnly: true,
      writesShopify: false,
      includesProducts: true,
      includesVariants: true,
      includesMetafields: true,
    });
    const products = structuredContent.products as JsonObject[];
    expect(products).toHaveLength(2);
    expect(products[0]).toMatchObject({
      id: 'gid://shopify/Product/1',
      numericId: '1',
      handle: 'arbitrary-product-a',
      productUrl: 'https://commonlands.com/products/arbitrary-product-a',
    });
    expect(products[0]?.variants).toEqual([
      expect.objectContaining({
        id: 'gid://shopify/ProductVariant/111',
        numericId: '111',
        sku: 'ABC123-F1.8-M12A650',
        price: '49.00',
        availability: 'in_stock',
        storefrontCartPath: '/cart/111:1',
        recommendedCreateCartPayload: {
          cart: {
            line_items: [
              { quantity: 1, item: { id: 'gid://shopify/ProductVariant/111' } },
            ],
          },
        },
      }),
    ]);
    expect(JSON.stringify(structuredContent)).not.toContain('recommend_live_shopify_lens_for_sensor');
    expect(JSON.stringify(getResult(body))).not.toMatch(/shpat_live_truth_token_never_return|client-secret-test|client-id-live-truth-test|Authorization|Bearer/i);
  });

  it('exchanges Shopify token and reads product variants without leaking credentials or mutating state', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      calls.push(init ? { url, init } : { url });
      if (url.endsWith('/admin/oauth/access_token')) {
        return Response.json({ access_token: 'shpat_test_token_never_return', expires_in: 86400, scope: shopifyReadonlyEnv.SHOPIFY_SCOPES });
      }
      if (url.endsWith('/admin/api/2026-04/graphql.json')) {
        const headers = new Headers(init?.headers);
        expect(headers.get('x-shopify-access-token')).toBe('shpat_test_token_never_return');
        expect(String(init?.body)).toContain('productVariants');
        expect(String(init?.body)).not.toMatch(/mutation|customer|order/i);
        return Response.json({
          data: {
            productVariants: {
              nodes: [
                {
                  id: 'gid://shopify/ProductVariant/123',
                  sku: 'CIL250',
                  title: 'Default Title',
                  price: '34.00',
                  inventoryQuantity: 42,
                  inventoryItem: { id: 'gid://shopify/InventoryItem/456', tracked: true },
                  metafields: { nodes: [] },
                  product: {
                    id: 'gid://shopify/Product/789',
                    handle: 'cil250',
                    title: 'CIL250 M12 lens',
                    status: 'ACTIVE',
                    productType: 'Lens',
                    vendor: 'Commonlands',
                    tags: ['M12'],
                    onlineStoreUrl: 'https://commonlands.com/products/cil250',
                    metafields: {
                      nodes: [
                        {
                          namespace: 'custom',
                          key: 'mechanical_drawing',
                          type: 'file_reference',
                          value: 'gid://shopify/GenericFile/111',
                          reference: { __typename: 'GenericFile', url: 'https://cdn.shopify.com/s/files/1/0624/5391/3805/files/CIL250.pdf' },
                        },
                      ],
                    },
                    media: {
                      nodes: [
                        {
                          mediaContentType: 'IMAGE',
                          alt: 'CIL250 lens',
                          preview: { image: { url: 'https://cdn.shopify.com/s/files/1/0624/5391/3805/files/CIL250.png', altText: 'CIL250 lens' } },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          },
        });
      }
      return new Response('unexpected fetch', { status: 500 });
    }) as typeof fetch;

    const { body } = await rpc(
      'tools/call',
      { name: 'read_shopify_products', arguments: { sku: 'CIL250', limit: 1 } },
      'read-shopify-products',
      shopifyReadonlyEnv,
    );
    const structuredContent = getStructuredContent(body);

    expect(structuredContent).toMatchObject({
      schemaVersion: 'shopify.live_read.v1',
      configured: true,
      query: { kind: 'product_variants', sku: 'CIL250', limit: 1 },
      shopify: { shopDomainFormat: 'myshopify_domain', apiVersion: '2026-04', token: 'exchanged_and_redacted' },
      connector: {
        status: 'ok',
        source: 'live_shopify_admin_graphql',
        messages: ['Shopify returned the requested limit of 1 variant record(s); results may be truncated. Retry with a higher limit (maximum 25) before treating the variant set as complete.'],
      },
      products: [
        {
          productId: 'gid://shopify/Product/789',
          handle: 'cil250',
          productUrl: 'https://commonlands.com/products/cil250',
          variants: [
            {
              variantId: 'gid://shopify/ProductVariant/123',
              sku: 'CIL250',
              availability: 'in_stock',
              recommendedCreateCartPayload: {
                cart: {
                  line_items: [
                    { quantity: 1, item: { id: 'gid://shopify/ProductVariant/123' } },
                  ],
                },
              },
            },
          ],
        },
      ],
      safety: { readOnly: true, writesShopify: false, mutatesInventory: false, exposesSecrets: false },
    });
    expect(calls.map((call) => call.url)).toEqual([
      'https://commonlands-store.myshopify.com/admin/oauth/access_token',
      'https://commonlands-store.myshopify.com/admin/api/2026-04/graphql.json',
    ]);
    expect(JSON.stringify(getResult(body))).not.toMatch(/shpat_test_token_never_return|client-secret-test|client-id-test|Authorization|Bearer/i);
  });

  it('reads Shopify products by handle through productByHandle without metafield connections', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      calls.push({ url, body: String(init?.body ?? '') });
      if (url.endsWith('/admin/oauth/access_token')) {
        return Response.json({ access_token: 'shpat_handle_token_never_return', expires_in: 86400 });
      }
      if (url.endsWith('/admin/api/2026-04/graphql.json')) {
        const body = String(init?.body);
        expect(body).toContain('productByHandle');
        expect(body).toContain('variants(first: $first)');
        expect(body).not.toContain('metafields(first: 0)');
        expect(body).not.toContain('product_handle');
        expect(body).not.toMatch(/mutation|customer|order/i);
        return Response.json({
          data: {
            productByHandle: {
              id: 'gid://shopify/Product/789',
              handle: 'cil250',
              title: 'CIL250 M12 lens',
              status: 'ACTIVE',
              productType: 'Lens',
              vendor: 'Commonlands',
              tags: ['M12'],
              onlineStoreUrl: 'https://commonlands.com/products/cil250',
              media: { nodes: [] },
              variants: {
                nodes: [
                  {
                    id: 'gid://shopify/ProductVariant/123',
                    sku: 'CIL250',
                    title: 'Default Title',
                    price: '34.00',
                    inventoryQuantity: 42,
                    inventoryItem: { id: 'gid://shopify/InventoryItem/456', tracked: true },
                  },
                ],
              },
            },
          },
        });
      }
      return new Response('unexpected fetch', { status: 500 });
    }) as typeof fetch;

    const { body } = await rpc(
      'tools/call',
      { name: 'read_shopify_products', arguments: { handle: 'cil250', limit: 1, includeMetafields: false } },
      'read-shopify-products-by-handle',
      { ...shopifyReadonlyEnv, SHOPIFY_CLIENT_ID: 'client-id-handle-test' },
    );
    const structuredContent = getStructuredContent(body);

    expect(structuredContent).toMatchObject({
      connector: {
        status: 'ok',
        source: 'live_shopify_admin_graphql',
        messages: ['Shopify returned the requested limit of 1 variant record(s); results may be truncated. Retry with a higher limit (maximum 25) before treating the variant set as complete.'],
      },
      products: [
        {
          handle: 'cil250',
          metafields: [],
          variants: [{ sku: 'CIL250', metafields: [] }],
        },
      ],
    });
    expect(calls.map((call) => call.url)).toEqual([
      'https://commonlands-store.myshopify.com/admin/oauth/access_token',
      'https://commonlands-store.myshopify.com/admin/api/2026-04/graphql.json',
    ]);
    expect(JSON.stringify(getResult(body))).not.toMatch(/shpat_handle_token_never_return|client-secret-test|client-id-handle-test|Authorization|Bearer/i);
  });

  it('returns sanitized Shopify errors without throwing worker failures', async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith('/admin/oauth/access_token')) {
        return Response.json({ access_token: 'shpat_error_token_never_return', expires_in: 86400 });
      }
      throw new Error('network down with client_secret=client-secret-test and shpat_error_token_never_return');
    }) as typeof fetch;

    const { response, body } = await rpc(
      'tools/call',
      { name: 'read_shopify_products', arguments: { sku: 'CIL250' } },
      'shopify-error-safe',
      { ...shopifyReadonlyEnv, SHOPIFY_CLIENT_ID: 'client-id-error-test' },
    );
    const structuredContent = getStructuredContent(body);

    expect(response.status).toBe(200);
    expect(structuredContent).toMatchObject({
      connector: { status: 'shopify_error', source: 'not_connected' },
      products: [],
      safety: { readOnly: true, writesShopify: false, exposesSecrets: false },
    });
    expect(JSON.stringify(getResult(body))).not.toMatch(/shpat_error_token_never_return|client-secret-test|client-id-error-test|Authorization|Bearer/i);
  });

  it('rejects read_shopify_metaobjects as removed from the public surface without calling Shopify', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('unexpected fetch', { status: 500 });
    }) as typeof fetch;

    const { body } = await rpc(
      'tools/call',
      { name: 'read_shopify_metaobjects', arguments: { type: 'lens_spec', handle: 'cil250', limit: 5 } },
      'read-shopify-metaobjects-removed',
      shopifyReadonlyEnv,
    );

    expect(called).toBe(false);
    const removalError = body.error as JsonObject;
    expect(removalError).toMatchObject({ code: -32601 });
    expect(String(removalError.message)).toContain('removed from the public surface');

    const { body: toolsBody } = await rpc('tools/list', {}, 'tools-list-after-metaobject-removal');
    const toolNames = ((getResult(toolsBody).tools as JsonObject[]) ?? []).map((tool) => tool.name);
    expect(toolNames).not.toContain('read_shopify_metaobjects');
  });

  it('filters non-public metafields and DRAFT products from read_shopify_products', async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith('/admin/oauth/access_token')) {
        return Response.json({ access_token: 'shpat_policy_token_never_return', expires_in: 86400 });
      }
      if (url.endsWith('/admin/api/2026-04/graphql.json')) {
        return Response.json({
          data: {
            productVariants: {
              nodes: [
                {
                  id: 'gid://shopify/ProductVariant/901',
                  sku: 'CIL250',
                  title: 'Default Title',
                  price: '34.00',
                  inventoryQuantity: 3,
                  inventoryItem: { tracked: true },
                  metafields: { nodes: [] },
                  product: {
                    id: 'gid://shopify/Product/901',
                    handle: 'cil250',
                    title: 'CIL250 M12 lens',
                    status: 'ACTIVE',
                    productType: 'Lens',
                    vendor: 'Commonlands',
                    tags: [],
                    onlineStoreUrl: 'https://commonlands.com/products/cil250',
                    metafields: {
                      nodes: [
                        { namespace: 'custom', key: 'efl', type: 'single_line_text_field', value: '25mm' },
                        { namespace: 'custom', key: 'docsend_page', type: 'url', value: 'https://docsend.com/view/private' },
                        { namespace: 'shopify--discovery--product_recommendation', key: 'related', type: 'list', value: 'internal' },
                        { namespace: 'mm-google-shopping', key: 'mpn', type: 'single_line_text_field', value: 'CIL250' },
                      ],
                    },
                    media: { nodes: [] },
                  },
                },
                {
                  id: 'gid://shopify/ProductVariant/902',
                  sku: 'PROTO-1',
                  title: 'Default Title',
                  price: '99.00',
                  inventoryQuantity: 50,
                  inventoryItem: { tracked: true },
                  metafields: { nodes: [] },
                  product: {
                    id: 'gid://shopify/Product/902',
                    handle: 'unreleased-prototype',
                    title: 'Unreleased prototype lens',
                    status: 'DRAFT',
                    productType: 'Lens',
                    vendor: 'Commonlands',
                    tags: [],
                    onlineStoreUrl: null,
                    metafields: { nodes: [] },
                    media: { nodes: [] },
                  },
                },
              ],
            },
          },
        });
      }
      return new Response('unexpected fetch', { status: 500 });
    }) as typeof fetch;

    const { body } = await rpc(
      'tools/call',
      { name: 'read_shopify_products', arguments: { query: 'lens', includeMetafields: true, limit: 5 } },
      'read-shopify-products-public-policy',
      { ...shopifyReadonlyEnv, SHOPIFY_CLIENT_ID: 'client-id-policy-test' },
    );
    const structuredContent = getStructuredContent(body);
    const products = structuredContent.products as JsonObject[];

    // DRAFT product is filtered out entirely.
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ handle: 'cil250' });
    expect(JSON.stringify(products)).not.toContain('unreleased-prototype');

    // Internal status never appears in output.
    expect(products[0]?.status).toBeUndefined();

    // Only the allowlisted public metafield survives; docsend and app
    // namespaces are dropped.
    expect(products[0]?.metafields).toEqual([
      expect.objectContaining({ namespace: 'custom', key: 'efl', valuePreview: '25mm' }),
    ]);
    expect(JSON.stringify(products)).not.toMatch(/docsend|mm-google-shopping|product_recommendation/);

    // Coarse availability only: low_stock at quantity 3, no raw counts.
    const variants = products[0]?.variants as JsonObject[];
    expect(variants[0]).toMatchObject({ sku: 'CIL250', availability: 'low_stock' });
    expect(JSON.stringify(variants)).not.toMatch(/inventoryQuantity|inventoryItemId/);
  });

  it('defaults read_shopify_products to metafields off', async () => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith('/admin/oauth/access_token')) {
        return Response.json({ access_token: 'shpat_default_token_never_return', expires_in: 86400 });
      }
      if (url.endsWith('/admin/api/2026-04/graphql.json')) {
        // With metafields off the query uses the empty __typename fragments.
        expect(String(init?.body)).not.toContain('metafields(first: 100)');
        return Response.json({ data: { productVariants: { nodes: [] } } });
      }
      return new Response('unexpected fetch', { status: 500 });
    }) as typeof fetch;

    const { body } = await rpc(
      'tools/call',
      { name: 'read_shopify_products', arguments: { sku: 'CIL250', limit: 1 } },
      'read-shopify-products-default-metafields-off',
      { ...shopifyReadonlyEnv, SHOPIFY_CLIENT_ID: 'client-id-default-test' },
    );
    const structuredContent = getStructuredContent(body);
    expect(structuredContent.source).toMatchObject({ includesMetafields: false });
  });

  it('returns 429 when the cart mutation rate limit is exceeded', async () => {
    const { response, body } = await rpc(
      'tools/call',
      { name: 'create_cart', arguments: { cart: { line_items: [{ quantity: 1, item: { id: 'gid://shopify/ProductVariant/1' } }] } } },
      'cart-rate-limited',
      {
        ...shopifyCartEnv,
        MCP_RATE_LIMITER: { limit: async () => ({ success: true }) },
        CART_RATE_LIMITER: { limit: async () => ({ success: false }) },
      } as Env,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    const rateError = body.error as JsonObject;
    expect(rateError).toMatchObject({ code: -32000 });
    expect(String(rateError.message)).toContain('cart_mutations');
  });

  it('returns 429 when the global request rate limit is exceeded', async () => {
    const { response, body } = await rpc(
      'tools/list',
      {},
      'global-rate-limited',
      { MCP_RATE_LIMITER: { limit: async () => ({ success: false }) } } as Env,
    );

    expect(response.status).toBe(429);
    const rateError = body.error as JsonObject;
    expect(String(rateError.message)).toContain('requests');
  });

  it('fails open when the rate limiter binding throws', async () => {
    const { response } = await rpc(
      'tools/list',
      {},
      'rate-limiter-fail-open',
      { MCP_RATE_LIMITER: { limit: async () => { throw new Error('limiter outage'); } } } as Env,
    );

    expect(response.status).toBe(200);
  });

  it('submit_rfq: routes to the contact page when SendGrid is not configured, without sending mail', async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response('unexpected', { status: 500 }); }) as typeof fetch;

    const { body } = await rpc(
      'tools/call',
      { name: 'submit_rfq', arguments: { message: 'Do you have a 6mm M12 lens for IMX477?', email: 'buyer@example.com' } },
      'rfq-not-configured',
      shopifyReadonlyEnv,
    );
    const structuredContent = getStructuredContent(body);

    expect(called).toBe(false);
    expect(structuredContent).toMatchObject({
      schemaVersion: 'commonlands.rfq.v1',
      configured: false,
      status: 'not_configured',
      handoff: { url: 'https://commonlands.com/pages/contact' },
    });
  });

  it('submit_rfq: validates message and email before doing anything', async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response('unexpected', { status: 500 }); }) as typeof fetch;

    const missing = getStructuredContent((await rpc('tools/call', { name: 'submit_rfq', arguments: { email: 'a@b.com' } }, 'rfq-no-msg', shopifyReadonlyEnv)).body);
    expect(missing).toMatchObject({ status: 'invalid_request' });
    expect(String(missing.message)).toContain('message is required');

    const badEmail = getStructuredContent((await rpc('tools/call', { name: 'submit_rfq', arguments: { message: 'hi', email: 'not-an-email' } }, 'rfq-bad-email', shopifyReadonlyEnv)).body);
    expect(badEmail).toMatchObject({ status: 'invalid_request' });
    expect(String(badEmail.message)).toContain('valid address');

    expect(called).toBe(false);
  });

  it('submit_rfq: sends via SendGrid to the fixed inbox and never leaks the API key', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      calls.push(init ? { url, init } : { url });
      expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
      return new Response(null, { status: 202 });
    }) as typeof fetch;

    const rfqEnv = {
      ...shopifyReadonlyEnv,
      SENDGRID_API_KEY: 'SG.secret_never_return',
      RFQ_TO_EMAIL: 'sales@commonlands.com',
      RFQ_FROM_EMAIL: 'mcp@commonlands.com',
      RFQ_FROM_NAME: 'Commonlands MCP',
    } as Env;

    const { body } = await rpc(
      'tools/call',
      {
        name: 'submit_rfq',
        arguments: {
          kind: 'rfq', message: 'Quote for 50 units on an IMX477 build.', email: 'buyer@example.com',
          name: 'Ada Buyer', company: 'RoboCo', partNumbers: ['CIL250', 'CIL078'], sensor: 'IMX477', quantity: 50,
        },
      },
      'rfq-submit',
      rfqEnv,
    );
    const structuredContent = getStructuredContent(body);

    expect(calls).toHaveLength(1);
    const payload = JSON.parse(String(calls[0]?.init?.body));
    expect(payload.personalizations[0].to[0].email).toBe('sales@commonlands.com'); // fixed recipient
    expect(payload.reply_to.email).toBe('buyer@example.com');
    expect(String((calls[0]?.init?.headers as Record<string, string>).authorization)).toContain('Bearer');
    expect(structuredContent).toMatchObject({ schemaVersion: 'commonlands.rfq.v1', configured: true, status: 'submitted' });
    expect(JSON.stringify(getResult(body))).not.toMatch(/SG\.secret_never_return/);
  });

  it('submit_rfq: accepts RFQ_TO/RFQ_FROM aliases and omits from.name when unset', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      calls.push(init ? { url, init } : { url });
      return new Response(null, { status: 202 });
    }) as typeof fetch;

    const { body } = await rpc(
      'tools/call',
      { name: 'submit_rfq', arguments: { message: 'Quote please', email: 'buyer@example.com' } },
      'rfq-alias-env',
      { ...shopifyReadonlyEnv, SENDGRID_API_KEY: 'SG.secret', RFQ_TO: 'sales@commonlands.com', RFQ_FROM: 'engineering@commonlands.com' } as Env,
    );

    expect(calls).toHaveLength(1);
    const payload = JSON.parse(String(calls[0]?.init?.body));
    expect(payload.personalizations[0].to[0].email).toBe('sales@commonlands.com');
    expect(payload.from.email).toBe('engineering@commonlands.com');
    expect(payload.from.name).toBeUndefined();
    expect(getStructuredContent(body)).toMatchObject({ configured: true, status: 'submitted' });
  });

  it('rejects unsafe Shopify read adapter params without calling Shopify', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('unexpected fetch', { status: 500 });
    }) as typeof fetch;

    const { body } = await rpc(
      'tools/call',
      { name: 'read_shopify_products', arguments: { sku: 'CIL250; mutation { productDelete }' } },
      'unsafe-shopify-read',
      shopifyReadonlyEnv,
    );
    const structuredContent = getStructuredContent(body);
    expect(structuredContent).toMatchObject({
      connector: { status: 'invalid_request' },
      products: [],
      safety: { readOnly: true, writesShopify: false },
    });
    expect(called).toBe(false);
  });

  it('keeps Shopify Cart UCP safe when configuration is missing', async () => {
    const { body } = await rpc('tools/call', {
      name: 'create_cart',
      arguments: {
        cart: {
          line_items: [{ quantity: 2, item: { id: 'gid://shopify/ProductVariant/12345678901' } }],
        },
      },
    }, 'cart-missing-config', { ...env, ENABLE_COMMERCE_MUTATION_TOOLS: 'true' });
    const structuredContent = getStructuredContent(body);

    expect(structuredContent).toMatchObject({
      schemaVersion: 'commonlands.cart_ucp.v1',
      mode: 'shopify_cart_mcp_proxy',
      configured: false,
      operation: 'create_cart',
      persistence: {
        storedIn: 'shopify_cart_mcp',
        mutatedBy: 'shopify_cart_mcp_tools',
        commonlandsWorkerState: 'stateless_proxy_no_cart_storage',
        resumeAcrossAgentSessions: 'caller_must_retain_cart_id_or_continue_url',
        expiryAuthority: 'shopify_cart_ttl_expires_at',
      },
      connector: { status: 'not_configured', source: 'not_connected' },
      cart: null,
      safety: {
        createsCart: true,
        createsCheckout: false,
        completesCheckout: false,
        createsOrder: false,
        readsCustomers: false,
        createsCustomer: false,
        mutatesInventory: false,
        touchesInventorySync: false,
        writesCatalog: false,
        exposesSecrets: false,
      },
    });
    expect(JSON.stringify(getResult(body))).not.toMatch(/shpat|shpss|accessToken|Authorization|Bearer/i);
  });

  it('proxies create_cart to Shopify Cart MCP and returns persistence contract without secrets', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      const body = String(init?.body ?? '');
      calls.push({ url, body });
      expect(url).toBe('https://commonlands.com/api/mcp');
      expect(body).toContain('update_cart');
      expect(body).toContain('gid://shopify/ProductVariant/12345678901');
      expect(body).not.toMatch(/checkout|order|customer|inventory|mutation/i);
      const payload = JSON.parse(body) as { params: { name: string; arguments: Record<string, unknown> } };
      expect(payload.params.name).toBe('update_cart');
      expect(payload.params.arguments).toEqual({
        add_items: [{ quantity: 2, product_variant_id: 'gid://shopify/ProductVariant/12345678901' }],
      });
      expect(payload.params.arguments).not.toHaveProperty('cart_id');
      return Response.json({
        jsonrpc: '2.0',
        id: 'commonlands-cart-ucp',
        result: {
          structuredContent: {
            cart: {
              ucp: { version: '2026-04-08', capabilities: { 'dev.ucp.shopping.cart': [{ version: '2026-04-08' }] } },
              id: 'gid://shopify/Cart/cart_abc123',
              currency: 'USD',
              line_items: [
                {
                  id: 'gid://shopify/CartLine/li_1?cart=cart_abc123',
                  item: { id: 'gid://shopify/ProductVariant/12345678901', title: 'IR Corrected 25mm M12 Lens', price: 3400 },
                  quantity: 2,
                },
              ],
              totals: [{ type: 'subtotal', amount: 6800, display_text: 'Subtotal' }],
              messages: [],
              continue_url: 'https://commonlands.com/cart/c/cart_abc123',
              expires_at: '2026-05-08T15:17:07Z',
            },
          },
        },
      });
    }) as typeof fetch;

    const { body } = await rpc(
      'tools/call',
      {
        name: 'create_cart',
        arguments: {
          cart: {
            line_items: [{ quantity: 2, item: { id: 'gid://shopify/ProductVariant/12345678901' } }],
            context: { address_country: 'US', address_region: 'CA', postal_code: '92101' },
          },
        },
      },
      'create-cart',
      shopifyCartEnv,
    );
    const structuredContent = getStructuredContent(body);

    expect(structuredContent).toMatchObject({
      configured: true,
      operation: 'create_cart',
      connector: { status: 'ok', source: 'shopify_cart_mcp', endpointHost: 'commonlands.com', messages: [] },
      cart: { id: 'gid://shopify/Cart/cart_abc123', continue_url: 'https://commonlands.com/cart/c/cart_abc123' },
      persistence: { resumeAcrossAgentSessions: 'caller_must_retain_cart_id_or_continue_url' },
      safety: { createsCart: true, createsCheckout: false, createsOrder: false, mutatesInventory: false, exposesSecrets: false },
    });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(getResult(body))).not.toMatch(/shpat|shpss|accessToken|Authorization|Bearer/i);
  });

  it('proxies get_cart and standard Storefront MCP add/change/remove cart updates', async () => {
    const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { params: { name: string; arguments: Record<string, unknown> } };
      toolCalls.push(body.params);
      return Response.json({
        result: {
          structuredContent: {
            cart: {
              id: body.params.arguments.cart_id ?? 'gid://shopify/Cart/cart_abc123',
              continue_url: 'https://commonlands.com/cart/c/cart_abc123',
              messages: [],
            },
          },
        },
      });
    }) as typeof fetch;

    const get = await rpc('tools/call', { name: 'get_cart', arguments: { id: 'gid://shopify/Cart/cart_abc123' } }, 'get-cart', shopifyCartEnv);
    const update = await rpc('tools/call', {
      name: 'update_cart',
      arguments: {
        id: 'gid://shopify/Cart/cart_abc123',
        cart: {
          line_items: [{ quantity: 3, item: { id: 'gid://shopify/ProductVariant/12345678901' } }],
          update_items: [{ id: 'gid://shopify/CartLine/li_1?cart=cart_abc123', quantity: 5 }],
          remove_line_ids: ['gid://shopify/CartLine/li_2?cart=cart_abc123'],
        },
      },
    }, 'update-cart', shopifyCartEnv);
    expect(toolCalls).toEqual([
      { name: 'get_cart', arguments: { cart_id: 'gid://shopify/Cart/cart_abc123' } },
      {
        name: 'update_cart',
        arguments: {
          cart_id: 'gid://shopify/Cart/cart_abc123',
          add_items: [{ quantity: 3, product_variant_id: 'gid://shopify/ProductVariant/12345678901' }],
          update_items: [{ id: 'gid://shopify/CartLine/li_1?cart=cart_abc123', quantity: 5 }],
          remove_line_ids: ['gid://shopify/CartLine/li_2?cart=cart_abc123'],
        },
      },
    ]);
    expect(getStructuredContent(get.body)).toMatchObject({ operation: 'get_cart', safety: { createsCart: false, updatesCart: false } });
    expect(getStructuredContent(update.body)).toMatchObject({ operation: 'update_cart', safety: { updatesCart: true, createsCheckout: false } });
  });

  it('keeps Shopify Cart UCP mode separate for future validated /api/ucp/mcp endpoints', async () => {
    const ucpEnv: Env = {
      ...shopifyCartEnv,
      SHOPIFY_CART_MCP_ENDPOINT: 'https://commonlands-camera-components.myshopify.com/api/ucp/mcp',
    };
    const calls: Array<{ url: string; body: string }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      const body = String(init?.body ?? '');
      calls.push({ url, body });
      const payload = JSON.parse(body) as { params: { name: string; arguments: Record<string, unknown> } };
      expect(url).toBe('https://commonlands-camera-components.myshopify.com/api/ucp/mcp');
      expect(payload.params.name).toBe('create_cart');
      expect(payload.params.arguments).toMatchObject({
        meta: { 'ucp-agent': { profile: 'https://mcp.commonlands.com/.well-known/ucp' } },
        cart: { line_items: [{ quantity: 1, item: { id: 'gid://shopify/ProductVariant/12345678901' } }] },
      });
      return Response.json({
        result: {
          content: [{ type: 'text', text: JSON.stringify({ cart: { id: 'gid://shopify/Cart/cart_ucp123', continue_url: 'https://commonlands.com/cart/c/cart_ucp123' } }) }],
        },
      });
    }) as typeof fetch;

    const result = await rpc('tools/call', {
      name: 'create_cart',
      arguments: {
        cart: { line_items: [{ quantity: 1, item: { id: 'gid://shopify/ProductVariant/12345678901' } }] },
      },
    }, 'create-cart-ucp-mode', ucpEnv);

    expect(calls).toHaveLength(1);
    expect(getStructuredContent(result.body)).toMatchObject({
      configured: true,
      connector: { status: 'ok', endpointHost: 'commonlands-camera-components.myshopify.com' },
      cart: { id: 'gid://shopify/Cart/cart_ucp123' },
    });
  });

  it('rejects unsafe Cart UCP requests before calling Shopify', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('unexpected fetch', { status: 500 });
    }) as typeof fetch;

    const withBuyer = await rpc('tools/call', {
      name: 'create_cart',
      arguments: {
        cart: {
          buyer: { email: 'buyer@example.com' },
          line_items: [{ quantity: 1, item: { id: 'gid://shopify/ProductVariant/12345678901' } }],
        },
      },
    }, 'unsafe-cart-buyer', shopifyCartEnv);
    expect(getStructuredContent(withBuyer.body)).toMatchObject({
      connector: { status: 'invalid_request', messages: ['Invalid params: buyer/customer fields are not enabled for Commonlands Cart MCP'] },
      safety: { readsCustomers: false, createsCustomer: false },
    });

    const badVariant = await rpc('tools/call', {
      name: 'create_cart',
      arguments: { cart: { line_items: [{ quantity: 1, item: { id: 'gid://shopify/Product/123' } }] } },
    }, 'unsafe-cart-variant', shopifyCartEnv);
    const badVariantContent = getStructuredContent(badVariant.body);
    expect(badVariantContent).toMatchObject({ connector: { status: 'invalid_request' } });
    expect((badVariantContent.connector as JsonObject).messages).toEqual([
      'Invalid params: cart.line_items[0].item.id must be a Shopify ProductVariant GID from read_shopify_products. Call read_shopify_products and use variantId; numeric IDs, storefront cart paths, and gid://commonlands/... fixture IDs are not accepted.',
    ]);

    const numericVariant = await rpc('tools/call', {
      name: 'create_cart',
      arguments: { cart: { line_items: [{ quantity: 1, item: { id: '41702699729014' } }] } },
    }, 'unsafe-cart-numeric-variant', shopifyCartEnv);
    expect((getStructuredContent(numericVariant.body).connector as JsonObject).messages).toEqual([
      'Invalid params: cart.line_items[0].item.id must be a Shopify ProductVariant GID from read_shopify_products. Call read_shopify_products and use variantId; numeric IDs, storefront cart paths, and gid://commonlands/... fixture IDs are not accepted.',
    ]);

    const fixtureVariant = await rpc('tools/call', {
      name: 'create_cart',
      arguments: { cart: { line_items: [{ quantity: 1, item: { id: 'gid://commonlands/ProductVariant/CIL250' } }] } },
    }, 'unsafe-cart-fixture-variant', shopifyCartEnv);
    expect((getStructuredContent(fixtureVariant.body).connector as JsonObject).messages).toEqual([
      'Invalid params: cart.line_items[0].item.id must be a Shopify ProductVariant GID from read_shopify_products. Call read_shopify_products and use variantId; numeric IDs, storefront cart paths, and gid://commonlands/... fixture IDs are not accepted.',
    ]);

    const badCancel = await rpc('tools/call', {
      name: 'cancel_cart',
      arguments: { id: 'gid://shopify/Cart/cart_abc123' },
    }, 'unsafe-cart-cancel', shopifyCartEnv);
    expect(badCancel.body.error).toMatchObject({ code: -32601, message: 'Tool not found: cancel_cart' });

    expect(called).toBe(false);
  });


  it('keeps Shopify Checkout MCP safe when configuration is missing', async () => {
    const { body } = await rpc('tools/call', {
      name: 'create_checkout',
      arguments: { checkout: { cart_id: 'gid://shopify/Cart/cart_abc123' } },
    }, 'checkout-missing-config', { ...env, ENABLE_CHECKOUT_MUTATION_TOOLS: 'true' });
    const structuredContent = getStructuredContent(body);

    expect(structuredContent).toMatchObject({
      schemaVersion: 'commonlands.checkout_mcp.v1',
      mode: 'shopify_checkout_mcp_proxy',
      configured: false,
      operation: 'create_checkout',
      persistence: {
        storedIn: 'shopify_checkout_mcp',
        mutatedBy: 'shopify_checkout_mcp_tools',
        commonlandsWorkerState: 'stateless_proxy_no_checkout_storage',
        resumeAcrossAgentSessions: 'caller_must_retain_checkout_id_or_checkout_url',
        expiryAuthority: 'shopify_checkout_ttl_expires_at',
      },
      connector: { status: 'not_configured', source: 'not_connected' },
      checkout: null,
      safety: {
        createsCheckout: true,
        completesCheckout: false,
        createsOrder: false,
        capturesPayment: false,
        readsCustomers: false,
        createsCustomer: false,
        mutatesInventory: false,
        touchesInventorySync: false,
        writesCatalog: false,
        exposesSecrets: false,
      },
    });
    expect(JSON.stringify(getResult(body))).not.toMatch(/shpat|shpss|accessToken|Authorization|Bearer/i);
  });

  it('proxies create_checkout to Shopify Checkout MCP without payment or order completion', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      const body = String(init?.body ?? '');
      calls.push({ url, body });
      expect(url).toBe('https://commonlands.com/api/ucp/mcp');
      expect(body).toContain('create_checkout');
      expect(body).toContain('gid://shopify/Cart/cart_abc123');
      expect(body).not.toMatch(/complete_checkout|payment|order|customer|inventory|mutation/i);
      const payload = JSON.parse(body) as { params: { arguments: { meta: Record<string, unknown>; checkout: Record<string, unknown> } } };
      expect(payload.params.arguments.meta).toMatchObject({
        'ucp-agent': { profile: 'https://mcp.commonlands.com/.well-known/ucp' },
      });
      expect(payload.params.arguments.checkout).toEqual({
        cart_id: 'gid://shopify/Cart/cart_abc123',
        context: { address_country: 'US', address_region: 'CA', postal_code: '92101' },
      });
      return Response.json({
        jsonrpc: '2.0',
        id: 'commonlands-checkout-mcp',
        result: {
          structuredContent: {
            checkout: {
              id: 'gid://shopify/Checkout/chk_abc123',
              checkout_url: 'https://commonlands.com/checkouts/cn/chk_abc123',
              status: 'open',
              accessToken: 'shpat_should_not_leak',
              totals: [{ type: 'subtotal', amount: 6800, display_text: 'Subtotal' }],
              expires_at: '2026-05-08T15:17:07Z',
            },
          },
        },
      });
    }) as typeof fetch;

    const { body } = await rpc('tools/call', {
      name: 'create_checkout',
      arguments: {
        checkout: {
          cart_id: 'gid://shopify/Cart/cart_abc123',
          context: { address_country: 'US', address_region: 'CA', postal_code: '92101' },
        },
      },
    }, 'create-checkout', shopifyCheckoutEnv);
    const structuredContent = getStructuredContent(body);

    expect(structuredContent).toMatchObject({
      configured: true,
      operation: 'create_checkout',
      connector: { status: 'ok', source: 'shopify_checkout_mcp', endpointHost: 'commonlands.com', messages: [] },
      checkout: { id: 'gid://shopify/Checkout/chk_abc123', checkout_url: 'https://commonlands.com/checkouts/cn/chk_abc123' },
      persistence: { resumeAcrossAgentSessions: 'caller_must_retain_checkout_id_or_checkout_url' },
      safety: { createsCheckout: true, completesCheckout: false, createsOrder: false, capturesPayment: false, mutatesInventory: false, exposesSecrets: false },
    });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(getResult(body))).not.toMatch(/shpat|shpss|accessToken|Authorization|Bearer/i);
  });

  it('proxies get_checkout, update_checkout, and cancel_checkout with Shopify-owned checkout persistence', async () => {
    const toolNames: string[] = [];
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { params: { name: string; arguments: Record<string, unknown> } };
      toolNames.push(body.params.name);
      if (body.params.name === 'update_checkout') {
        expect(body.params.arguments).toMatchObject({
          id: 'gid://shopify/Checkout/chk_abc123',
          checkout: { line_items: [{ quantity: 2, item: { id: 'gid://shopify/ProductVariant/12345678901' } }] },
        });
      }
      if (body.params.name === 'cancel_checkout') {
        expect(body.params.arguments.meta).toMatchObject({ 'idempotency-key': '660e8400-e29b-41d4-a716-446655440002' });
      }
      return Response.json({
        result: {
          structuredContent: {
            checkout: {
              id: body.params.arguments.id ?? 'gid://shopify/Checkout/chk_abc123',
              checkout_url: 'https://commonlands.com/checkouts/cn/chk_abc123',
              messages: body.params.name === 'cancel_checkout' ? [{ type: 'info', code: 'checkout_canceled', content: 'Checkout canceled' }] : [],
            },
          },
        },
      });
    }) as typeof fetch;

    const get = await rpc('tools/call', { name: 'get_checkout', arguments: { id: 'gid://shopify/Checkout/chk_abc123' } }, 'get-checkout', shopifyCheckoutEnv);
    const update = await rpc('tools/call', {
      name: 'update_checkout',
      arguments: {
        id: 'gid://shopify/Checkout/chk_abc123',
        checkout: { line_items: [{ quantity: 2, item: { id: 'gid://shopify/ProductVariant/12345678901' } }] },
      },
    }, 'update-checkout', shopifyCheckoutEnv);
    const cancel = await rpc('tools/call', {
      name: 'cancel_checkout',
      arguments: {
        id: 'gid://shopify/Checkout/chk_abc123',
        meta: { 'idempotency-key': '660e8400-e29b-41d4-a716-446655440002' },
      },
    }, 'cancel-checkout', shopifyCheckoutEnv);

    expect(toolNames).toEqual(['get_checkout', 'update_checkout', 'cancel_checkout']);
    expect(getStructuredContent(get.body)).toMatchObject({ operation: 'get_checkout', safety: { createsCheckout: false, updatesCheckout: false } });
    expect(getStructuredContent(update.body)).toMatchObject({ operation: 'update_checkout', safety: { updatesCheckout: true, completesCheckout: false } });
    expect(getStructuredContent(cancel.body)).toMatchObject({ operation: 'cancel_checkout', safety: { cancelsCheckout: true, createsOrder: false } });
  });


  it('proxies complete_checkout only after Shopify checkout authentication verifies buyer and payment details', async () => {
    const calls: Array<{ body: string }> = [];
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = String(init?.body ?? '');
      calls.push({ body });
      const payload = JSON.parse(body) as { params: { name: string; arguments: Record<string, unknown> } };
      expect(payload.params.name).toBe('complete_checkout');
      expect(payload.params.arguments).toMatchObject({
        id: 'gid://shopify/Checkout/chk_abc123',
        meta: { 'idempotency-key': '660e8400-e29b-41d4-a716-446655440003' },
        authentication: {
          method: 'shopify_checkout_authenticated',
          buyerVerified: true,
          paymentAuthorized: true,
          nameVerified: true,
          emailVerified: true,
          phoneVerified: true,
          addressVerified: true,
          cardAuthorized: true,
          authenticatedAt: '2026-05-02T20:15:00.000Z',
        },
      });
      expect(body).not.toMatch(/card_number|4111|cvv|cvc|customer/i);
      return Response.json({
        result: {
          structuredContent: {
            checkout: {
              id: 'gid://shopify/Checkout/chk_abc123',
              status: 'completed',
              order: { id: 'gid://shopify/Order/ord_123' },
              authorization: 'Bearer should_not_leak',
            },
          },
        },
      });
    }) as typeof fetch;

    const { body } = await rpc('tools/call', {
      name: 'complete_checkout',
      arguments: {
        id: 'gid://shopify/Checkout/chk_abc123',
        meta: { 'idempotency-key': '660e8400-e29b-41d4-a716-446655440003' },
        authentication: {
          method: 'shopify_checkout_authenticated',
          buyerVerified: true,
          paymentAuthorized: true,
          nameVerified: true,
          emailVerified: true,
          phoneVerified: true,
          addressVerified: true,
          cardAuthorized: true,
          authenticatedAt: '2026-05-02T20:15:00.000Z',
        },
      },
    }, 'complete-checkout', shopifyCheckoutEnv);

    expect(getStructuredContent(body)).toMatchObject({
      operation: 'complete_checkout',
      connector: { status: 'ok', source: 'shopify_checkout_mcp' },
      checkout: { id: 'gid://shopify/Checkout/chk_abc123', status: 'completed', order: { id: 'gid://shopify/Order/ord_123' } },
      safety: {
        completesCheckout: true,
        createsOrder: true,
        capturesPayment: true,
        readsCustomers: false,
        createsCustomer: false,
        mutatesInventory: false,
        writesCatalog: false,
        exposesSecrets: false,
      },
    });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(getResult(body))).not.toMatch(/shpat|shpss|accessToken|Authorization|Bearer/i);
  });

  it('rejects unsafe Checkout MCP requests before calling Shopify', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('unexpected fetch', { status: 500 });
    }) as typeof fetch;

    const withBuyer = await rpc('tools/call', {
      name: 'create_checkout',
      arguments: { checkout: { cart_id: 'gid://shopify/Cart/cart_abc123', buyer: { email: 'buyer@example.com' } } },
    }, 'unsafe-checkout-buyer', shopifyCheckoutEnv);
    expect(getStructuredContent(withBuyer.body)).toMatchObject({
      connector: { status: 'invalid_request', messages: ['Invalid params: buyer/customer/payment/address fields are not enabled for Commonlands Checkout MCP'] },
      safety: { readsCustomers: false, createsCustomer: false, completesCheckout: false, createsOrder: false },
    });

    const withPayment = await rpc('tools/call', {
      name: 'create_checkout',
      arguments: { checkout: { cart_id: 'gid://shopify/Cart/cart_abc123', payment: { token: 'tok_123' } } },
    }, 'unsafe-checkout-payment', shopifyCheckoutEnv);
    expect(getStructuredContent(withPayment.body)).toMatchObject({ connector: { status: 'invalid_request' } });

    const withDiscount = await rpc('tools/call', {
      name: 'create_checkout',
      arguments: { checkout: { cart_id: 'gid://shopify/Cart/cart_abc123', discount_codes: ['FREE'] } },
    }, 'unsafe-checkout-discount', shopifyCheckoutEnv);
    expect(getStructuredContent(withDiscount.body)).toMatchObject({
      connector: { status: 'invalid_request', messages: ['Invalid params: discount and gift-card fields are not enabled for Commonlands Checkout MCP'] },
    });

    const badCompleteMissingAuth = await rpc('tools/call', {
      name: 'complete_checkout',
      arguments: {
        id: 'gid://shopify/Checkout/chk_abc123',
        meta: { 'idempotency-key': '660e8400-e29b-41d4-a716-446655440004' },
      },
    }, 'unsafe-checkout-complete-missing-auth', shopifyCheckoutEnv);
    expect(getStructuredContent(badCompleteMissingAuth.body)).toMatchObject({
      connector: { status: 'invalid_request', messages: ['Invalid params: complete_checkout.authentication is required'] },
      safety: { completesCheckout: true, capturesPayment: true, readsCustomers: false },
    });

    const badCompleteRawCard = await rpc('tools/call', {
      name: 'complete_checkout',
      arguments: {
        id: 'gid://shopify/Checkout/chk_abc123',
        meta: { 'idempotency-key': '660e8400-e29b-41d4-a716-446655440004' },
        authentication: {
          method: 'shopify_checkout_authenticated',
          buyerVerified: true,
          paymentAuthorized: true,
          nameVerified: true,
          emailVerified: true,
          phoneVerified: true,
          addressVerified: true,
          cardAuthorized: true,
          authenticatedAt: '2026-05-02T20:15:00.000Z',
          card_number: '4111111111111111',
        },
      },
    }, 'unsafe-checkout-complete-raw-card', shopifyCheckoutEnv);
    expect(getStructuredContent(badCompleteRawCard.body)).toMatchObject({
      connector: { status: 'invalid_request', messages: ['Invalid params: complete_checkout.authentication only accepts Shopify verification flags, not payment or buyer data'] },
    });

    const badCancel = await rpc('tools/call', {
      name: 'cancel_checkout',
      arguments: { id: 'gid://shopify/Checkout/chk_abc123' },
    }, 'unsafe-checkout-cancel', shopifyCheckoutEnv);
    expect(getStructuredContent(badCancel.body)).toMatchObject({
      connector: { status: 'invalid_request', messages: ['Invalid params: cancel_checkout requires meta["idempotency-key"] for retry safety'] },
    });

    expect(called).toBe(false);
  });

  it('exposes Shopify/UCP readiness as a resource for launch planning', async () => {
    const listed = await rpc('resources/list');
    const listedResult = getResult(listed.body);
    const resources = listedResult.resources as ResourceSummary[];
    expect(resources.map((resource) => resource.uri)).toContain('commonlands://compatibility/shopify-ucp');

    const { body } = await rpc('resources/read', { uri: 'commonlands://compatibility/shopify-ucp' });
    const result = getResult(body);
    const contents = result.contents as Array<JsonObject>;
    const parsed = JSON.parse(contents[0]?.text as string) as ShopifyUcpReadiness;

    expect(contents[0]).toMatchObject({
      uri: 'commonlands://compatibility/shopify-ucp',
      mimeType: 'application/json',
    });
    expect(parsed.ucpCatalog.compatibleTools).toEqual(['search_catalog', 'lookup_catalog', 'get_product']);
    expect(parsed.readiness.liveConnectors).toBe('shopify_read_only_configured_separately');
    expect(parsed.readiness.cartCheckout).toBe('cart_proxy_create_get_update_when_enabled_checkout_hidden');
  });

  it('reports joined catalog snapshot status and validation without live connectors', async () => {
    const { body } = await rpc('tools/call', { name: 'get_catalog_snapshot_status', arguments: {} });
    const structuredContent = getStructuredContent(body) as unknown as CatalogSnapshotStatus;

    expect(structuredContent).toMatchObject({
      schemaVersion: 'catalog.snapshot_status.v1',
      counts: {
        lenses: 5,
        sensors: 3,
        joins: 5,
        missingCommerce: 0,
        missingOptical: 0,
        unsafeUrls: 0,
      },
      validation: { ok: true, errors: [] },
      sources: {
        optical: 'fixture:dynamodb-audit',
        commerce: 'fixture:shopify-products-sheet',
      },
      refresh: {
        mode: 'fixture_static',
        liveConnectors: 'not_connected',
      },
    });
    expect(structuredContent.generatedAt).toBe('2026-05-01T00:00:00.000Z');
    expect(JSON.stringify(structuredContent)).not.toMatch(/docsend|token|secret/i);
  });

  it('exposes snapshot status as a resource for agent planning', async () => {
    const { body } = await rpc('resources/read', { uri: 'commonlands://catalog/snapshot-status' });
    const result = getResult(body);
    const contents = result.contents as Array<JsonObject>;
    const parsed = JSON.parse(contents[0]?.text as string) as CatalogSnapshotStatus;

    expect(contents[0]).toMatchObject({
      uri: 'commonlands://catalog/snapshot-status',
      mimeType: 'application/json',
    });
    expect(parsed.validation.ok).toBe(true);
    expect(parsed.counts.joins).toBe(parsed.counts.lenses);
  });


  it('calls the authenticated live FoV backend when enabled and redacts coefficient fields', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      seenUrl = input.toString();
      seenInit = init;
      return Response.json({
        sensor: { partNumber: 'IMX477', hsize: 6.287, vsize: 4.712 },
        count: 1,
        lenses: [{ partNum: 'CIL026', alpha: 0.91, beta: 0.94, hfov: 120.3, vfov: 91.6, dfov: 130.4, distortion: '0.1%', efl: 2.6 }],
        errors: [{ partNum: 'CIL026', code: 'raw_backend_code', message: 'bad alpha beta secret detail' }],
      });
    }) as typeof fetch;

    const { body } = await rpc('tools/call', {
      name: 'compute_fov',
      arguments: { lensSku: 'CIL026', sensorPartNumber: 'IMX477', workingDistanceMm: 1000 },
    }, 'live-fov-test', {
      ...env,
      FOV_LIVE_BACKEND_ENABLED: 'true',
      FOV_LAMBDA_ENDPOINT: 'https://ia97wrz7ag.execute-api.us-west-2.amazonaws.com/default/fov',
      FOV_API_KEY: 'test-secret-never-return',
    });
    const structuredContent = getStructuredContent(body);

    expect(seenUrl).toBe('https://ia97wrz7ag.execute-api.us-west-2.amazonaws.com/default/fov');
    expect(seenInit?.method).toBe('POST');
    expect((seenInit?.headers as Record<string, string>)['x-api-key']).toBe('test-secret-never-return');
    expect(JSON.parse(seenInit?.body as string)).toMatchObject({
      sensor: { partNumber: 'IMX477', hsize: 6.287, vsize: 4.712 },
      partNums: ['CIL026'],
      workingDistanceMm: 1000,
    });
    expect(structuredContent).toMatchObject({
      schemaVersion: 'optics.fov.live.v1',
      correctionStatus: 'live_lambda_dynamodb',
      source: 'aws-lambda-dynamodb-readonly',
      requested: { lensSku: 'CIL026', sensorPartNumber: 'IMX477', workingDistanceMm: 1000 },
      provenance: {
        method: 'lambda_dynamodb_fov_backend',
        rev: 'lambda-dynamodb-fov-0.1.0',
        source: 'aws-lambda-dynamodb-readonly',
      },
      lenses: [{
        partNum: 'CIL026',
        hfov: 120.3,
        vfov: 91.6,
        dfov: 130.4,
        fov: {
          horizontalDeg: 120.3,
          verticalDeg: 91.6,
          diagonalDeg: 130.4,
        },
        efl: 2.6,
        coverageClass: 'unknown',
        coverage: {
          class: 'unknown',
          pixelCounts: {
            sensorPixels: expect.any(Number),
          },
        },
        provenance: {
          method: 'lambda_dynamodb_fov_backend',
          rev: 'lambda-dynamodb-fov-0.1.0',
          source: 'aws-lambda-dynamodb-readonly',
        },
        distortion: { display: '0.1%', status: 'source_display_only' },
        distortionAtFieldEdge: { display: '0.1%', status: 'source_display_only' },
      }],
    });
    expect(structuredContent.errors).toEqual([{ partNum: 'CIL026', message: 'backend_error' }]);
    const publicJson = JSON.stringify(structuredContent);
    expect(publicJson).not.toContain('test-secret-never-return');
    expect(publicJson).not.toContain('raw_backend_code');
    expect(publicJson).not.toContain('bad alpha beta secret detail');
    const lensesJson = JSON.stringify(structuredContent.lenses);
    expect(lensesJson).not.toContain('alpha');
    expect(lensesJson).not.toContain('beta');
  });

  it('wraps live calculate_field_of_view responses with required self-justifying fields', async () => {
    globalThis.fetch = (async () =>
      Response.json({
        sensor: { partNumber: 'IMX477', hsize: 6.287, vsize: 4.712, dsize: 7.857 },
        count: 1,
        lenses: [{ partNum: 'CIL026', alpha: 0.91, beta: 0.94, hfov: 120.3, vfov: 91.6, dfov: 130.4, distortion: '0.1%', efl: 2.6, image_circle: 6.6 }],
        errors: [],
      })) as typeof fetch;

    const { body } = await rpc('tools/call', {
      name: 'calculate_field_of_view',
      arguments: { lensSku: 'CIL026', sensor: 'IMX477', workingDistanceMm: 1000 },
    }, 'live-calculate-fov-test', {
      ...env,
      FOV_LIVE_BACKEND_ENABLED: 'true',
      FOV_LAMBDA_ENDPOINT: 'https://ia97wrz7ag.execute-api.us-west-2.amazonaws.com/default/fov',
      FOV_API_KEY: 'test-secret-never-return',
    });
    const structuredContent = getStructuredContent(body);

    expect(structuredContent).toMatchObject({
      schemaVersion: 'optics.calculate_field_of_view.v1',
      requested: { lensSku: 'CIL026', sensorPartNumber: 'IMX477', workingDistanceMm: 1000 },
      hfov_deg: 120.3,
      vfov_deg: 91.6,
      dfov_deg: 130.4,
      method: 'lambda_dynamodb_fov_backend',
      distortion_model: 'source_display_only_no_measured_polynomial_correction_claim',
      distortion_status: 'source_display_only',
      image_circle_mm: 6.6,
      sensor_diagonal_mm: 7.857,
      coverage_ok: false,
      rectilinear_comparison: {
        dfov_deg: expect.any(Number),
        delta_deg: expect.any(Number),
      },
      details: {
        schemaVersion: 'optics.fov.live.v1',
        lenses: [expect.objectContaining({
          partNum: 'CIL026',
          distortion: { display: '0.1%', status: 'source_display_only' },
        })],
      },
    });
    expect(JSON.stringify(structuredContent)).not.toContain('test-secret-never-return');
    expect(JSON.stringify(structuredContent)).not.toContain('alpha');
    expect(JSON.stringify(structuredContent)).not.toContain('beta');
  });

  it('computes live catalog FoV for a sensor and sends the catalog lens ids', async () => {
    let seenInit: RequestInit | undefined;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      seenInit = init;
      return Response.json({
        sensor: { partNumber: 'IMX477', hsize: 6.287, vsize: 4.712 },
        count: 251,
        lenses: [
          ...Array.from({ length: 250 }, (_, index) => ({
            partNum: `CIL${String(index).padStart(3, '0')}`,
            alpha: 0.9786,
            beta: 0.995,
            hfov: 88,
            vfov: 72,
            dfov: 101,
            distortion: '0% TV',
          })),
          { partNum: 'CIL999', alpha: 0.95, beta: 0.95, hfov: 4, vfov: 3, dfov: 4, distortion: '0.1%' },
        ],
        errors: [],
      });
    }) as typeof fetch;

    const { body } = await rpc('tools/call', {
      name: 'compute_fov_catalog',
      arguments: { sensorPartNumber: 'IMX477' },
    }, 'live-fov-catalog-test', {
      ...env,
      FOV_LIVE_BACKEND_ENABLED: 'true',
      FOV_LAMBDA_ENDPOINT: 'https://ia97wrz7ag.execute-api.us-west-2.amazonaws.com/default/fov',
      FOV_API_KEY: 'test-secret-never-return',
    });
    const requestBody = JSON.parse(seenInit?.body as string) as Record<string, unknown>;
    const structuredContent = getStructuredContent(body);

    // Catalog mode must send an explicit lens list so the backend never has to fall
    // back to a full-table scan (which it refuses with 400 missing_lenses). This is the
    // root cause of the prod 100%-error rate on compute_fov_catalog.
    expect(Array.isArray(requestBody.partNums)).toBe(true);
    expect((requestBody.partNums as unknown[]).length).toBeGreaterThan(0);
    expect(structuredContent).toMatchObject({
      schemaVersion: 'optics.fov.live.v1',
      requested: { sensorPartNumber: 'IMX477' },
      count: 250,
      backendCount: 251,
      resultLimit: 250,
      truncated: true,
      provenance: {
        method: 'lambda_dynamodb_fov_backend',
        rev: 'lambda-dynamodb-fov-0.1.0',
        source: 'aws-lambda-dynamodb-readonly',
      },
    });
    const lenses = structuredContent.lenses as Array<Record<string, unknown>>;
    expect(lenses).toHaveLength(250);
    expect(lenses[0]).toMatchObject({
      partNum: 'CIL000',
      hfov: 88,
      vfov: 72,
      dfov: 101,
      fov: {
        horizontalDeg: 88,
        verticalDeg: 72,
        diagonalDeg: 101,
      },
      coverageClass: 'unknown',
      coverage: {
        class: 'unknown',
        pixelCounts: {
          sensorPixels: expect.any(Number),
        },
      },
      provenance: {
        method: 'lambda_dynamodb_fov_backend',
        rev: 'lambda-dynamodb-fov-0.1.0',
        source: 'aws-lambda-dynamodb-readonly',
      },
      distortion: { display: '0% TV', status: 'source_display_only' },
      distortionAtFieldEdge: { display: '0% TV', status: 'source_display_only' },
    });
    expect(JSON.stringify(lenses)).not.toContain('CIL999');
    const lensesJson = JSON.stringify(lenses);
    expect(lensesJson).not.toContain('alpha');
    expect(lensesJson).not.toContain('beta');
  });

  it('returns fixture catalog FoV with per-lens coverage and provenance metadata', async () => {
    const { body } = await rpc('tools/call', {
      name: 'compute_fov_catalog',
      arguments: { sensorPartNumber: 'IMX477' },
    });
    const structuredContent = getStructuredContent(body);

    expect(structuredContent).toMatchObject({
      schemaVersion: 'optics.fov.catalog.fixture.v1',
      correctionStatus: 'fixture_parity_scaffold',
      source: 'fixture-catalog',
      provenance: {
        method: 'fixture_parity_scaffold',
        rev: 'fixture-polynomial-fov-0.1.0',
        source: 'fixture-catalog',
      },
    });

    const lenses = structuredContent.lenses as Array<Record<string, unknown>>;
    expect(lenses[0]).toMatchObject({
      fov: {
        horizontalDeg: expect.any(Number),
        verticalDeg: expect.any(Number),
        diagonalDeg: expect.any(Number),
      },
      coverageClass: expect.stringMatching(/full|inscribed/),
      coverage: {
        class: expect.stringMatching(/full|inscribed/),
        pixelCounts: {
          sensorPixels: expect.any(Number),
          coveredPixels: expect.any(Number),
          croppedPixels: expect.any(Number),
        },
      },
      provenance: {
        method: 'fixture_parity_scaffold',
        rev: 'fixture-polynomial-fov-0.1.0',
        source: 'fixture-catalog',
      },
      distortionAtFieldEdge: {
        status: 'source_display_only',
      },
    });
  });

  it('fails closed when live FoV backend auth is missing', async () => {
    const { body } = await rpc('tools/call', {
      name: 'compute_fov',
      arguments: { lensSku: 'CIL250', sensorPartNumber: 'IMX477' },
    }, 'missing-fov-auth-test', {
      ...env,
      FOV_LIVE_BACKEND_ENABLED: 'true',
      FOV_LAMBDA_ENDPOINT: 'https://ia97wrz7ag.execute-api.us-west-2.amazonaws.com/default/fov',
    });

    expect(body).toMatchObject({
      error: { code: -32603, message: 'Live FoV backend is missing authentication configuration' },
    });
  });

  const liveRankingEnv: Env = {
    ...env,
    FOV_LIVE_BACKEND_ENABLED: 'true',
    FOV_LAMBDA_ENDPOINT: 'https://ia97wrz7ag.execute-api.us-west-2.amazonaws.com/default/fov',
    FOV_API_KEY: '***',
  };

  const liveLambdaCatalog = {
    sensor: { partNumber: 'IMX477' },
    count: 2,
    lenses: [
      {
        partNum: 'CIL250',
        hfov: 14,
        vfov: 11,
        dfov: 18,
        efl: 25,
        image_circle: 9.4,
        lens_type: 'Telephoto',
        mount: 'M12',
        resolution: '10MP',
        f_num: 2,
        url: 'https://commonlands.com/products/ir-corrected-25mm-m12-lens-cil250',
      },
      {
        partNum: 'CIL078',
        hfov: 87,
        vfov: 70,
        dfov: 110,
        efl: 2.8,
        image_circle: 6.6,
        lens_type: 'Wide',
        mount: 'M12',
        resolution: '5MP',
        f_num: 2.4,
        url: 'https://commonlands.com/products/cil078',
      },
    ],
    errors: [],
  };

  it('ranks lenses from the LIVE backend specs, not the fixture', async () => {
    globalThis.fetch = (async () => Response.json(liveLambdaCatalog)) as typeof fetch;

    const { body } = await rpc(
      'tools/call',
      { name: 'match_lenses_to_sensor', arguments: { sensorPartNumber: 'IMX477', desiredHorizontalFovDeg: 14, maxResults: 5 } },
      'live-rank',
      liveRankingEnv,
    );
    const sc = getStructuredContent(body);

    expect(sc.correctionStatus).toBe('live_lambda_dynamodb_ranking');
    const recs = sc.recommendations as Array<JsonObject>;
    expect(recs.length).toBeGreaterThan(0);
    const top = recs[0] as JsonObject;
    // CIL250 is the 14-degree target match; its live EFL (25mm) must be reflected,
    // proving the data came from the live backend and not the fixture.
    expect((top.lens as JsonObject).sku).toBe('CIL250');
    expect((top.lens as JsonObject).eflMm).toBe(25);
    expect((top.lens as JsonObject).mount).toBe('M12');
    expect((top.fov as JsonObject).horizontalDeg).toBe(14);
    expect((top.lens as JsonObject).availability).toBe('unknown');
  });

  it('searches the LIVE catalog by lens type (telephoto returns all Telephoto lenses)', async () => {
    const typeCatalog = {
      sensor: { partNumber: 'IMX477' },
      count: 3,
      lenses: [
        { partNum: 'CIL250', hfov: 14, vfov: 11, dfov: 18, efl: 25, image_circle: 9.4, lens_type: 'Telephoto', mount: 'M12', resolution: '10MP', f_num: 2, url: 'https://commonlands.com/products/a' },
        { partNum: 'CIL900', hfov: 9, vfov: 7, dfov: 12, efl: 35, image_circle: 9, lens_type: 'Telephoto', mount: 'M12', resolution: '10MP', f_num: 2.4, url: 'https://commonlands.com/products/b' },
        { partNum: 'CIL078', hfov: 87, vfov: 70, dfov: 110, efl: 2.8, image_circle: 6.6, lens_type: 'Wide-Angle', mount: 'M12', resolution: '5MP', f_num: 2.4, url: 'https://commonlands.com/products/c' },
      ],
      errors: [],
    };
    globalThis.fetch = (async () => Response.json(typeCatalog)) as typeof fetch;

    const { body } = await rpc(
      'tools/call',
      { name: 'search_lenses', arguments: { query: 'telephoto', limit: 25 } },
      'live-search-type',
      liveRankingEnv,
    );
    const sc = getStructuredContent(body);
    expect(sc.source).toBe('live-lambda-dynamodb-lens-catalog');
    const skus = (sc.results as Array<JsonObject>).map((r) => r.sku);
    expect(skus).toEqual(['CIL250', 'CIL900']);
    expect(skus).not.toContain('CIL078');
  });

  it('compares lenses from LIVE data and errors on a SKU absent from the live catalog', async () => {
    globalThis.fetch = (async () => Response.json(liveLambdaCatalog)) as typeof fetch;

    const ok = await rpc(
      'tools/call',
      { name: 'compare_lenses', arguments: { lensSkus: ['CIL250', 'CIL078'], sensorPartNumber: 'IMX477' } },
      'live-compare',
      liveRankingEnv,
    );
    const recs = getStructuredContent(ok.body).recommendations as Array<JsonObject>;
    expect(recs.map((r) => (r.lens as JsonObject).sku).sort()).toEqual(['CIL078', 'CIL250']);
    expect(recs.find((r) => (r.lens as JsonObject).sku === 'CIL250')?.['lens']).toMatchObject({ eflMm: 25 });

    globalThis.fetch = (async () => Response.json(liveLambdaCatalog)) as typeof fetch;
    const missing = await rpc(
      'tools/call',
      { name: 'compare_lenses', arguments: { lensSkus: ['NOPE'], sensorPartNumber: 'IMX477' } },
      'live-compare-missing',
      liveRankingEnv,
    );
    expect(missing.body).toMatchObject({ error: { code: -32004, message: 'Lens not found: NOPE' } });
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
      imageCircle: { clipped: false, usedWidthMm: 6.287, usedHeightMm: 4.712 },
      coverageClass: 'full',
      coverage: {
        class: 'full',
        pixelCounts: {
          sensorPixels: expect.any(Number),
        },
      },
      fov: {
        horizontalDeg: 14.3,
        verticalDeg: 10.8,
        diagonalDeg: 17.9,
        sceneWidthMm: 250.9,
        sceneHeightMm: 189.1,
      },
      angularResolution: {
        horizontalPxPerDeg: 283.6,
        verticalPxPerDeg: 281.5,
      },
      distortionAtFieldEdge: {
        status: expect.stringMatching(/source_display_only|unavailable/),
      },
      provenance: {
        method: 'fixture_parity_scaffold',
        rev: 'fixture-polynomial-fov-0.1.0',
        source: 'fixture-catalog',
      },
    });
    expect(structuredContent.assumptions).toContain(
      'Uses fixture coefficients until real AppSync/DynamoDB projection data is connected.',
    );
    // CIL250 (25mm telephoto, 9.4mm image circle) fully covers the IMX477, so no
    // clipping warning; the fixture-scaffold warning is always present.
    expect((structuredContent.warnings as string[]).join(' ')).toMatch(/fixture-backed optics/i);
  });

  it('calculates field of view through the intent-named tool with snake_case inputs', async () => {
    const { body } = await rpc('tools/call', {
      name: 'calculate_field_of_view',
      arguments: { lens_sku: 'CIL250', sensor: 'IMX477', working_distance_mm: 1000 },
    });
    const structuredContent = getStructuredContent(body);

    expect(structuredContent).toMatchObject({
      schemaVersion: 'optics.calculate_field_of_view.v1',
      requested: { lensSku: 'CIL250', sensorPartNumber: 'IMX477', workingDistanceMm: 1000 },
      hfov_deg: 14.3,
      vfov_deg: 10.8,
      dfov_deg: 17.9,
      method: 'fixture_parity_scaffold',
      distortion_model: 'source_display_only_no_measured_polynomial_correction_claim',
      image_circle_mm: 9.4,
      sensor_diagonal_mm: 7.857,
      coverage_ok: true,
      rectilinear_comparison: {
        dfov_deg: expect.any(Number),
        delta_deg: expect.any(Number),
      },
      commonlands_data: {
        source: 'fixture-catalog',
      },
      details: {
        schemaVersion: 'optics.fov.v1',
        fov: {
          horizontalDeg: 14.3,
          verticalDeg: 10.8,
          diagonalDeg: 17.9,
        },
      },
    });
    expect((structuredContent.rectilinear_comparison as JsonObject).dfov_deg).toBeCloseTo(17.86, 3);
    expect(JSON.stringify(structuredContent)).toMatch(/not model-computed catalog interpolation/i);
  });

  it('marks focal-length-only calculate_field_of_view as a rectilinear reference, not Commonlands lens truth', async () => {
    const { body } = await rpc('tools/call', {
      name: 'calculate_field_of_view',
      arguments: { focal_length_mm: 25, sensorPartNumber: 'IMX477' },
    });
    const structuredContent = getStructuredContent(body);

    expect(structuredContent).toMatchObject({
      schemaVersion: 'optics.calculate_field_of_view.v1',
      method: 'rectilinear_reference_from_user_focal_length_only_no_commonlands_lens_sku',
      distortion_model: 'none_user_focal_length_only_not_commonlands_lens_data',
      distortion_status: 'unavailable',
      image_circle_mm: null,
      coverage_ok: null,
      rectilinear_comparison: {
        dfov_deg: expect.any(Number),
        delta_deg: 0,
      },
    });
    expect((structuredContent.warnings as string[]).join(' ')).toMatch(/must not be presented as Commonlands distortion-corrected/i);
  });

  it('keeps legacy optics calls working while routing public names to the same catalog logic', async () => {
    const search = await rpc('tools/call', {
      name: 'search_lens_catalog',
      arguments: { query: 'telephoto M12', limit: 10 },
    });
    const searchResults = getStructuredContent(search.body).results as LensSummary[];
    expect(searchResults.map((result) => result.sku)).toContain('CIL350');

    const legacySearch = await rpc('tools/call', {
      name: 'search_lenses',
      arguments: { query: 'telephoto M12', limit: 10 },
    });
    const legacyResults = getStructuredContent(legacySearch.body).results as LensSummary[];
    expect(legacyResults.map((result) => result.sku)).toEqual(searchResults.map((result) => result.sku));

    const match = await rpc('tools/call', {
      name: 'match_lens_to_sensor',
      arguments: { sensor: 'IMX477', desired_horizontal_fov_deg: 14, max_results: 3 },
    });
    const matchContent = getStructuredContent(match.body);
    expect(matchContent).toMatchObject({
      schemaVersion: 'recommendations.v1',
      sensor: { partNumber: 'IMX477' },
    });
    expect((matchContent.recommendations as Array<JsonObject>).length).toBeGreaterThan(0);

    const distortion = await rpc('tools/call', {
      name: 'get_lens_distortion_profile',
      arguments: { lens_sku: 'CIL250' },
    });
    expect(getStructuredContent(distortion.body)).toMatchObject({
      schemaVersion: 'optics.distortion_profile.v1',
      lensSku: 'CIL250',
      profile: {
        lens_sku: 'CIL250',
        distortion_status: 'source_display_only',
        correction_status: 'fixture_catalog_profile_not_measured_backend_correction',
      },
    });
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

  it('rejects unsafe compute_fov identifiers and unbounded working distances', async () => {
    const badSku = await rpc('tools/call', {
      name: 'compute_fov',
      arguments: { lensSku: '../CIL250', sensorPartNumber: 'IMX477' },
    });
    expect(badSku.body).toMatchObject({ error: { code: -32602, message: 'Invalid params: lensSku must match /^[A-Z0-9-]{2,32}$/' } });

    const hugeDistance = await rpc('tools/call', {
      name: 'compute_fov',
      arguments: { lensSku: 'CIL250', sensorPartNumber: 'IMX477', workingDistanceMm: 100001 },
    });
    expect(hugeDistance.body).toMatchObject({ error: { code: -32602, message: 'Invalid params: workingDistanceMm must be between 1 and 100000' } });
  });

  it('rejects invalid FoV params without throwing', async () => {
    const missingLens = await rpc('tools/call', {
      name: 'compute_fov',
      arguments: { lensSku: 'NOPE', sensorPartNumber: 'IMX477' },
    });
    expect(missingLens.body).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32004, message: 'Lens not found' },
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
      // Narrow telephoto target so the ranked set is dominated by the tighter
      // lenses (corrected CIL250 is 25mm / ~14° HFOV).
      arguments: { sensorPartNumber: 'IMX477', desiredHorizontalFovDeg: 15, maxResults: 3 },
    });
    const structuredContent = getStructuredContent(body);
    const recommendations = structuredContent.recommendations as Array<JsonObject>;

    expect(structuredContent).toMatchObject({
      schemaVersion: 'recommendations.v1',
      correctionStatus: 'fixture_recommendation_scaffold',
      sensor: { partNumber: 'IMX477' },
    });
    expect(recommendations).toHaveLength(3);
    // Deterministic ranking: results are ordered rank 1..3 ascending, and the
    // narrow-FoV target surfaces the telephoto CIL250 in the ranked set.
    expect(recommendations.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(recommendations.map((r) => (r.lens as JsonObject).sku)).toContain('CIL250');
    expect(JSON.stringify(structuredContent)).not.toMatch(/docsend/i);
  });

  it('marks fixture-backed recommendation outputs as unsafe for purchasable product truth', async () => {
    const { body } = await rpc('tools/call', {
      name: 'match_lenses_to_sensor',
      arguments: { sensorPartNumber: 'IMX477', desiredHorizontalFovDeg: 60, mount: 'M12', maxResults: 3 },
    });
    const structuredContent = getStructuredContent(body);

    expect(structuredContent.correctionStatus).toBe('fixture_recommendation_scaffold');
    expect(structuredContent.sourceWarning).toMatchObject({
      severity: 'danger',
      code: 'fixture_not_product_truth',
    });
    expect(JSON.stringify(structuredContent)).toContain('read_shopify_products');
    expect(JSON.stringify(structuredContent)).toContain('price');
    expect(JSON.stringify(structuredContent)).toContain('availability');
    expect(JSON.stringify(structuredContent)).toContain('variant');
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
    expect((structuredContent.assumptions as string[]).join(' ')).toContain('Use read_shopify_products for live purchasable product truth');
    expect((structuredContent.assumptions as string[]).join(' ')).toContain('price');
    expect((structuredContent.assumptions as string[]).join(' ')).toContain('variant IDs');
  });


  it('returns safe product page details with DynamoDB-sourced resolution metadata', async () => {
    const { body } = await rpc('tools/call', {
      name: 'get_product_page_details',
      arguments: { sku: 'CIL250' },
    });
    const structuredContent = getStructuredContent(body);

    expect(structuredContent).toMatchObject({
      schemaVersion: 'product_page.v1',
      correctionStatus: 'fixture_commerce_handoff',
      product: {
        sku: 'CIL250',
        handle: 'cil250',
        productUrl: 'https://commonlands.com/products/cil250',
        availability: 'in_stock',
      },
      technicalSpecifications: {
        eflMm: 25,
        fNumber: 2.4,
        imageCircleMm: 9.4,
        maxFovDeg: 72,
        resolution: { value: '10MP', source: 'fixture:dynamodb-audit' },
      },
      safety: {
        datasheetAccess: 'gated',
        liveConnectors: 'not_connected',
      },
    });
    expect(JSON.stringify(structuredContent)).not.toMatch(/docsend/i);
  });

  it('rejects missing product page detail SKUs with a useful error', async () => {
    const { body } = await rpc('tools/call', {
      name: 'get_product_page_details',
      arguments: { sku: 'NOPE' },
    });

    expect(body).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32004, message: 'Lens not found: NOPE' },
    });
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

  it('acknowledges notifications/initialized with 202 and no response body', async () => {
    const response = await fetchWorker('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  it('treats any id-less request as a notification rather than method-not-found', async () => {
    const response = await fetchWorker('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: {} }),
    });

    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  it('records accepted notifications as ok telemetry, not an error code', async () => {
    const writes: Array<{ blobs?: string[]; doubles?: number[]; indexes?: string[] }> = [];
    const requestEnv: Env = {
      ...env,
      MCP_ANALYTICS: {
        writeDataPoint(dataPoint) {
          writes.push(dataPoint);
        },
      },
    };

    const response = await fetchWorker('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }, requestEnv);

    expect(response.status).toBe(202);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.blobs?.[2]).toBe('notifications/initialized');
    expect(writes[0]?.blobs?.[4]).toBe('ok');
  });

  it('returns an actionable error with available sensors when a sensor is not found', async () => {
    const { body } = await rpc('tools/call', {
      name: 'get_sensor_specs',
      arguments: { partNumber: 'IMX577' },
    });

    expect(body).toMatchObject({
      jsonrpc: '2.0',
      error: {
        code: -32004,
        message: 'Sensor not found: IMX577',
      },
    });

    const data = (body.error as JsonObject).data as JsonObject;
    expect(Array.isArray(data.availableSensorPartNumbers)).toBe(true);
    expect(data.availableSensorPartNumbers).toContain('IMX477');
    expect(data.requestedPartNumber).toBe('IMX577');
  });

  it('sends fixture lens ids in catalog mode when the backend scan is not enabled', async () => {
    const liveEnv: Env = {
      ...env,
      FOV_LIVE_BACKEND_ENABLED: 'true',
      FOV_LAMBDA_ENDPOINT: 'https://ia97wrz7ag.execute-api.us-west-2.amazonaws.com/default/fov',
      FOV_API_KEY: '***',
    };

    let capturedBody: JsonObject | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as JsonObject;
      return new Response(
        JSON.stringify({ sensor: { partNumber: 'IMX477' }, count: 0, lenses: [], errors: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      await rpc(
        'tools/call',
        { name: 'compute_fov_catalog', arguments: { sensorPartNumber: 'IMX477' } },
        'live-fov-catalog',
        liveEnv,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    const partNums = capturedBody?.partNums as unknown[];
    expect(Array.isArray(partNums)).toBe(true);
    expect(partNums.length).toBeGreaterThan(0);
  });

  it('omits partNums in catalog mode when the backend scans the full lens table', async () => {
    const liveEnv: Env = {
      ...env,
      FOV_LIVE_BACKEND_ENABLED: 'true',
      FOV_BACKEND_SCANS_FULL_CATALOG: 'true',
      FOV_LAMBDA_ENDPOINT: 'https://ia97wrz7ag.execute-api.us-west-2.amazonaws.com/default/fov',
      FOV_API_KEY: '***',
    };

    let capturedBody: JsonObject | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as JsonObject;
      return new Response(
        JSON.stringify({ sensor: { partNumber: 'IMX477' }, count: 0, lenses: [], errors: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      await rpc(
        'tools/call',
        { name: 'compute_fov_catalog', arguments: { sensorPartNumber: 'IMX477' } },
        'live-fov-catalog-scan',
        liveEnv,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    // Single-lens mode is unaffected; only catalog mode defers to the backend scan.
    expect(capturedBody?.partNums).toBeUndefined();
  });

  it('surfaces the upstream HTTP status when the live FoV backend rejects a request', async () => {
    const liveEnv: Env = {
      ...env,
      FOV_LIVE_BACKEND_ENABLED: 'true',
      FOV_LAMBDA_ENDPOINT: 'https://ia97wrz7ag.execute-api.us-west-2.amazonaws.com/default/fov',
      FOV_API_KEY: 'wrong-key',
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    try {
      const { body } = await rpc(
        'tools/call',
        { name: 'compute_fov_catalog', arguments: { sensorPartNumber: 'IMX477' } },
        'live-fov-reject',
        liveEnv,
      );

      expect(body).toMatchObject({
        jsonrpc: '2.0',
        error: { code: -32001 },
      });
      expect((body.error as JsonObject).message).toMatch(/authentication failed/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('surfaces the upstream HTTP status even when the live FoV backend rejection is not JSON', async () => {
    const liveEnv: Env = {
      ...env,
      FOV_LIVE_BACKEND_ENABLED: 'true',
      FOV_LAMBDA_ENDPOINT: 'https://ia97wrz7ag.execute-api.us-west-2.amazonaws.com/default/fov',
      FOV_API_KEY: 'wrong-key',
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('Bad gateway', {
        status: 502,
        headers: { 'content-type': 'text/plain' },
      })) as typeof fetch;

    try {
      const { body } = await rpc(
        'tools/call',
        { name: 'compute_fov_catalog', arguments: { sensorPartNumber: 'IMX477' } },
        'live-fov-non-json-reject',
        liveEnv,
      );

      expect(body).toMatchObject({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          data: {
            upstreamStatus: 502,
            stage: 'live_fov_backend_response',
          },
        },
      });
      expect((body.error as JsonObject).message).toContain('upstream HTTP 502');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects oversized MCP request bodies before parsing JSON', async () => {
    const response = await fetchWorker('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'oversized', method: 'tools/list', padding: 'x'.repeat(70000) }),
    });
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body).toEqual({ error: 'payload_too_large' });
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

  it('serves a UCP discovery profile that advertises catalog and cart discovery only', async () => {
    const response = await fetchWorker('/.well-known/ucp');
    const profile = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(profile).toMatchObject({
      version: '2026-04-08',
      transport: 'mcp',
      endpoint: 'https://mcp.commonlands.com/mcp',
      capabilities: [
        'dev.ucp.shopping.catalog.search',
        'dev.ucp.shopping.catalog.lookup',
        'dev.ucp.shopping.cart',
      ],
    });
    expect(profile).toMatchObject({
      metadata: {
        cartPersistence: 'shopify_owned_when_cart_tools_exposed',
        cartBoundary: 'tools_list_is_authoritative_create_get_update_cart_only_when_enabled_cancel_checkout_hidden_currently',
      },
    });
    expect(JSON.stringify(profile)).not.toMatch(/order|customer/i);
  });

  it('exposes fixture-backed UCP catalog aliases without live Shopify connectors', async () => {
    const search = await rpc('tools/call', {
      name: 'search_catalog',
      arguments: { catalog: { query: 'CIL250' }, meta: { 'ucp-agent': 'vitest' } },
    });
    const searchContent = getStructuredContent(search.body) as unknown as UcpCatalogResult;

    expect(searchContent).toMatchObject({
      schemaVersion: 'ucp.catalog.v1',
      ucp: { version: '2026-04-08', capability: 'search_catalog', transport: 'mcp' },
      messages: [],
    });
    expect(searchContent.sourceWarning).toMatchObject({ severity: 'danger', code: 'fixture_not_product_truth' });
    expect(searchContent.catalog.products).toHaveLength(1);
    expect(searchContent.catalog.products[0]).toMatchObject({
      id: 'gid://commonlands/Product/CIL250',
      handle: 'cil250',
      variants: [{ id: 'gid://commonlands/ProductVariant/CIL250', sku: 'CIL250', price: { amount: 3400, currency: 'USD' } }],
    });
    expect(JSON.stringify(searchContent)).not.toMatch(/docsend|secret|shpat|signedUrl/i);

    const lookup = await rpc('tools/call', {
      name: 'lookup_catalog',
      arguments: { catalog: { ids: ['gid://commonlands/Product/CIL250', 'NOPE'] } },
    });
    const lookupContent = getStructuredContent(lookup.body) as unknown as UcpCatalogResult;
    expect(lookupContent.catalog.products).toHaveLength(1);
    expect(lookupContent.messages).toContainEqual(expect.objectContaining({ type: 'info', code: 'not_found' }));

    const detail = await rpc('tools/call', {
      name: 'get_product',
      arguments: { catalog: { id: 'gid://commonlands/ProductVariant/CIL250' } },
    });
    const detailContent = getStructuredContent(detail.body) as unknown as UcpCatalogResult;
    expect(detailContent.catalog.products[0]).toMatchObject({ metadata: { sku: 'CIL250', opticalSource: 'fixture:dynamodb-audit' } });
  });



  it('returns purchase route options for AI agents without mutating Shopify or Commonlands order state', async () => {
    const { body } = await rpc('tools/call', {
      name: 'get_purchase_route_options',
      arguments: {
        sku: 'CIL250',
        quantity: 2,
        sensorPartNumber: 'IMX477',
        buyerIntent: 'robotics prototype build',
        agentType: 'robotics_engineer_agent',
      },
    });
    const options = getStructuredContent(body) as unknown as PurchaseRouteOptions;

    expect(options).toMatchObject({
      schemaVersion: 'commerce.purchase_routes.v1',
      correctionStatus: 'fixture_dual_channel_transaction_plan_no_mutation',
      product: {
        sku: 'CIL250',
        productUrl: 'https://commonlands.com/products/cil250',
        variantId: 'gid://commonlands/ProductVariant/CIL250',
      },
      context: {
        buyerIntent: 'robotics prototype build',
        agentType: 'robotics_engineer_agent',
        sensorPartNumber: 'IMX477',
        quantity: 2,
      },
      transactionSafety: {
        createsCart: false,
        createsCheckout: false,
        writesShopify: false,
        writesCommonlandsOrder: false,
        requiresHumanApprovalBeforeMutation: true,
      },
    });
    expect(options.routes.map((route) => route.channel)).toEqual([
      'commonlands_mcp_dedicated_purchase',
      'shopify_native_checkout',
      'engineering_review_request',
    ]);
    expect(options.routes[0]).toMatchObject({
      status: 'planned_requires_approval_and_live_connectors',
      actions: {
        futureTool: 'create_commonlands_purchase_session',
        currentSafeAction: 'prepare_shopify_purchase_handoff',
      },
    });
    expect(options.routes[1]).toMatchObject({
      status: 'planned_requires_shopify_storefront_cart',
      actions: {
        futureTool: 'create_shopify_cart_or_checkout',
        currentSafeAction: 'open_product_url',
      },
    });
    expect(options.sourceWarning).toMatchObject({ severity: 'danger', code: 'fixture_not_product_truth' });
    expect(options.requiredBeforeLiveTransaction).toContain('configured SHOPIFY_CART_MCP_ENDPOINT or SHOPIFY_CHECKOUT_MCP_ENDPOINT; exposed tools safe-fail until configured');
    expect(options.requiredBeforeLiveTransaction).toContain('live Shopify ProductVariant GIDs resolved through read_shopify_products, not fixture Commonlands IDs');
    expect(JSON.stringify(options)).not.toMatch(/docsend|secret|shpat|signedUrl|accessToken/i);
  });

  it('rejects invalid purchase route option requests safely', async () => {
    const missingSku = await rpc('tools/call', {
      name: 'get_purchase_route_options',
      arguments: { quantity: 1 },
    });
    expect(missingSku.body).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32602, message: 'Invalid params: sku is required' },
    });

    const unknownSku = await rpc('tools/call', {
      name: 'get_purchase_route_options',
      arguments: { sku: 'NOPE' },
    });
    expect(unknownSku.body).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32004, message: 'Lens not found: NOPE' },
    });
  });

  it('prepares a Shopify-native purchase handoff without creating cart or checkout state', async () => {
    const { body } = await rpc('tools/call', {
      name: 'prepare_shopify_purchase_handoff',
      arguments: { sku: 'CIL250', quantity: 3, sensorPartNumber: 'IMX477' },
    });
    const handoff = getStructuredContent(body) as unknown as ShopifyPurchaseHandoff;

    expect(handoff).toMatchObject({
      schemaVersion: 'shopify.purchase_handoff.v1',
      correctionStatus: 'fixture_transaction_seam_no_mutation',
      quantity: 3,
      product: {
        sku: 'CIL250',
        productUrl: 'https://commonlands.com/products/cil250',
        variantId: 'gid://commonlands/ProductVariant/CIL250',
      },
      transaction: {
        mode: 'read_only_handoff',
        cartCheckout: 'not_created',
        createsCart: false,
        requiresApprovalBeforeLiveMutation: true,
      },
    });
    expect(handoff.sourceWarning).toMatchObject({ severity: 'danger', code: 'fixture_not_product_truth' });
    expect(handoff.product.selectedVariantIdSource).toBe('fixture_commonlands_gid_non_authoritative');
    expect(handoff.warnings.join(' ')).toContain('No Shopify cart or checkout was created');
    expect(handoff.warnings.join(' ')).toContain('read_shopify_products');
    expect(JSON.stringify(handoff)).not.toMatch(/docsend|secret|shpat|signedUrl/i);
  });

  it('signs DynamoDB requests with a deterministic SigV4 authorization header', async () => {
    const signed = await signDynamoRequest({
      region: 'us-west-2',
      credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secretkeyexample' },
      target: 'Scan',
      body: { TableName: 'SensorData' },
      now: new Date('2026-06-27T19:30:00.000Z'),
    });

    expect(signed.url).toBe('https://dynamodb.us-west-2.amazonaws.com/');
    expect(signed.headers['x-amz-target']).toBe('DynamoDB_20120810.Scan');
    expect(signed.headers['x-amz-date']).toBe('20260627T193000Z');
    expect(signed.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260627\/us-west-2\/dynamodb\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$/,
    );
    // Signing must be stable for identical inputs.
    const again = await signDynamoRequest({
      region: 'us-west-2',
      credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secretkeyexample' },
      target: 'Scan',
      body: { TableName: 'SensorData' },
      now: new Date('2026-06-27T19:30:00.000Z'),
    });
    expect(again.headers.authorization).toBe(signed.headers.authorization);
  });

  it('resolves get_sensor_specs from the live DynamoDB sensor table', async () => {
    const sensorEnv: Env = {
      ...env,
      SENSOR_DDB_TABLE: 'SensorData-orz4gwks4bef7engytv7spr2ha-dev',
      SENSOR_DDB_REGION: 'us-west-2',
      AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'secretkeyexample',
    };

    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Response.json({
        Items: [
          {
            id: { S: 'IMX577' },
            sensortype: { S: 'Rolling' },
            sensormfg: { S: 'Sony' },
            sensorhpix: { N: '4056' },
            sensorvpix: { N: '3040' },
            sensorpitch: { N: '1.55' },
          },
        ],
      });
    }) as typeof fetch;

    const { body } = await rpc(
      'tools/call',
      { name: 'get_sensor_specs', arguments: { partNumber: 'IMX577' } },
      'live-sensor',
      sensorEnv,
    );

    expect(calls[0]).toBe('https://dynamodb.us-west-2.amazonaws.com/');
    const structuredContent = getStructuredContent(body);
    expect(structuredContent.sensor).toMatchObject({
      partNumber: 'IMX577',
      manufacturer: 'Sony',
      resolution: { widthPx: 4056, heightPx: 3040 },
      pixelSizeUm: 1.55,
      shutterType: 'Rolling',
    });
    // Active-area mm derived from pixels * pitch.
    const sensor = structuredContent.sensor as { activeAreaMm: { width: number; height: number } };
    expect(sensor.activeAreaMm.width).toBeCloseTo(6.2868, 3);
    expect(sensor.activeAreaMm.height).toBeCloseTo(4.712, 3);
  });

  it('lists live sensor part numbers in the not-found error when the store is configured', async () => {
    const sensorEnv: Env = {
      ...env,
      SENSOR_DDB_TABLE: 'SensorData-orz4gwks4bef7engytv7spr2ha-dev',
      SENSOR_DDB_REGION: 'us-west-2',
      AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'secretkeyexample',
    };

    globalThis.fetch = (async () =>
      Response.json({
        Items: [
          { id: { S: 'IMX477' }, sensortype: { S: 'Rolling' }, sensormfg: { S: 'Sony' }, sensorhpix: { N: '4056' }, sensorvpix: { N: '3040' }, sensorpitch: { N: '1.55' } },
          { id: { S: 'AR0521' }, sensortype: { S: 'Global' }, sensormfg: { S: 'onsemi' }, sensorhpix: { N: '2592' }, sensorvpix: { N: '1944' }, sensorpitch: { N: '2.2' } },
        ],
      })) as typeof fetch;

    const { body } = await rpc(
      'tools/call',
      { name: 'get_sensor_specs', arguments: { partNumber: 'DOES-NOT-EXIST' } },
      'live-sensor-missing',
      sensorEnv,
    );

    expect(body).toMatchObject({ error: { code: -32004 } });
    const data = (body.error as JsonObject).data as JsonObject;
    expect(data.availableSensorPartNumbers).toEqual(['IMX477', 'AR0521']);
    expect(data.availableSensorPartNumbers).not.toContain('Rolling');
    expect(data.availableSensorPartNumbers).not.toContain('Global');
  });

  it('falls back to the fixture when the sensor store is not configured', async () => {
    const { body } = await rpc('tools/call', {
      name: 'get_sensor_specs',
      arguments: { partNumber: 'IMX477' },
    });
    expect(getStructuredContent(body).sensor).toMatchObject({ partNumber: 'IMX477' });
  });

});
