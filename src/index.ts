import {
  assertSafePublicCatalogUrls,
  CATALOG_SNAPSHOT,
  FIXTURE_NOT_PRODUCT_TRUTH_WARNING,
  getLensBySku,
  getSensorByPartNumber,
  searchLenses,
  type LensCatalogItem,
} from './catalog';
import { computeFov } from './optics';
import { buildProductPageDetails } from './product-page';
import { getPurchaseRouteOptions } from './purchase-routes';
import { callShopifyCartUcp, type CartOperation } from './shopify-cart-ucp';
import { callShopifyCheckoutMcp, type CheckoutOperation } from './shopify-checkout-mcp';
import { readShopifyMetaobjects, readShopifyProducts } from './shopify-read-adapter';
import {
  compareLenses,
  matchLensesToSensor,
  recommendLensesForApplication,
  type LensRecommendation,
} from './recommendations';
import { getShopifyReadonlyStatus } from './shopify-readonly-status';
import { getShopifyUcpReadiness } from './shopify-ucp-readiness';
import {
  buildUcpDiscoveryProfile,
  getProduct,
  lookupCatalog,
  prepareShopifyPurchaseHandoff,
  searchCatalog,
} from './ucp-catalog';
import { getCatalogSnapshotStatus } from './snapshot-status';
import { fetchWithTimeout, readJsonWithLimit } from './http-safety';

