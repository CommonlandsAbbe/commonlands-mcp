import { afterEach, describe, expect, it } from 'vitest';
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

const shopifyCartEnv: Env = {
  ...shopifyReadonlyEnv,
  SHOPIFY_CART_MCP_ENDPOINT: 'https://commonlands.com/api/ucp/mcp',
  SHOPIFY_UCP_AGENT_PROFILE: 'https://commonlands-mcp.erp-14c.workers.dev/.well-known/ucp',
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
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
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
      'read_shopify_products',
      'read_shopify_metaobjects',
      'create_cart',
      'get_cart',
      'update_cart',
      'cancel_cart',
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
        status: 'catalog_fixture_ready_cart_proxy_configurable',
        liveConnectors: 'not_connected',
        cartCheckout: 'cart_ucp_proxy_enabled_checkout_not_enabled',
        customerAccounts: 'not_implemented_requires_oauth_and_protected_customer_data',
      },
      ucpCatalog: {
        compatibleTools: ['search_catalog', 'lookup_catalog', 'get_product', 'create_cart', 'get_cart', 'update_cart', 'cancel_cart'],
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
      { name: 'read_shopify_products', arguments: { sku: 'CIL250', limit: 1 } },
      'read-shopify-products-sku-fallback',
      { ...shopifyReadonlyEnv, SHOPIFY_CLIENT_ID: 'client-id-fallback-test' },
    );
    const structuredContent = getStructuredContent(body);

    expect(structuredContent).toMatchObject({
      connector: {
        status: 'ok',
        source: 'live_shopify_admin_graphql',
        messages: ['Exact Shopify SKU search returned no results; retried as safe text search for short part number/MPN metafields.'],
      },
      products: [
        {
          handle: 'telephoto-25mm-m12-lens-cil250',
          title: 'IR Corrected 25mm M12 Lens',
          metafields: [{ namespace: 'custom', key: 'short_partnumber', valuePreview: 'CIL250' }],
          variants: [{ sku: 'NOT-CIL250-SKU', metafields: [{ namespace: 'mm-google-shopping', key: 'mpn', valuePreview: 'CIL250' }] }],
        },
      ],
    });
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(getResult(body))).not.toMatch(/shpat_fallback_token_never_return|client-secret-test|client-id-fallback-test|Authorization|Bearer/i);
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
      connector: { status: 'ok', source: 'live_shopify_admin_graphql', messages: [] },
      products: [
        {
          productId: 'gid://shopify/Product/789',
          handle: 'cil250',
          productUrl: 'https://commonlands.com/products/cil250',
          variants: [
            {
              variantId: 'gid://shopify/ProductVariant/123',
              sku: 'CIL250',
              inventoryQuantity: 42,
              inventoryTracked: true,
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
      connector: { status: 'ok', source: 'live_shopify_admin_graphql' },
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

  it('reads Shopify metaobjects with field previews only', async () => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith('/admin/oauth/access_token')) {
        return Response.json({ access_token: 'shpat_metaobject_token_never_return', expires_in: 86400, scope: shopifyReadonlyEnv.SHOPIFY_SCOPES });
      }
      if (url.endsWith('/admin/api/2026-04/graphql.json')) {
        expect(String(init?.body)).toContain('metaobjects');
        expect(String(init?.body)).not.toMatch(/mutation/i);
        return Response.json({
          data: {
            metaobjects: {
              nodes: [
                {
                  id: 'gid://shopify/Metaobject/1',
                  type: 'lens_spec',
                  handle: 'cil250',
                  fields: [
                    { key: 'sku', type: 'single_line_text_field', value: 'CIL250' },
                    { key: 'private_note', type: 'multi_line_text_field', value: 'internal value that should be previewed only' },
                  ],
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
      { name: 'read_shopify_metaobjects', arguments: { type: 'lens_spec', handle: 'cil250', limit: 5 } },
      'read-shopify-metaobjects',
      shopifyReadonlyEnv,
    );
    const structuredContent = getStructuredContent(body);

    expect(structuredContent).toMatchObject({
      schemaVersion: 'shopify.live_read.v1',
      configured: true,
      query: { kind: 'metaobjects', type: 'lens_spec', handle: 'cil250', limit: 5 },
      connector: { status: 'ok', source: 'live_shopify_admin_graphql' },
      metaobjects: [
        {
          id: 'gid://shopify/Metaobject/1',
          type: 'lens_spec',
          handle: 'cil250',
          fields: [
            { key: 'sku', type: 'single_line_text_field', valuePreview: 'CIL250' },
            { key: 'private_note', type: 'multi_line_text_field', valuePreview: 'internal value that should be previewed only' },
          ],
        },
      ],
    });
    expect(JSON.stringify(getResult(body))).not.toMatch(/shpat_metaobject_token_never_return|client-secret-test|client-id-test|Authorization|Bearer/i);
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
    });
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
      expect(url).toBe('https://commonlands.com/api/ucp/mcp');
      expect(body).toContain('create_cart');
      expect(body).toContain('gid://shopify/ProductVariant/12345678901');
      expect(body).not.toMatch(/checkout|order|customer|inventory|mutation/i);
      const payload = JSON.parse(body) as { params: { arguments: { meta: Record<string, unknown>; cart: Record<string, unknown> } } };
      expect(payload.params.arguments.meta).toMatchObject({
        'ucp-agent': { profile: 'https://commonlands-mcp.erp-14c.workers.dev/.well-known/ucp' },
      });
      expect(payload.params.arguments.cart).toEqual({
        line_items: [{ quantity: 2, item: { id: 'gid://shopify/ProductVariant/12345678901' } }],
        context: { address_country: 'US', address_region: 'CA', postal_code: '92101' },
      });
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

  it('proxies get_cart, update_cart, and cancel_cart with Shopify-owned cart persistence', async () => {
    const toolNames: string[] = [];
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { params: { name: string; arguments: Record<string, unknown> } };
      toolNames.push(body.params.name);
      if (body.params.name === 'update_cart') {
        expect(body.params.arguments).toMatchObject({
          id: 'gid://shopify/Cart/cart_abc123',
          cart: { line_items: [{ quantity: 3, item: { id: 'gid://shopify/ProductVariant/12345678901' } }] },
        });
      }
      if (body.params.name === 'cancel_cart') {
        expect(body.params.arguments.meta).toMatchObject({ 'idempotency-key': '660e8400-e29b-41d4-a716-446655440001' });
      }
      return Response.json({
        result: {
          structuredContent: {
            cart: {
              id: body.params.arguments.id ?? 'gid://shopify/Cart/cart_abc123',
              continue_url: 'https://commonlands.com/cart/c/cart_abc123',
              messages: body.params.name === 'cancel_cart' ? [{ type: 'info', code: 'cart_canceled', content: 'Cart canceled' }] : [],
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
        cart: { line_items: [{ quantity: 3, item: { id: 'gid://shopify/ProductVariant/12345678901' } }] },
      },
    }, 'update-cart', shopifyCartEnv);
    const cancel = await rpc('tools/call', {
      name: 'cancel_cart',
      arguments: {
        id: 'gid://shopify/Cart/cart_abc123',
        meta: { 'idempotency-key': '660e8400-e29b-41d4-a716-446655440001' },
      },
    }, 'cancel-cart', shopifyCartEnv);

    expect(toolNames).toEqual(['get_cart', 'update_cart', 'cancel_cart']);
    expect(getStructuredContent(get.body)).toMatchObject({ operation: 'get_cart', safety: { createsCart: false, updatesCart: false } });
    expect(getStructuredContent(update.body)).toMatchObject({ operation: 'update_cart', safety: { updatesCart: true, createsCheckout: false } });
    expect(getStructuredContent(cancel.body)).toMatchObject({ operation: 'cancel_cart', safety: { cancelsCart: true, createsOrder: false } });
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
      connector: { status: 'invalid_request', messages: ['Invalid params: buyer/customer fields are not enabled for Commonlands Cart UCP'] },
      safety: { readsCustomers: false, createsCustomer: false },
    });

    const badVariant = await rpc('tools/call', {
      name: 'create_cart',
      arguments: { cart: { line_items: [{ quantity: 1, item: { id: 'gid://shopify/Product/123' } }] } },
    }, 'unsafe-cart-variant', shopifyCartEnv);
    expect(getStructuredContent(badVariant.body)).toMatchObject({ connector: { status: 'invalid_request' } });

    const badCancel = await rpc('tools/call', {
      name: 'cancel_cart',
      arguments: { id: 'gid://shopify/Cart/cart_abc123' },
    }, 'unsafe-cart-cancel', shopifyCartEnv);
    expect(getStructuredContent(badCancel.body)).toMatchObject({
      connector: { status: 'invalid_request', messages: ['Invalid params: cancel_cart requires meta["idempotency-key"] for retry safety'] },
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
    expect(parsed.ucpCatalog.compatibleTools).toEqual(['search_catalog', 'lookup_catalog', 'get_product', 'create_cart', 'get_cart', 'update_cart', 'cancel_cart']);
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

  it('serves a UCP discovery profile that advertises catalog and cart capabilities', async () => {
    const response = await fetchWorker('/.well-known/ucp');
    const profile = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(profile).toMatchObject({
      version: '2026-04-08',
      transport: 'mcp',
      endpoint: 'https://mcp.commonlands.test/mcp',
      capabilities: [
        'dev.ucp.shopping.catalog.search',
        'dev.ucp.shopping.catalog.lookup',
        'dev.ucp.shopping.cart',
      ],
    });
    expect(profile).toMatchObject({
      metadata: { cartPersistence: 'shopify_owned_cart_id_resume', cartBoundary: 'cart_ucp_enabled_no_checkout' },
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
