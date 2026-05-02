import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/index';

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
    'read_discovery,read_files,read_inventory,read_legal_policies,read_locations,read_marketing_integrated_campaigns,read_marketing_events,read_metaobject_definitions,read_metaobjects,read_online_store_navigation,read_online_store_pages,read_payment_terms,read_product_feeds,read_product_listings,read_products,read_shipping,read_content',
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


interface UcpCatalogResult {
  schemaVersion: string;
  ucp: { version: string; capability: string; transport: string };
  catalog: { products: Array<Record<string, unknown>> };
  messages: Array<{ type: string; code: string; text: string }>;
}

interface ShopifyPurchaseHandoff {
  schemaVersion: string;
  correctionStatus: string;
  quantity: number;
  product: { sku: string; productUrl: string; variantId: string };
  transaction: { mode: string; cartCheckout: string; createsCart: boolean; requiresApprovalBeforeLiveMutation: boolean };
  warnings: string[];
}

interface PurchaseRouteOptions {
  schemaVersion: string;
  correctionStatus: string;
  product: { sku: string; productUrl: string; variantId: string };
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
      'get_product_page_details',
      'get_catalog_snapshot_status',
      'get_shopify_ucp_readiness',
      'get_shopify_readonly_config_status',
      'search_catalog',
      'lookup_catalog',
      'get_product',
      'prepare_shopify_purchase_handoff',
      'get_purchase_route_options',
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
    expect(resources.map((resource) => resource.uri)).toContain('commonlands://catalog/snapshot-status');
    expect(resources.map((resource) => resource.uri)).toContain('commonlands://compatibility/shopify-ucp');

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
        status: 'fixture_ready_connector_blocked',
        liveConnectors: 'not_connected',
        cartCheckout: 'intentionally_not_implemented_read_only_mvp',
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
    expect(parsed.readiness.liveConnectors).toBe('not_connected');
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
        eflMm: 6,
        fNumber: 2.4,
        imageCircleMm: 7.2,
        maxFovDeg: 72,
        resolution: { value: '5MP', source: 'fixture:dynamodb-audit' },
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

  it('serves a UCP discovery profile that advertises catalog only', async () => {
    const response = await fetchWorker('/.well-known/ucp');
    const profile = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(profile).toMatchObject({
      version: '2026-04-08',
      transport: 'mcp',
      endpoint: 'https://mcp.commonlands.test/mcp',
      capabilities: ['dev.ucp.shopping.catalog.search', 'dev.ucp.shopping.catalog.lookup'],
    });
    expect(JSON.stringify(profile)).not.toMatch(/cart|checkout|order|customer/i);
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
    expect(options.requiredBeforeLiveTransaction).toContain('approved Shopify Storefront API cart/checkout credentials stored outside source control');
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
    expect(handoff.warnings.join(' ')).toContain('No Shopify cart or checkout was created');
    expect(JSON.stringify(handoff)).not.toMatch(/docsend|secret|shpat|signedUrl/i);
  });

});