export interface Env {
  ENVIRONMENT?: string;
  VERSION?: string;
  GIT_SHA?: string;
  SHOPIFY_CLIENT_ID?: string;
  SHOPIFY_CLIENT_SECRET?: string;
  SHOPIFY_SHOP_DOMAIN?: string;
  SHOPIFY_SCOPES?: string;
  SHOPIFY_ADMIN_API_VERSION?: string;
  SHOPIFY_CART_MCP_ENDPOINT?: string;
  SHOPIFY_CHECKOUT_MCP_ENDPOINT?: string;
  SHOPIFY_UCP_AGENT_PROFILE?: string;
  ENABLE_COMMERCE_MUTATION_TOOLS?: string;
  ENABLE_CHECKOUT_MUTATION_TOOLS?: string;
  ENABLE_EXTRA_CHECKOUT_MUTATION_TOOLS?: string;
  FOV_LIVE_BACKEND_ENABLED?: string;
  FOV_LAMBDA_ENDPOINT?: string;
  FOV_API_KEY?: string;
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
const MAX_MCP_BODY_BYTES = 64 * 1024;
const SAFE_IDENTIFIER_PATTERN = /^[A-Z0-9-]{2,32}$/;
const MAX_WORKING_DISTANCE_MM = 100_000;
const FOV_BACKEND_TIMEOUT_MS = 4_000;
const FOV_BACKEND_MAX_RESPONSE_BYTES = 128 * 1024;
const FOV_SINGLE_MAX_RESULTS = 10;
const FOV_CATALOG_MAX_RESULTS = 250;

const TOOLS: ToolDefinition[] = [
  {
    name: 'search_lenses',
    title: 'Search Commonlands lenses',
    description:
      'Search the fixture-backed Commonlands lens catalog snapshot by SKU, title, mount, or lens type. Use read_shopify_products for live purchasable product truth.',
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
    description: 'Return fixture-backed public product and optical metadata for one Commonlands lens SKU. Use read_shopify_products for live product, price, availability, variant IDs, and metafields.',
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
      'Compute field of view for a Commonlands lens and sensor pair. Uses the authenticated live FoV backend when configured; otherwise fixture-backed scaffold data. Verify purchasable facts with read_shopify_products.',
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
    name: 'compute_fov_catalog',
    title: 'Compute catalog field of view for a sensor',
    description:
      'Compute field of view for the available Commonlands lens catalog on one sensor. Uses the authenticated live FoV backend when configured and returns sanitized FoV/catalog fields only; alpha/beta coefficients are never returned.',
    inputSchema: {
      type: 'object',
      properties: {
        sensorPartNumber: { type: 'string', description: 'Sensor part number, for example IMX477.' },
        workingDistanceMm: {
          type: 'number',
          exclusiveMinimum: 0,
          description: 'Optional working distance used by backends that support scene-size estimates.',
        },
      },
      required: ['sensorPartNumber'],
      additionalProperties: false,
    },
  },
  {
    name: 'match_lenses_to_sensor',
    title: 'Match lenses to a sensor',
    description:
      'Rank fixture catalog lenses for one sensor using image-circle coverage, FoV target fit, and deterministic optical tradeoffs. Not live product truth; verify purchasable facts with read_shopify_products.',
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
    description: 'Compare selected fixture-backed lens SKUs on the same sensor with the same deterministic scoring model. Not live product truth; verify purchasable facts with read_shopify_products.',
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
    name: 'get_product_page_details',
    title: 'Get product page details',
    description:
      'Return fixture-backed product-page handoff details for one lens, including DynamoDB-sourced optical specs and gated datasheet policy. Use read_shopify_products for live product URL, price, availability, variant IDs, and metafields.',
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
    name: 'get_catalog_snapshot_status',
    title: 'Get joined catalog snapshot status',
    description:
      'Return fixture-backed joined catalog counts, validation status, source provenance, live connector readiness, and non-authoritative product-truth warning.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_shopify_ucp_readiness',
    title: 'Get Shopify Storefront/UCP readiness',
    description:
      'Report connector-free Shopify Storefront MCP and UCP Catalog compatibility, launch blockers, and Commonlands engineering differentiators.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_shopify_readonly_config_status',
    title: 'Get Shopify read-only config status',
    description:
      'Report sanitized Cloudflare Shopify binding presence, approved read scopes, and read-only safety flags without exposing secrets or calling Shopify.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'read_shopify_products',
    title: 'Read Shopify products',
    description:
      'Use this for live purchasable product truth: product and variant IDs, SKUs, prices, inventory signals, product URLs, and metafields. Read-only; does not create carts, checkouts, orders, customers, inventory mutations, or Shopify writes. Fixture catalog tools are scaffold data only.',
    inputSchema: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'Optional variant SKU, for example CIL250.' },
        handle: { type: 'string', description: 'Optional Shopify product handle.' },
        query: { type: 'string', description: 'Optional safe Shopify product/variant search text.' },
        limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
        includeMetafields: { type: 'boolean', default: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'read_shopify_metaobjects',
    title: 'Read Shopify metaobjects',
    description:
      'Read live Shopify Admin metaobjects by type, optionally filtered by handle, through approved read-only scopes. Returns redacted field previews only and never writes metaobjects or metafields.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Metaobject definition type.' },
        handle: { type: 'string', description: 'Optional metaobject handle filter.' },
        limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
      },
      required: ['type'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_cart',
    title: 'Create Shopify cart',
    description:
      'Create a Shopify-owned cart for selected variant line items through the configured Shopify Cart/Storefront MCP endpoint. Commonlands MCP is a stateless proxy: cart state is stored and mutated by Shopify, not in the Worker.',
    inputSchema: {
      type: 'object',
      properties: {
        meta: { type: 'object', description: 'Optional UCP metadata. ucp-agent.profile is filled from server config when omitted.' },
        cart: {
          type: 'object',
          properties: {
            line_items: {
              type: 'array',
              minItems: 1,
              maxItems: 25,
              items: {
                type: 'object',
                properties: {
                  quantity: { type: 'integer', minimum: 1, maximum: 999 },
                  item: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
                },
                required: ['quantity', 'item'],
                additionalProperties: false,
              },
            },
            context: { type: 'object' },
            signals: { type: 'object' },
          },
          required: ['line_items'],
          additionalProperties: false,
        },
      },
      required: ['cart'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_cart',
    title: 'Get Shopify cart',
    description: 'Retrieve a Shopify-owned cart by cart id. Cart persistence comes from Shopify; agents must retain cart id or continue_url across sessions.',
    inputSchema: {
      type: 'object',
      properties: { meta: { type: 'object' }, id: { type: 'string', description: 'Shopify Cart gid.' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_cart',
    title: 'Update Shopify cart',
    description:
      'Update a Shopify-owned cart through the configured Cart/Storefront MCP endpoint. With UCP endpoints, treat updates as full-state PUT semantics; with the confirmed standard Storefront MCP endpoint, Commonlands maps line_items to Shopify add_items, update_items to quantity changes, and remove_line_ids to explicit removals. Quantity 0 in update_items removes a line.',
    inputSchema: {
      type: 'object',
      properties: {
        meta: { type: 'object' },
        id: { type: 'string' },
        cart: {
          type: 'object',
          properties: {
            line_items: {
              type: 'array',
              minItems: 1,
              maxItems: 25,
              description: 'Variant items to add to the cart.',
              items: {
                type: 'object',
                properties: {
                  quantity: { type: 'integer', minimum: 1, maximum: 999 },
                  item: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
                },
                required: ['quantity', 'item'],
                additionalProperties: false,
              },
            },
            update_items: {
              type: 'array',
              minItems: 1,
              maxItems: 25,
              description: 'Existing Shopify cart line IDs with desired quantities; quantity 0 removes the line.',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Shopify CartLine gid.' },
                  quantity: { type: 'integer', minimum: 0, maximum: 999 },
                },
                required: ['id', 'quantity'],
                additionalProperties: false,
              },
            },
            remove_line_ids: {
              type: 'array',
              minItems: 1,
              maxItems: 25,
              description: 'Existing Shopify CartLine gids to remove explicitly.',
              items: { type: 'string' },
            },
            context: { type: 'object' },
            signals: { type: 'object' },
          },
          additionalProperties: false,
        },
      },
      required: ['id', 'cart'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_cart',
    title: 'Cancel Shopify cart',
    description: 'Cancel a Shopify-owned UCP cart by id. Requires a validated UCP Cart MCP endpoint and meta["idempotency-key"] UUID for retry safety; the confirmed standard Storefront MCP endpoint does not expose cancel_cart.',
    inputSchema: {
      type: 'object',
      properties: { meta: { type: 'object' }, id: { type: 'string' } },
      required: ['id', 'meta'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_checkout',
    title: 'Create Shopify Checkout MCP checkout',
    description:
      'Create a Shopify-owned checkout from a selected cart or explicit variant line items. Commonlands MCP is a stateless proxy: checkout state is stored and mutated by Shopify Checkout MCP, not in the Worker. Authentication and payment authorization are deferred until complete_checkout.',
    inputSchema: {
      type: 'object',
      properties: {
        meta: { type: 'object', description: 'Optional UCP metadata. ucp-agent.profile is filled from server config when omitted.' },
        checkout: {
          type: 'object',
          properties: {
            cart_id: { type: 'string', description: 'Optional Shopify Cart gid to convert/hand off into checkout.' },
            line_items: {
              type: 'array',
              minItems: 1,
              maxItems: 25,
              items: {
                type: 'object',
                properties: {
                  quantity: { type: 'integer', minimum: 1, maximum: 999 },
                  item: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
                },
                required: ['quantity', 'item'],
                additionalProperties: false,
              },
            },
            context: { type: 'object' },
          },
          additionalProperties: false,
        },
      },
      required: ['checkout'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_checkout',
    title: 'Get Shopify Checkout MCP checkout',
    description: 'Retrieve a Shopify-owned checkout by checkout id. Checkout persistence comes from Shopify; agents must retain checkout id or checkout_url across sessions.',
    inputSchema: {
      type: 'object',
      properties: { meta: { type: 'object' }, id: { type: 'string', description: 'Shopify Checkout gid.' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_checkout',
    title: 'Update Shopify Checkout MCP checkout',
    description:
      'Replace allowed Shopify-owned checkout line item/context state. Does not accept raw payment credentials, discount/gift card, or order fields; buyer/address verification is completed through Shopify checkout authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        meta: { type: 'object' },
        id: { type: 'string' },
        checkout: {
          type: 'object',
          properties: {
            cart_id: { type: 'string' },
            line_items: {
              type: 'array',
              minItems: 1,
              maxItems: 25,
              items: {
                type: 'object',
                properties: {
                  quantity: { type: 'integer', minimum: 1, maximum: 999 },
                  item: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
                },
                required: ['quantity', 'item'],
                additionalProperties: false,
              },
            },
            context: { type: 'object' },
          },
          additionalProperties: false,
        },
      },
      required: ['id', 'checkout'],
      additionalProperties: false,
    },
  },

  {
    name: 'complete_checkout',
    title: 'Complete Shopify Checkout MCP checkout',
    description:
      'Complete a Shopify-owned checkout only after Shopify-hosted checkout authentication verifies buyer name, email, phone, address, and card/payment authorization. Requires meta["idempotency-key"] UUID. Commonlands never accepts raw card numbers, CVV, payment credentials, customer records, or direct order writes.',
    inputSchema: {
      type: 'object',
      properties: {
        meta: { type: 'object', description: 'Required UCP metadata including idempotency-key UUID. ucp-agent.profile is filled from server config when omitted.' },
        id: { type: 'string', description: 'Shopify Checkout gid.' },
        authentication: {
          type: 'object',
          properties: {
            method: { type: 'string', enum: ['shopify_checkout_authenticated'] },
            buyerVerified: { type: 'boolean', const: true },
            paymentAuthorized: { type: 'boolean', const: true },
            nameVerified: { type: 'boolean', const: true },
            emailVerified: { type: 'boolean', const: true },
            phoneVerified: { type: 'boolean', const: true },
            addressVerified: { type: 'boolean', const: true },
            cardAuthorized: { type: 'boolean', const: true },
            authenticatedAt: { type: 'string', description: 'ISO timestamp from the authenticated Shopify checkout phase.' },
          },
          required: ['method', 'buyerVerified', 'paymentAuthorized', 'nameVerified', 'emailVerified', 'phoneVerified', 'addressVerified', 'cardAuthorized', 'authenticatedAt'],
          additionalProperties: false,
        },
      },
      required: ['id', 'meta', 'authentication'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_checkout',
    title: 'Cancel Shopify Checkout MCP checkout',
    description: 'Cancel a Shopify-owned checkout by id. Requires meta["idempotency-key"] UUID for retry safety. Does not refund, void payment, or cancel an order.',
    inputSchema: {
      type: 'object',
      properties: { meta: { type: 'object' }, id: { type: 'string' } },
      required: ['id', 'meta'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_catalog',
    title: 'Search UCP catalog',
    description:
      'Fixture-backed UCP Catalog search alias for Shopify-native product discovery; no live Shopify calls or cart behavior.',
    inputSchema: {
      type: 'object',
      properties: {
        meta: { type: 'object', description: 'Optional UCP agent metadata.' },
        catalog: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'lookup_catalog',
    title: 'Lookup UCP catalog products',
    description:
      'Fixture-backed UCP Catalog lookup alias for product, variant, SKU, handle, or URL identifiers; returns not-found messages instead of writes.',
    inputSchema: {
      type: 'object',
      properties: {
        meta: { type: 'object' },
        catalog: {
          type: 'object',
          properties: {
            ids: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string' } },
          },
          required: ['ids'],
          additionalProperties: true,
        },
      },
      required: ['catalog'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_product',
    title: 'Get UCP catalog product',
    description:
      'Fixture-backed UCP Catalog product detail alias with Commonlands optical metadata and Shopify-native handoff fields.',
    inputSchema: {
      type: 'object',
      properties: {
        meta: { type: 'object' },
        catalog: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
          additionalProperties: true,
        },
      },
      required: ['catalog'],
      additionalProperties: false,
    },
  },
  {
    name: 'prepare_shopify_purchase_handoff',
    title: 'Prepare Shopify purchase handoff',
    description:
      'Build a read-only Shopify-native purchase handoff seam for a selected lens without creating carts, checkout, orders, inventory mutations, or writes.',
    inputSchema: {
      type: 'object',
      properties: {
        sku: { type: 'string' },
        quantity: { type: 'integer', minimum: 1, maximum: 999, default: 1 },
        sensorPartNumber: { type: 'string' },
        selectedVariantId: { type: 'string' },
      },
      required: ['sku'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_purchase_route_options',
    title: 'Get purchase route options',
    description:
      'Return safe dual-channel purchase route options for AI agents and robotics engineers across Commonlands MCP and Shopify-native channels without mutating commerce state.',
    inputSchema: {
      type: 'object',
      properties: {
        sku: { type: 'string' },
        quantity: { type: 'integer', minimum: 1, maximum: 999, default: 1 },
        sensorPartNumber: { type: 'string' },
        buyerIntent: { type: 'string' },
        agentType: { type: 'string' },
      },
      required: ['sku'],
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
  {
    uri: 'commonlands://catalog/snapshot-status',
    name: 'Commonlands joined catalog snapshot status',
    description: 'Fixture-backed catalog validation, join counts, source provenance, and connector-readiness status.',
    mimeType: 'application/json',
  },
  {
    uri: 'commonlands://compatibility/shopify-ucp',
    name: 'Commonlands Shopify Storefront/UCP readiness',
    description: 'Fixture-backed compatibility report for Shopify Storefront MCP and UCP Catalog launch planning.',
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
      'Commonlands MCP catalog, optics, live read-only Shopify product truth, live FoV when configured, and approved Shopify-owned cart handoff endpoint. Fixture-backed tools are scaffold/context only; use read_shopify_products for purchasable truth.',
  });
}

function toolListResponse(id: unknown, env: Env): Response {
  return rpcResult(id, { tools: visibleTools(env) });
}

function visibleTools(env: Env): ToolDefinition[] {
  return TOOLS.filter((tool) => isToolEnabled(tool.name, env));
}

function isToolEnabled(name: string, env: Env): boolean {
  if (name === 'cancel_cart' && !cartEndpointSupportsCancel(env)) return false;
  if (isCartTool(name)) return env.ENABLE_COMMERCE_MUTATION_TOOLS === 'true';
  if (name === 'create_checkout' || name === 'get_checkout') return env.ENABLE_CHECKOUT_MUTATION_TOOLS === 'true';
  if (name === 'update_checkout' || name === 'complete_checkout' || name === 'cancel_checkout') return env.ENABLE_EXTRA_CHECKOUT_MUTATION_TOOLS === 'true';
  return true;
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

  if (params.uri === 'commonlands://catalog/snapshot-status') {
    return rpcResult(id, {
      contents: [
        {
          uri: params.uri,
          mimeType: 'application/json',
          text: JSON.stringify(getCatalogSnapshotStatus()),
        },
      ],
    });
  }

  if (params.uri === 'commonlands://compatibility/shopify-ucp') {
    return rpcResult(id, {
      contents: [
        {
          uri: params.uri,
          mimeType: 'application/json',
          text: JSON.stringify(getShopifyUcpReadiness()),
        },
      ],
    });
  }

  return rpcError(id, { code: -32602, message: `Unknown resource: ${params.uri}` });
}

async function toolCallResponse(id: unknown, params: unknown, env: Env): Promise<Response> {
  if (!isRecord(params) || typeof params.name !== 'string') {
    return rpcError(id, { code: -32602, message: 'Invalid params: tool name is required' });
  }

  const args = isRecord(params.arguments) ? params.arguments : {};
  if (!isToolEnabled(params.name, env)) {
    return rpcError(id, { code: -32601, message: `Tool not found: ${params.name}` });
  }

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
      sourceWarning: FIXTURE_NOT_PRODUCT_TRUTH_WARNING,
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
      sourceWarning: FIXTURE_NOT_PRODUCT_TRUTH_WARNING,
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
    const lensSkuError = validateSafeIdentifier(args.lensSku, 'lensSku');
    if (lensSkuError) return rpcError(id, lensSkuError);
    const sensorError = validateSafeIdentifier(args.sensorPartNumber, 'sensorPartNumber');
    if (sensorError) return rpcError(id, sensorError);
    const distanceError = validateOptionalPositiveNumber(args.workingDistanceMm, 'workingDistanceMm', MAX_WORKING_DISTANCE_MM);
    if (distanceError) return rpcError(id, distanceError);

    const lensSku = normalizeSafeIdentifier(args.lensSku as string);
    const sensorPartNumber = normalizeSafeIdentifier(args.sensorPartNumber as string);
    const sensor = getSensorByPartNumber(sensorPartNumber);
    if (!sensor) {
      return rpcError(id, { code: -32004, message: 'Sensor not found' });
    }

    const workingDistanceMm = typeof args.workingDistanceMm === 'number' ? args.workingDistanceMm : undefined;

    if (isFovLiveBackendEnabled(env)) {
      const liveInput: LiveFovInput = {
        lensSku,
        sensorPartNumber,
        ...(workingDistanceMm !== undefined ? { workingDistanceMm } : {}),
      };
      const liveResult = await computeFovWithLiveBackend(env, liveInput);
      if ('error' in liveResult) return rpcError(id, liveResult.error);
      return toolResult(id, liveResult.structuredContent);
    }

    const lens = getLensBySku(lensSku);
    if (!lens) {
      return rpcError(id, { code: -32004, message: 'Lens not found' });
    }

    return toolResult(id, {
      ...computeFov(lens, sensor, workingDistanceMm),
      sourceWarning: FIXTURE_NOT_PRODUCT_TRUTH_WARNING,
    });
  }

  if (params.name === 'compute_fov_catalog') {
    const sensorError = validateSafeIdentifier(args.sensorPartNumber, 'sensorPartNumber');
    if (sensorError) return rpcError(id, sensorError);
    const distanceError = validateOptionalPositiveNumber(args.workingDistanceMm, 'workingDistanceMm', MAX_WORKING_DISTANCE_MM);
    if (distanceError) return rpcError(id, distanceError);

    const sensorPartNumber = normalizeSafeIdentifier(args.sensorPartNumber as string);
    const sensor = getSensorByPartNumber(sensorPartNumber);
    if (!sensor) {
      return rpcError(id, { code: -32004, message: 'Sensor not found' });
    }

    const workingDistanceMm = typeof args.workingDistanceMm === 'number' ? args.workingDistanceMm : undefined;

    if (isFovLiveBackendEnabled(env)) {
      const liveInput: LiveFovInput = {
        sensorPartNumber,
        ...(workingDistanceMm !== undefined ? { workingDistanceMm } : {}),
      };
      const liveResult = await computeFovWithLiveBackend(env, liveInput);
      if ('error' in liveResult) return rpcError(id, liveResult.error);
      return toolResult(id, liveResult.structuredContent);
    }

    return toolResult(id, {
      schemaVersion: 'optics.fov.catalog.fixture.v1',
      correctionStatus: 'fixture_parity_scaffold',
      source: 'fixture-catalog',
      requested: {
        sensorPartNumber,
        ...(workingDistanceMm !== undefined ? { workingDistanceMm } : {}),
      },
      sensor: {
        partNumber: sensor.partNumber,
        hsize: sensor.activeAreaMm.width,
        vsize: sensor.activeAreaMm.height,
        dsize: Math.hypot(sensor.activeAreaMm.width, sensor.activeAreaMm.height),
        pixpitch: sensor.pixelSizeUm,
        resolution: sensor.resolution,
      },
      count: CATALOG_SNAPSHOT.lenses.length,
      lenses: CATALOG_SNAPSHOT.lenses.map((lens) => sanitizeFixtureCatalogFovLens(computeFov(lens, sensor, workingDistanceMm), lens)),
      errors: [],
      sourceWarning: FIXTURE_NOT_PRODUCT_TRUTH_WARNING,
      assumptions: [
        'Fixture catalog-wide FoV is scaffold data. Use live backend results and read_shopify_products before final customer-facing recommendations.',
      ],
    });
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

  if (params.name === 'get_product_page_details') {
    if (typeof args.sku !== 'string') {
      return rpcError(id, { code: -32602, message: 'Invalid params: sku is required' });
    }

    const lens = getLensBySku(args.sku);
    if (!lens) {
      return rpcError(id, { code: -32004, message: `Lens not found: ${args.sku}` });
    }

    return toolResult(id, {
      ...buildProductPageDetails(lens),
      sourceWarning: FIXTURE_NOT_PRODUCT_TRUTH_WARNING,
    });
  }

  if (params.name === 'get_catalog_snapshot_status') {
    return toolResult(id, getCatalogSnapshotStatus());
  }

  if (params.name === 'get_shopify_ucp_readiness') {
    return toolResult(id, getShopifyUcpReadiness());
  }

  if (params.name === 'get_shopify_readonly_config_status') {
    return toolResult(id, getShopifyReadonlyStatus(env));
  }

  if (params.name === 'read_shopify_products') {
    return toolResult(id, await readShopifyProducts(env, args));
  }

  if (params.name === 'read_shopify_metaobjects') {
    return toolResult(id, await readShopifyMetaobjects(env, args));
  }

  if (isCartTool(params.name)) {
    return toolResult(id, await callShopifyCartUcp(env, params.name, args));
  }

  if (isCheckoutTool(params.name)) {
    return toolResult(id, await callShopifyCheckoutMcp(env, params.name, args));
  }

  if (params.name === 'search_catalog') {
    try {
      return toolResult(id, {
        ...searchCatalog(args),
        sourceWarning: FIXTURE_NOT_PRODUCT_TRUTH_WARNING,
      });
    } catch (error) {
      return ucpCatalogError(id, error);
    }
  }

  if (params.name === 'lookup_catalog') {
    try {
      return toolResult(id, {
        ...lookupCatalog(args),
        sourceWarning: FIXTURE_NOT_PRODUCT_TRUTH_WARNING,
      });
    } catch (error) {
      return ucpCatalogError(id, error);
    }
  }

  if (params.name === 'get_product') {
    try {
      return toolResult(id, {
        ...getProduct(args),
        sourceWarning: FIXTURE_NOT_PRODUCT_TRUTH_WARNING,
      });
    } catch (error) {
      return ucpCatalogError(id, error);
    }
  }

  if (params.name === 'prepare_shopify_purchase_handoff') {
    try {
      return toolResult(id, {
        ...prepareShopifyPurchaseHandoff(args),
        sourceWarning: FIXTURE_NOT_PRODUCT_TRUTH_WARNING,
      });
    } catch (error) {
      return purchaseHandoffError(id, error);
    }
  }

  if (params.name === 'get_purchase_route_options') {
    try {
      return toolResult(id, {
        ...getPurchaseRouteOptions(args),
        sourceWarning: FIXTURE_NOT_PRODUCT_TRUTH_WARNING,
      });
    } catch (error) {
      return purchaseHandoffError(id, error);
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

function isCartTool(name: unknown): name is CartOperation {
  return name === 'create_cart' || name === 'get_cart' || name === 'update_cart' || name === 'cancel_cart';
}

function cartEndpointSupportsCancel(env: Env): boolean {
  if (env.ENABLE_COMMERCE_MUTATION_TOOLS !== 'true') return false;
  try {
    return new URL(env.SHOPIFY_CART_MCP_ENDPOINT ?? '').pathname === '/api/ucp/mcp';
  } catch {
    return false;
  }
}

function isCheckoutTool(name: unknown): name is CheckoutOperation {
  return name === 'create_checkout' || name === 'get_checkout' || name === 'update_checkout' || name === 'complete_checkout' || name === 'cancel_checkout';
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


function isFovLiveBackendEnabled(env: Env): boolean {
  return env.FOV_LIVE_BACKEND_ENABLED === 'true';
}

interface LiveFovInput {
  lensSku?: string;
  sensorPartNumber: string;
  workingDistanceMm?: number;
}

interface LiveFovResponse {
  sensor?: unknown;
  count?: unknown;
  lenses?: unknown;
  errors?: unknown;
}

interface SanitizedFovLens {
  partNum?: string;
  hfov?: number;
  vfov?: number;
  dfov?: number;
  efl?: number;
  imageCircle?: number;
  lensType?: string;
  mount?: string;
  resolution?: string;
  fNumber?: number;
  ingress?: string;
  url?: string;
  distortion?: {
    display?: string;
    horizontal?: number;
    vertical?: number;
    diagonal?: number;
    status: 'source_display_only' | 'calculated';
  };
  pixpitch?: number;
}

async function computeFovWithLiveBackend(
  env: Env,
  input: LiveFovInput,
): Promise<{ structuredContent: Record<string, unknown> } | { error: JsonRpcError }> {
  const endpoint = parseFovBackendEndpoint(env.FOV_LAMBDA_ENDPOINT);
  if ('error' in endpoint) return { error: endpoint.error };
  if (!env.FOV_API_KEY || env.FOV_API_KEY.trim() === '') {
    return { error: { code: -32603, message: 'Live FoV backend is missing authentication configuration' } };
  }

  const sensor = getSensorByPartNumber(input.sensorPartNumber);
  if (!sensor) {
    return { error: { code: -32004, message: 'Sensor not found' } };
  }

  const requestBody = {
    sensor: {
      partNumber: sensor.partNumber,
      hsize: sensor.activeAreaMm.width,
      vsize: sensor.activeAreaMm.height,
      dsize: Math.hypot(sensor.activeAreaMm.width, sensor.activeAreaMm.height),
      pixpitch: sensor.pixelSizeUm,
      resolution: sensor.resolution,
    },
    ...(input.lensSku ? { partNums: [input.lensSku] } : {}),
    ...(input.workingDistanceMm !== undefined ? { workingDistanceMm: input.workingDistanceMm } : {}),
  };

  let response: Response;
  try {
    response = await fetchWithTimeout(endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json',
        'x-api-key': env.FOV_API_KEY,
      },
      body: JSON.stringify(requestBody),
    }, FOV_BACKEND_TIMEOUT_MS);
  } catch {
    return { error: { code: -32603, message: 'Live FoV backend request failed' } };
  }

  const parsed = await readJsonWithLimit<LiveFovResponse>(response, 'Live FoV backend', {
    maxBytes: FOV_BACKEND_MAX_RESPONSE_BYTES,
  });
  if ('error' in parsed) {
    return { error: { code: -32603, message: 'Live FoV backend returned invalid response' } };
  }

  if (!response.ok) {
    return { error: { code: response.status === 401 || response.status === 403 ? -32001 : -32603, message: 'Live FoV backend rejected request' } };
  }

  const resultLimit = input.lensSku ? FOV_SINGLE_MAX_RESULTS : FOV_CATALOG_MAX_RESULTS;
  const sanitizedLenses = sanitizeFovLenses(parsed.data.lenses, resultLimit);
  const backendLensCount = sanitizeCount(parsed.data.count, parsed.data.lenses);

  return {
    structuredContent: {
      schemaVersion: 'optics.fov.live.v1',
      modelVersion: 'lambda-dynamodb-fov-0.1.0',
      correctionStatus: 'live_lambda_dynamodb',
      source: 'aws-lambda-dynamodb-readonly',
      requested: {
        ...(input.lensSku ? { lensSku: input.lensSku } : {}),
        sensorPartNumber: input.sensorPartNumber,
        ...(input.workingDistanceMm !== undefined ? { workingDistanceMm: input.workingDistanceMm } : {}),
      },
      sensor: sanitizeFovSensor(parsed.data.sensor, sensor),
      count: sanitizedLenses.length,
      backendCount: backendLensCount,
      resultLimit,
      truncated: backendLensCount > sanitizedLenses.length,
      lenses: sanitizedLenses,
      errors: sanitizeFovErrors(parsed.data.errors),
      assumptions: [
        'FoV values are computed by the authenticated Commonlands AWS Lambda backend using read-only DynamoDB lens records.',
        'The MCP Worker stores backend authentication server-side; agents and users do not receive the Lambda API key.',
      ],
    },
  };
}

function sanitizeCount(count: unknown, lenses: unknown): number {
  if (typeof count === 'number' && Number.isFinite(count) && count >= 0) return Math.trunc(count);
  return Array.isArray(lenses) ? lenses.length : 0;
}

function sanitizeFovLenses(value: unknown, limit = FOV_SINGLE_MAX_RESULTS): SanitizedFovLens[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map(sanitizeFovLens).filter((lens): lens is SanitizedFovLens => lens !== null);
}

function sanitizeFovLens(value: unknown): SanitizedFovLens | null {
  if (!value || typeof value !== 'object') return null;
  const lens = value as Record<string, unknown>;
  const partNum = firstString(lens.partNum, lens.PartNum, lens.sku, lens.SKU, lens.id);
  const sanitized: SanitizedFovLens = {
    ...(partNum ? { partNum } : {}),
    ...numberField('hfov', firstNumber(lens.hfov, lens.horizontalFovDeg)),
    ...numberField('vfov', firstNumber(lens.vfov, lens.verticalFovDeg)),
    ...numberField('dfov', firstNumber(lens.dfov, lens.diagonalFovDeg)),
    ...numberField('efl', firstNumber(lens.efl, lens.eflMm, lens.focalLengthMm)),
    ...numberField('imageCircle', firstNumber(lens.image_circle, lens.imageCircle, lens.imageCircleMm)),
    ...stringField('lensType', firstString(lens.lens_type, lens.lensType)),
    ...stringField('mount', firstString(lens.mount)),
    ...stringField('resolution', firstString(lens.resolution)),
    ...numberField('fNumber', firstNumber(lens.f_num, lens.fNumber)),
    ...stringField('ingress', firstString(lens.ingress)),
    ...stringField('url', firstString(lens.url, lens.webpage, lens.productUrl)),
    ...numberField('pixpitch', firstNumber(lens.pixpitch, lens.pixelSizeUm)),
  };
  const distortion = sanitizeDistortion(lens);
  if (distortion) sanitized.distortion = distortion;
  return sanitized;
}

function sanitizeDistortion(lens: Record<string, unknown>): SanitizedFovLens['distortion'] | undefined {
  const horizontal = firstNumber(lens.horizontalDistortion, lens.hdistortion, lens.distortion_horizontal);
  const vertical = firstNumber(lens.verticalDistortion, lens.vdistortion, lens.distortion_vertical);
  const diagonal = firstNumber(lens.diagonalDistortion, lens.ddistortion, lens.distortion_diagonal);
  const display = firstString(lens.distortion, lens.distortionDisplay);
  if (horizontal !== undefined || vertical !== undefined || diagonal !== undefined) {
    return {
      ...(display ? { display } : {}),
      ...(horizontal !== undefined ? { horizontal } : {}),
      ...(vertical !== undefined ? { vertical } : {}),
      ...(diagonal !== undefined ? { diagonal } : {}),
      status: 'calculated',
    };
  }
  if (!display) return undefined;
  return { display, status: 'source_display_only' };
}

function sanitizeFovSensor(value: unknown, fallback: NonNullable<ReturnType<typeof getSensorByPartNumber>>): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return {
      partNumber: fallback.partNumber,
      hsize: fallback.activeAreaMm.width,
      vsize: fallback.activeAreaMm.height,
      dsize: Math.hypot(fallback.activeAreaMm.width, fallback.activeAreaMm.height),
      pixpitch: fallback.pixelSizeUm,
      resolution: fallback.resolution,
    };
  }
  const sensor = value as Record<string, unknown>;
  return {
    partNumber: firstString(sensor.partNumber, sensor.PartNumber) ?? fallback.partNumber,
    ...numberField('hsize', firstNumber(sensor.hsize, sensor.hsizeMm)),
    ...numberField('vsize', firstNumber(sensor.vsize, sensor.vsizeMm)),
    ...numberField('dsize', firstNumber(sensor.dsize, sensor.dsizeMm)),
    ...numberField('pixpitch', firstNumber(sensor.pixpitch, sensor.pixelSizeUm)),
    ...stringField('resolution', firstString(sensor.resolution)),
  };
}

function sanitizeFovErrors(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 25).map((entry) => {
    if (!entry || typeof entry !== 'object') return { message: 'backend_error' };
    const error = entry as Record<string, unknown>;
    const partNum = firstString(error.partNum, error.PartNum, error.sku, error.id);
    return {
      ...(partNum && SAFE_IDENTIFIER_PATTERN.test(partNum.toUpperCase()) ? { partNum: partNum.toUpperCase() } : {}),
      message: 'backend_error',
    };
  });
}

function sanitizeFixtureCatalogFovLens(fovResult: unknown, lens: LensCatalogItem): SanitizedFovLens {
  const result = fovResult as {
    fov?: { horizontalDeg?: number; verticalDeg?: number; diagonalDeg?: number };
    lens?: { eflMm?: number; imageCircleMm?: number; fNumber?: number };
  };
  const sanitized: SanitizedFovLens = {
    partNum: lens.sku,
    efl: result.lens?.eflMm ?? lens.eflMm,
    imageCircle: result.lens?.imageCircleMm ?? lens.imageCircleMm,
    lensType: lens.lensType,
    mount: lens.mount,
    resolution: lens.resolution,
    fNumber: result.lens?.fNumber ?? lens.fNumber,
    url: lens.productUrl,
    distortion: { display: lens.fixtureDistortion?.notes ?? 'fixture distortion scaffold', status: 'source_display_only' },
  };
  if (result.fov?.horizontalDeg !== undefined) sanitized.hfov = result.fov.horizontalDeg;
  if (result.fov?.verticalDeg !== undefined) sanitized.vfov = result.fov.verticalDeg;
  if (result.fov?.diagonalDeg !== undefined) sanitized.dfov = result.fov.diagonalDeg;
  return sanitized;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function stringField<Key extends string>(key: Key, value: string | undefined): { [K in Key]?: string } {
  return value === undefined ? {} : { [key]: value } as { [K in Key]?: string };
}

function numberField<Key extends string>(key: Key, value: number | undefined): { [K in Key]?: number } {
  return value === undefined ? {} : { [key]: value } as { [K in Key]?: number };
}

function parseFovBackendEndpoint(value: string | undefined): { url: string } | { error: JsonRpcError } {
  if (!value || value.trim() === '') {
    return { error: { code: -32603, message: 'Live FoV backend endpoint is not configured' } };
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      return { error: { code: -32603, message: 'Live FoV backend endpoint must use HTTPS' } };
    }
    if (url.hostname !== 'ia97wrz7ag.execute-api.us-west-2.amazonaws.com' || url.pathname !== '/default/fov') {
      return { error: { code: -32603, message: 'Live FoV backend endpoint is not allowlisted' } };
    }
    return { url: url.toString() };
  } catch {
    return { error: { code: -32603, message: 'Live FoV backend endpoint is invalid' } };
  }
}


function validateSafeIdentifier(value: unknown, fieldName: string): JsonRpcError | null {
  if (typeof value !== 'string') return { code: -32602, message: `Invalid params: ${fieldName} is required` };
  if (!SAFE_IDENTIFIER_PATTERN.test(value.trim().toUpperCase())) {
    return { code: -32602, message: `Invalid params: ${fieldName} must match /^[A-Z0-9-]{2,32}$/` };
  }
  return null;
}

function normalizeSafeIdentifier(value: string): string {
  return value.trim().toUpperCase();
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
    sourceWarning: FIXTURE_NOT_PRODUCT_TRUTH_WARNING,
    assumptions: [
      'Ranking is fixture-backed and excludes live Shopify stock, price, availability, variant IDs, MTF, CRA, and production coefficient parity. Use read_shopify_products for live purchasable product truth before final SKU, cart, or checkout decisions.',
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

function validateOptionalPositiveNumber(value: unknown, field: string, max = Number.POSITIVE_INFINITY): JsonRpcError | undefined {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
    return { code: -32602, message: `Invalid params: ${field} must be positive when provided` };
  }
  if (typeof value === 'number' && value > max) {
    return { code: -32602, message: `Invalid params: ${field} must be between 1 and ${max}` };
  }
  return undefined;
}

function ucpCatalogError(id: unknown, error: unknown): Response {
  const message = error instanceof Error ? error.message : 'UCP catalog request failed';
  if (message.startsWith('Invalid params:')) {
    return rpcError(id, { code: -32602, message });
  }
  return rpcError(id, { code: -32603, message: 'Internal UCP catalog error' });
}

function purchaseHandoffError(id: unknown, error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Purchase handoff failed';
  if (message.startsWith('Invalid params:')) {
    return rpcError(id, { code: -32602, message });
  }
  if (message.startsWith('Lens not found:')) {
    return rpcError(id, { code: -32004, message });
  }
  return rpcError(id, { code: -32603, message: 'Internal purchase handoff error' });
}

function recommendationError(id: unknown, error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Recommendation failed';
  if (message.startsWith('Sensor not found:') || message.startsWith('Lens not found:')) {
    return rpcError(id, { code: -32004, message });
  }
  return rpcError(id, { code: -32603, message: 'Internal recommendation error' });
}

function summarizeLens(lens: LensCatalogItem): Omit<LensCatalogItem, 'source' | 'fixtureDistortion'> {
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
    resolution: lens.resolution,
    projectionModel: lens.projectionModel,
    coefficientCount: lens.coefficientCount,
    datasheet: lens.datasheet,
  };

  if (lens.mechanicalDrawingUrl) {
    summary.mechanicalDrawingUrl = lens.mechanicalDrawingUrl;
  }

  return summary;
}

async function handleMcp(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return json({ error: 'unsupported_media_type' }, { status: 415 });
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_MCP_BODY_BYTES) {
    return json({ error: 'payload_too_large' }, { status: 413 });
  }

  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > MAX_MCP_BODY_BYTES) {
    return json({ error: 'payload_too_large' }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return rpcError(null, { code: -32700, message: 'Parse error' });
  }

  const parsed = validateRpcRequest(payload);
  if ('code' in parsed) {
    const id = isRecord(payload) ? payload.id : null;
    return rpcError(id, parsed);
  }

  if (parsed.method === 'initialize') return initializeResponse(parsed.id);
  if (parsed.method === 'tools/list') return toolListResponse(parsed.id, env);
  if (parsed.method === 'tools/call') return await toolCallResponse(parsed.id, parsed.params, env);
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

    if (url.pathname === '/.well-known/ucp') {
      if (request.method !== 'GET') return methodNotAllowed();
      return json(buildUcpDiscoveryProfile(url.origin));
    }

    if (url.pathname === '/mcp') {
      if (request.method !== 'POST') return methodNotAllowed();
      return handleMcp(request, env);
    }

    return json({ error: 'not_found' }, { status: 404 });
  },
};
