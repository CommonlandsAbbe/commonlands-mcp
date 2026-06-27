import {
  assertSafePublicCatalogUrls,
  CATALOG_SNAPSHOT,
  FIXTURE_NOT_PRODUCT_TRUTH_WARNING,
  getKnownSensorPartNumbers,
  getLensBySku,
  getSensorByPartNumber,
  searchLenses,
  type LensCatalogItem,
  type SensorCatalogItem,
} from './catalog';
import {
  getLiveSensorByPartNumber,
  isSensorStoreConfigured,
  listLiveSensors,
} from './sensor-store';
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
  FOV_BACKEND_SCANS_FULL_CATALOG?: string;
  SENSOR_DDB_TABLE?: string;
  SENSOR_DDB_REGION?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_SESSION_TOKEN?: string;
  MCP_ANALYTICS?: AnalyticsEngineDataset;
}

interface AnalyticsEngineDataset {
  writeDataPoint(dataPoint: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
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
  data?: unknown;
}

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
}

interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
}

const SERVER_INFO = {
  name: 'commonlands-mcp',
  version: '0.1.1',
} as const;

const PUBLIC_MCP_ENDPOINT = 'https://mcp.commonlands.com/mcp';
const PROTOCOL_VERSION = '2025-11-25';
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
const MAX_MCP_BODY_BYTES = 64 * 1024;
const SAFE_IDENTIFIER_PATTERN = /^[A-Z0-9-]{2,32}$/;
const MAX_WORKING_DISTANCE_MM = 100_000;
const FOV_BACKEND_TIMEOUT_MS = 4_000;
const FOV_BACKEND_MAX_RESPONSE_BYTES = 128 * 1024;
const FOV_SINGLE_MAX_RESULTS = 10;
const FOV_CATALOG_MAX_RESULTS = 250;
const UNKNOWN_ANALYTICS_VALUE = 'unknown';
const FOV_COMPUTATION_RULE =
  'FoV rule: catalog EFL, image circle, max FoV/FOV@image-circle, and distortion display fields are insufficient to compute field of view on a specific sensor; do not interpolate or estimate interior sensor FoV from those fields. Always call compute_fov for one lens/sensor pair or compute_fov_catalog for catalog-wide per-sensor HFOV/VFOV/DFOV.';

const SERVER_INSTRUCTIONS = [
  `Commonlands MCP public endpoint is ${PUBLIC_MCP_ENDPOINT}. Use this endpoint in client configuration, metadata, and agent-facing descriptions.`,
  'Commonlands MCP helps agents select precision optics for machine vision, robotics, and embedded vision: M12 lenses, C-mount lenses, and lens field of view calculations.',
  'Usage flow: discover lenses with search_lenses/search_catalog, inspect details with get_lens_details/get_product, compute lens field of view with compute_fov or compute_fov_catalog, rank options with match_lenses_to_sensor/compare_lenses/recommend_lenses_for_application, then use read_shopify_products for live purchasable truth before quoting price, availability, Shopify variantId, product URL, or cart payloads.',
  FOV_COMPUTATION_RULE,
  'Do not run DIY optics math, interpolate catalog FoV, infer coverage, or assemble sensor-specific optical numbers outside Commonlands MCP computed responses.',
  'Source-labeling policy: label every optical or commerce claim with its source; preserve returned provenance.method, provenance.rev, coverage class, distortion-at-field-edge status, and Shopify live-read versus fixture/source-warning distinctions.',
  'For sensor-specific lens finding, prefer compute_fov_catalog first when the user gives a sensor or target FoV; its results already include per-sensor HFOV/VFOV/DFOV, image-circle coverage signals, sanitized provenance/source metadata, and backend errors where available. Use search_lenses/search_catalog only for broad SKU/title/mount discovery.',
  'Safety boundaries: fixture-backed tools are scaffold/context only; Shopify product/cart truth is read-only unless approved cart tools are explicitly listed in tools/list; cancel, checkout, payment, customer, order, inventory, and product writes remain hidden/gated unless separately approved. Do not pass arbitrary URLs or client-supplied downstream tokens; Commonlands uses fixed allowlisted endpoints and server-side secrets only, and does not accept client-supplied downstream tokens.',
].join(' ');

const TOOLS: ToolDefinition[] = [
  {
    name: 'search_lenses',
    title: 'Search Commonlands lenses',
    description:
      `Search the fixture-backed Commonlands lens catalog snapshot by SKU, title, mount, lens type, M12 lenses, C-mount lenses, or machine-vision application. Use this only for broad discovery; when a sensor or target FoV is involved, call compute_fov_catalog or compute_fov instead of estimating from catalog fields. ${FOV_COMPUTATION_RULE} Use read_shopify_products for live purchasable product truth.`,
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
    description: `Return fixture-backed public product and optical metadata for one Commonlands lens SKU, including mount, focal length, image circle, resolution, and machine-vision lens context. These fields are not enough for sensor-specific FoV; call compute_fov for the lens/sensor pair. ${FOV_COMPUTATION_RULE} Use read_shopify_products for live product, price, availability, variant IDs, and metafields.`,
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
    description: `Return sensor dimensions, pixel pitch, and resolution for lens field of view, M12 lens, and C-mount lens matching inputs. In production this uses the read-only live sensor table when configured, with fixture fallback when unavailable. Use these specs as inputs to compute_fov or compute_fov_catalog, not as a reason to hand-calculate FoV. ${FOV_COMPUTATION_RULE}`,
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
      `Compute lens field of view for a Commonlands lens and sensor pair, including horizontal, vertical, and diagonal FoV when available. This is the required path for sensor-specific FoV. Supports M12 lenses and C-mount lenses. Uses the authenticated live FoV backend when configured; otherwise fixture-backed scaffold data. ${FOV_COMPUTATION_RULE} Verify purchasable facts with read_shopify_products.`,
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
      `Compute lens field of view for the available Commonlands M12 lens and C-mount lens catalog on one sensor. Prefer this first for "find lenses for this sensor/target FoV" requests because each result already carries per-sensor HFOV/VFOV/DFOV and coverage/provenance context when available. Uses the authenticated live FoV backend when configured and returns sanitized FoV/catalog fields only; raw distortion coefficients are never returned. ${FOV_COMPUTATION_RULE}`,
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
      `Rank fixture catalog M12 lenses and C-mount lenses for one sensor using image-circle coverage, lens field of view target fit, and deterministic optical tradeoffs. Use as a shortlist helper, then call compute_fov or compute_fov_catalog for customer-facing sensor-specific FoV. ${FOV_COMPUTATION_RULE} Not live product truth; verify purchasable facts with read_shopify_products.`,
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
    description: `Compare selected fixture-backed Commonlands M12 lens and C-mount lens SKUs on the same sensor with the same deterministic scoring model. Use as explanatory context, then call compute_fov for final sensor-specific FoV values when precision matters. ${FOV_COMPUTATION_RULE} Not live product truth; verify purchasable facts with read_shopify_products.`,
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
      `Return fixture-backed product-page handoff details for one lens, including DynamoDB-sourced optical specs and gated datasheet policy. Product-page/catalog optical fields are not a substitute for sensor-specific FoV; call compute_fov for the lens/sensor pair. ${FOV_COMPUTATION_RULE} Use read_shopify_products for live product URL, price, availability, variant IDs, and metafields.`,
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
      `Fixture-backed UCP Catalog search alias for Shopify-native product discovery; no live Shopify calls or cart behavior. Use this only for broad discovery; when a sensor or target FoV is involved, call compute_fov_catalog or compute_fov instead of estimating from catalog fields. ${FOV_COMPUTATION_RULE}`,
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
      `Fixture-backed UCP Catalog lookup alias for product, variant, SKU, handle, or URL identifiers; returns not-found messages instead of writes. Lookup records are not enough for sensor-specific FoV; call compute_fov for known lens/sensor pairs. ${FOV_COMPUTATION_RULE}`,
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
      `Fixture-backed UCP Catalog product detail alias with Commonlands optical metadata and Shopify-native handoff fields. Product optical fields are not a substitute for sensor-specific FoV; call compute_fov for the lens/sensor pair. ${FOV_COMPUTATION_RULE}`,
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
      `Build a read-only Shopify-native purchase handoff seam for a selected lens without creating carts, checkout, orders, inventory mutations, or writes. Preserve any computed FoV provenance from compute_fov/compute_fov_catalog when carrying optical context into purchase handoff. ${FOV_COMPUTATION_RULE}`,
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
      `Return safe dual-channel purchase route options for AI agents and robotics engineers across Commonlands MCP and Shopify-native channels without mutating commerce state. This explains commerce routes only; call compute_fov/compute_fov_catalog for sensor-specific FoV before recommending a lens. ${FOV_COMPUTATION_RULE}`,
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
      `Rank fixture catalog M12 lenses and C-mount lenses for an application note such as embedded robotics, machine-vision inspection, or a required lens field of view. Use as an application shortlist helper, then call compute_fov_catalog or compute_fov for final per-sensor HFOV/VFOV/DFOV. ${FOV_COMPUTATION_RULE}`,
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
    uri: 'commonlands://server/connection',
    name: 'Commonlands MCP public connection metadata',
    description: `Canonical public MCP endpoint: ${PUBLIC_MCP_ENDPOINT}. Use this URL for clients, metadata, and agent-facing descriptions; localhost is local-development only.`,
    mimeType: 'application/json',
  },
  {
    uri: 'commonlands://catalog/lenses',
    name: 'Commonlands M12 and C-mount lens catalog snapshot',
    description: 'Fixture-backed Phase 1 joined catalog of Commonlands M12 lenses, C-mount lenses, focal lengths, mounts, image circles, and product handoff fields.',
    mimeType: 'application/json',
  },
  {
    uri: 'commonlands://catalog/sensors',
    name: 'Commonlands sensor catalog',
    description: 'Sensor catalog for lens field of view inputs: active area, resolution, and pixel pitch. Tool calls prefer the read-only live sensor table when configured, with fixture fallback when unavailable.',
    mimeType: 'application/json',
  },
  {
    uri: 'commonlands://catalog/snapshot-status',
    name: 'Commonlands joined catalog snapshot status',
    description: 'Fixture-backed catalog validation, join counts, source provenance, connector-readiness status, and product-truth boundaries for M12/C-mount lens recommendations.',
    mimeType: 'application/json',
  },
  {
    uri: 'commonlands://compatibility/shopify-ucp',
    name: 'Commonlands Shopify Storefront/UCP readiness',
    description: 'Compatibility report for Shopify Storefront MCP and UCP Catalog launch planning, including read-only product truth and approved Shopify-owned cart boundaries.',
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
    telemetry: {
      analyticsEngine: env.MCP_ANALYTICS ? 'configured' : 'disabled',
    },
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

function methodNameForTelemetry(method: unknown): string {
  return typeof method === 'string' && method.trim() !== '' ? method.trim().slice(0, 80) : UNKNOWN_ANALYTICS_VALUE;
}

function toolNameForTelemetry(method: unknown, params: unknown): string {
  if (method !== 'tools/call' || !isRecord(params) || typeof params.name !== 'string' || params.name.trim() === '') {
    return UNKNOWN_ANALYTICS_VALUE;
  }

  return params.name.trim().slice(0, 80);
}

function clientNameForTelemetry(request: Request): string {
  const explicit = request.headers.get('mcp-client-name') ?? request.headers.get('x-mcp-client') ?? request.headers.get('x-client-name');
  if (explicit && explicit.trim() !== '') return explicit.trim().slice(0, 80);

  const userAgent = request.headers.get('user-agent') ?? '';
  if (userAgent.trim() === '') return UNKNOWN_ANALYTICS_VALUE;
  return userAgent.split(/[\s/]/u).find(Boolean)?.slice(0, 80) ?? UNKNOWN_ANALYTICS_VALUE;
}

function responseStatusForTelemetry(response: Response): string {
  if (response.status >= 500) return 'http_5xx';
  if (response.status >= 400) return 'http_4xx';
  return 'ok';
}

async function jsonRpcStatusForTelemetry(response: Response): Promise<string> {
  if (response.status >= 400) return responseStatusForTelemetry(response);

  try {
    const body = (await response.clone().json()) as unknown;
    if (isRecord(body) && isRecord(body.error)) {
      const code = typeof body.error.code === 'number' ? body.error.code : 'unknown';
      return `jsonrpc_error_${code}`;
    }
  } catch {
    return responseStatusForTelemetry(response);
  }

  return 'ok';
}

async function writeMcpTelemetry(env: Env, request: Request, payload: JsonRpcRequest | null, response: Response, startedAt: number): Promise<void> {
  if (!env.MCP_ANALYTICS) return;

  try {
    const method = methodNameForTelemetry(payload?.method);
    env.MCP_ANALYTICS.writeDataPoint({
      blobs: [
        request.method,
        new URL(request.url).pathname,
        method,
        toolNameForTelemetry(payload?.method, payload?.params),
        await jsonRpcStatusForTelemetry(response),
        clientNameForTelemetry(request),
        env.ENVIRONMENT ?? UNKNOWN_ANALYTICS_VALUE,
        env.VERSION ?? UNKNOWN_ANALYTICS_VALUE,
      ],
      doubles: [response.status, Date.now() - startedAt],
      indexes: [method],
    });
  } catch {
    // Telemetry must never block public MCP responses or expose request payloads.
  }
}

// Build a generalizable "sensor not found" error. The fixture only carries a small
// set of reference sensors; agents routinely ask for parts outside it (IMX577, etc.).
// Returning the available part numbers in `data` lets callers self-correct instead of
// retrying blindly. Do NOT hardcode one-off sensors here — the list is derived from the
// snapshot so it stays correct as the catalog grows.
function sensorNotFoundError(requested?: string, available: string[] = getKnownSensorPartNumbers()): JsonRpcError {
  const suffix = typeof requested === 'string' && requested.trim() !== '' ? `: ${requested}` : '';
  return {
    code: -32004,
    message: `Sensor not found${suffix}`,
    data: {
      requestedPartNumber: typeof requested === 'string' ? requested : null,
      availableSensorPartNumbers: available,
      hint: 'Use one of availableSensorPartNumbers, or provide explicit sensor dimensions to the FoV tools.',
    },
  };
}

// Resolve a sensor by part number, preferring the live DynamoDB sensor table
// (real pixel size/count) and falling back to the in-code reference fixture when
// the store is unconfigured or the part is absent there. Centralizes the lookup so
// every tool path uses the same source-of-truth ordering.
async function resolveSensor(env: Env, partNumber: string): Promise<SensorCatalogItem | undefined> {
  if (isSensorStoreConfigured(env)) {
    try {
      const live = await getLiveSensorByPartNumber(env, partNumber);
      if (live) return live;
    } catch (error) {
      console.error('[Sensor Store] lookup failed, falling back to fixture:', error);
    }
  }
  return getSensorByPartNumber(partNumber);
}

// Build a sensor-not-found error whose availableSensorPartNumbers reflects the live
// table when configured (so agents see the real catalogue), else the fixture set.
async function sensorNotFoundErrorAsync(env: Env, requested?: string): Promise<JsonRpcError> {
  let available = getKnownSensorPartNumbers();
  if (isSensorStoreConfigured(env)) {
    try {
      const live = await listLiveSensors(env);
      if (live.length > 0) available = live.map((sensor) => sensor.partNumber);
    } catch (error) {
      console.error('[Sensor Store] list failed, using fixture list for error hint:', error);
    }
  }
  return sensorNotFoundError(requested, available);
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

// A JSON-RPC notification is a request with no id. The MCP client also namespaces
// lifecycle notifications under notifications/* (for example notifications/initialized,
// notifications/cancelled). Either signal means "do not send a response object".
function isJsonRpcNotification(request: JsonRpcRequest): boolean {
  if (typeof request.method === 'string' && request.method.startsWith('notifications/')) {
    return true;
  }
  return request.id === undefined;
}

function acceptedNotification(): Response {
  return new Response(null, {
    status: 202,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function initializeResponse(id: unknown, params: unknown): Response {
  return rpcResult(id, {
    protocolVersion: negotiateProtocolVersion(params),
    capabilities: {
      tools: {},
      resources: {},
    },
    serverInfo: SERVER_INFO,
    instructions: SERVER_INSTRUCTIONS,
  });
}

function negotiateProtocolVersion(params: unknown): string {
  if (isRecord(params) && typeof params.protocolVersion === 'string') {
    const requested = params.protocolVersion;
    if (SUPPORTED_PROTOCOL_VERSIONS.includes(requested as typeof SUPPORTED_PROTOCOL_VERSIONS[number])) {
      return requested;
    }
  }

  return PROTOCOL_VERSION;
}

function toolListResponse(id: unknown, env: Env): Response {
  return rpcResult(id, { tools: visibleTools(env) });
}

function visibleTools(env: Env): ToolDefinition[] {
  return TOOLS.filter((tool) => isToolEnabled(tool.name, env)).map(withToolAnnotations);
}

function isToolEnabled(name: string, env: Env): boolean {
  if (name === 'cancel_cart' && !cartEndpointSupportsCancel(env)) return false;
  if (isCartTool(name)) return env.ENABLE_COMMERCE_MUTATION_TOOLS === 'true';
  if (name === 'create_checkout' || name === 'get_checkout') return env.ENABLE_CHECKOUT_MUTATION_TOOLS === 'true';
  if (name === 'update_checkout' || name === 'complete_checkout' || name === 'cancel_checkout') return env.ENABLE_EXTRA_CHECKOUT_MUTATION_TOOLS === 'true';
  return true;
}

const WRITE_TOOL_NAMES = new Set([
  'create_cart',
  'get_cart',
  'update_cart',
  'cancel_cart',
  'create_checkout',
  'get_checkout',
  'update_checkout',
  'complete_checkout',
  'cancel_checkout',
]);

function withToolAnnotations(tool: ToolDefinition): ToolDefinition {
  const writes = WRITE_TOOL_NAMES.has(tool.name);
  return {
    ...tool,
    annotations: {
      title: tool.title,
      readOnlyHint: !writes,
      destructiveHint: writes,
    },
  };
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

    const sensor = await resolveSensor(env, args.partNumber);
    if (!sensor) {
      return rpcError(id, await sensorNotFoundErrorAsync(env, args.partNumber));
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
    const sensor = await resolveSensor(env, sensorPartNumber);
    if (!sensor) {
      return rpcError(id, await sensorNotFoundErrorAsync(env, sensorPartNumber));
    }

    const workingDistanceMm = typeof args.workingDistanceMm === 'number' ? args.workingDistanceMm : undefined;

    if (isFovLiveBackendEnabled(env)) {
      const liveInput: LiveFovInput = {
        lensSku,
        sensorPartNumber,
        sensor,
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

    return toolResult(id, buildFixtureSingleFovResponse(lens, sensor, workingDistanceMm));
  }

  if (params.name === 'compute_fov_catalog') {
    const sensorError = validateSafeIdentifier(args.sensorPartNumber, 'sensorPartNumber');
    if (sensorError) return rpcError(id, sensorError);
    const distanceError = validateOptionalPositiveNumber(args.workingDistanceMm, 'workingDistanceMm', MAX_WORKING_DISTANCE_MM);
    if (distanceError) return rpcError(id, distanceError);

    const sensorPartNumber = normalizeSafeIdentifier(args.sensorPartNumber as string);
    const sensor = await resolveSensor(env, sensorPartNumber);
    if (!sensor) {
      return rpcError(id, await sensorNotFoundErrorAsync(env, sensorPartNumber));
    }

    const workingDistanceMm = typeof args.workingDistanceMm === 'number' ? args.workingDistanceMm : undefined;

    if (isFovLiveBackendEnabled(env)) {
      const liveInput: LiveFovInput = {
        sensorPartNumber,
        sensor,
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
      provenance: {
        method: 'fixture_parity_scaffold',
        rev: 'fixture-polynomial-fov-0.1.0',
        source: 'fixture-catalog',
      },
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

// When true, catalog-mode compute_fov_catalog omits partNums and lets the FoV
// backend scan its full DynamoDB lens table (requires ALLOW_LENS_SCAN on the
// Lambda). When false, the Worker sends the in-code fixture SKUs as a fallback so
// the request still resolves. Keeps Worker and Lambda lens-scan config in lockstep.
function fovBackendScansFullCatalog(env: Env): boolean {
  return env.FOV_BACKEND_SCANS_FULL_CATALOG === 'true';
}

interface LiveFovInput {
  lensSku?: string;
  sensorPartNumber: string;
  workingDistanceMm?: number;
  // Already-resolved sensor (live DynamoDB table or fixture). When provided, the
  // live backend uses these real dimensions instead of re-looking-up the fixture,
  // so DB-sourced pixel size/count flow into the FoV computation.
  sensor?: SensorCatalogItem;
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
  fov?: {
    horizontalDeg?: number;
    verticalDeg?: number;
    diagonalDeg?: number;
  };
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
  distortionAtFieldEdge?: DistortionAtFieldEdge;
  pixpitch?: number;
  coverageClass?: CoverageClass;
  coverage?: CoverageMetadata;
  provenance?: {
    method: string;
    rev: string;
    source: string;
  };
}

type CoverageClass = 'full' | 'inscribed' | 'cropped' | 'unknown';

interface CoverageMetadata {
  class: CoverageClass;
  pixelCounts: {
    sensorPixels: number;
    coveredPixels?: number;
    croppedPixels?: number;
    widthPx?: number;
    heightPx?: number;
    coveredWidthPx?: number;
    coveredHeightPx?: number;
  };
}

interface DistortionAtFieldEdge {
  display?: string;
  valuePercent?: number;
  axis?: 'diagonal' | 'horizontal' | 'vertical' | 'max_axis';
  status: 'source_display_only' | 'calculated' | 'unavailable';
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

  const sensor = input.sensor ?? getSensorByPartNumber(input.sensorPartNumber);
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
    // Single mode targets one SKU. Catalog mode prefers the backend's full lens table
    // (the Lambda scans its DynamoDB lens catalog when no partNums are sent and
    // ALLOW_LENS_SCAN is enabled), so FoV covers the whole live catalog rather than the
    // small in-code fixture. When the backend scan is not enabled, fall back to sending
    // the fixture SKUs so the request still resolves instead of 400 missing_lenses.
    ...(input.lensSku
      ? { partNums: [input.lensSku] }
      : fovBackendScansFullCatalog(env)
        ? {}
        : { partNums: CATALOG_SNAPSHOT.lenses.map((lens) => lens.sku).slice(0, FOV_CATALOG_MAX_RESULTS) }),
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

  if (!response.ok) {
    const isAuth = response.status === 401 || response.status === 403;
    return {
      error: {
        code: isAuth ? -32001 : -32603,
        message: isAuth
          ? 'Live FoV backend rejected request: authentication failed'
          : `Live FoV backend rejected request (upstream HTTP ${response.status})`,
        data: {
          upstreamStatus: response.status,
          stage: 'live_fov_backend_response',
        },
      },
    };
  }

  const parsed = await readJsonWithLimit<LiveFovResponse>(response, 'Live FoV backend', {
    maxBytes: FOV_BACKEND_MAX_RESPONSE_BYTES,
  });
  if ('error' in parsed) {
    return { error: { code: -32603, message: 'Live FoV backend returned invalid response' } };
  }

  const resultLimit = input.lensSku ? FOV_SINGLE_MAX_RESULTS : FOV_CATALOG_MAX_RESULTS;
  const sanitizedLenses = addFovLensMetadata(
    sanitizeFovLenses(parsed.data.lenses, resultLimit),
    sensor,
    {
      method: 'lambda_dynamodb_fov_backend',
      rev: 'lambda-dynamodb-fov-0.1.0',
      source: 'aws-lambda-dynamodb-readonly',
    },
  );
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
      provenance: {
        method: 'lambda_dynamodb_fov_backend',
        rev: 'lambda-dynamodb-fov-0.1.0',
        source: 'aws-lambda-dynamodb-readonly',
      },
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
  const hfov = firstNumber(lens.hfov, lens.horizontalFovDeg);
  const vfov = firstNumber(lens.vfov, lens.verticalFovDeg);
  const dfov = firstNumber(lens.dfov, lens.diagonalFovDeg);
  const sanitized: SanitizedFovLens = {
    ...(partNum ? { partNum } : {}),
    ...numberField('hfov', hfov),
    ...numberField('vfov', vfov),
    ...numberField('dfov', dfov),
    ...fovField(hfov, vfov, dfov),
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
  if (distortion) {
    sanitized.distortion = distortion;
    sanitized.distortionAtFieldEdge = summarizeDistortionAtFieldEdge(distortion);
  }
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

function fovField(
  horizontalDeg: number | undefined,
  verticalDeg: number | undefined,
  diagonalDeg: number | undefined,
): Pick<SanitizedFovLens, 'fov'> {
  if (horizontalDeg === undefined && verticalDeg === undefined && diagonalDeg === undefined) return {};
  return {
    fov: {
      ...(horizontalDeg !== undefined ? { horizontalDeg } : {}),
      ...(verticalDeg !== undefined ? { verticalDeg } : {}),
      ...(diagonalDeg !== undefined ? { diagonalDeg } : {}),
    },
  };
}

function summarizeDistortionAtFieldEdge(
  distortion: NonNullable<SanitizedFovLens['distortion']>,
): DistortionAtFieldEdge {
  if (distortion.diagonal !== undefined) {
    return {
      ...(distortion.display ? { display: distortion.display } : {}),
      valuePercent: distortion.diagonal,
      axis: 'diagonal',
      status: distortion.status,
    };
  }

  const axes = [
    ['horizontal', distortion.horizontal] as const,
    ['vertical', distortion.vertical] as const,
  ].filter((entry): entry is readonly ['horizontal' | 'vertical', number] => entry[1] !== undefined);
  if (axes.length > 0) {
    const [axis, value] = axes.reduce((max, entry) => Math.abs(entry[1]) > Math.abs(max[1]) ? entry : max);
    return {
      ...(distortion.display ? { display: distortion.display } : {}),
      valuePercent: value,
      axis: axes.length === 1 ? axis : 'max_axis',
      status: distortion.status,
    };
  }

  return {
    ...(distortion.display ? { display: distortion.display } : {}),
    status: distortion.status,
  };
}

function unavailableDistortionAtFieldEdge(): DistortionAtFieldEdge {
  return { status: 'unavailable' };
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

function buildCoverageMetadata(
  sensor: NonNullable<ReturnType<typeof getSensorByPartNumber>>,
  imageCircleMm: number | undefined,
): CoverageMetadata {
  const widthPx = sensor.resolution.widthPx;
  const heightPx = sensor.resolution.heightPx;
  const sensorPixels = widthPx * heightPx;

  if (imageCircleMm === undefined) {
    return {
      class: 'unknown',
      pixelCounts: { sensorPixels },
    };
  }

  const sensorDiagonalMm = Math.hypot(sensor.activeAreaMm.width, sensor.activeAreaMm.height);
  if (imageCircleMm >= sensorDiagonalMm) {
    return {
      class: 'full',
      pixelCounts: {
        sensorPixels,
        coveredPixels: sensorPixels,
        croppedPixels: 0,
        widthPx,
        heightPx,
        coveredWidthPx: widthPx,
        coveredHeightPx: heightPx,
      },
    };
  }

  const scale = Math.max(0, Math.min(1, imageCircleMm / sensorDiagonalMm));
  const coveredWidthPx = Math.floor(widthPx * scale);
  const coveredHeightPx = Math.floor(heightPx * scale);
  const coveredPixels = coveredWidthPx * coveredHeightPx;

  return {
    class: 'inscribed',
    pixelCounts: {
      sensorPixels,
      coveredPixels,
      croppedPixels: sensorPixels - coveredPixels,
      widthPx,
      heightPx,
      coveredWidthPx,
      coveredHeightPx,
    },
  };
}

function coverageFields(coverage: CoverageMetadata): Pick<SanitizedFovLens, 'coverageClass' | 'coverage'> {
  return {
    coverageClass: coverage.class,
    coverage,
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
    imageCircle?: { clipped?: boolean };
    sensor?: NonNullable<ReturnType<typeof getSensorByPartNumber>>;
  };
  const distortion = { display: lens.fixtureDistortion?.notes ?? 'fixture distortion scaffold', status: 'source_display_only' } as const;
  const imageCircleMm = result.lens?.imageCircleMm ?? lens.imageCircleMm;
  const sanitized: SanitizedFovLens = {
    partNum: lens.sku,
    efl: result.lens?.eflMm ?? lens.eflMm,
    imageCircle: imageCircleMm,
    lensType: lens.lensType,
    mount: lens.mount,
    resolution: lens.resolution,
    fNumber: result.lens?.fNumber ?? lens.fNumber,
    url: lens.productUrl,
    distortion,
    distortionAtFieldEdge: summarizeDistortionAtFieldEdge(distortion),
    provenance: {
      method: 'fixture_parity_scaffold',
      rev: 'fixture-polynomial-fov-0.1.0',
      source: 'fixture-catalog',
    },
  };
  if (result.fov?.horizontalDeg !== undefined) sanitized.hfov = result.fov.horizontalDeg;
  if (result.fov?.verticalDeg !== undefined) sanitized.vfov = result.fov.verticalDeg;
  if (result.fov?.diagonalDeg !== undefined) sanitized.dfov = result.fov.diagonalDeg;
  Object.assign(sanitized, fovField(result.fov?.horizontalDeg, result.fov?.verticalDeg, result.fov?.diagonalDeg));
  if (result.sensor) {
    Object.assign(sanitized, coverageFields(buildCoverageMetadata(result.sensor, imageCircleMm)));
  }
  return sanitized;
}

function buildFixtureSingleFovResponse(
  lens: LensCatalogItem,
  sensor: NonNullable<ReturnType<typeof getSensorByPartNumber>>,
  workingDistanceMm: number | undefined,
): Record<string, unknown> {
  const result = computeFov(lens, sensor, workingDistanceMm);
  const coverage = buildCoverageMetadata(sensor, result.imageCircle.lensImageCircleMm);
  const distortion = result.lens.fixtureDistortion
    ? { display: result.lens.fixtureDistortion.notes, status: 'source_display_only' } as const
    : undefined;

  return {
    ...result,
    ...coverageFields(coverage),
    distortionAtFieldEdge: distortion ? summarizeDistortionAtFieldEdge(distortion) : unavailableDistortionAtFieldEdge(),
    provenance: {
      method: 'fixture_parity_scaffold',
      rev: result.modelVersion,
      source: 'fixture-catalog',
    },
    sourceWarning: FIXTURE_NOT_PRODUCT_TRUTH_WARNING,
  };
}

function addFovLensMetadata(
  lenses: SanitizedFovLens[],
  sensor: NonNullable<ReturnType<typeof getSensorByPartNumber>>,
  provenance: SanitizedFovLens['provenance'],
): SanitizedFovLens[] {
  return lenses.map((lens) => {
    const coverage = buildCoverageMetadata(sensor, lens.imageCircle);
    return {
      ...lens,
      ...coverageFields(coverage),
      distortionAtFieldEdge: lens.distortion ? summarizeDistortionAtFieldEdge(lens.distortion) : unavailableDistortionAtFieldEdge(),
      ...(provenance ? { provenance } : {}),
    };
  });
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
  const startedAt = Date.now();
  let parsedForTelemetry: JsonRpcRequest | null = null;
  let response: Response;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    response = json({ error: 'unsupported_media_type' }, { status: 415 });
    await writeMcpTelemetry(env, request, parsedForTelemetry, response, startedAt);
    return response;
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_MCP_BODY_BYTES) {
    response = json({ error: 'payload_too_large' }, { status: 413 });
    await writeMcpTelemetry(env, request, parsedForTelemetry, response, startedAt);
    return response;
  }

  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > MAX_MCP_BODY_BYTES) {
    response = json({ error: 'payload_too_large' }, { status: 413 });
    await writeMcpTelemetry(env, request, parsedForTelemetry, response, startedAt);
    return response;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    response = rpcError(null, { code: -32700, message: 'Parse error' });
    await writeMcpTelemetry(env, request, parsedForTelemetry, response, startedAt);
    return response;
  }

  const parsed = validateRpcRequest(payload);
  if ('code' in parsed) {
    const id = isRecord(payload) ? payload.id : null;
    parsedForTelemetry = isRecord(payload) ? payload : null;
    response = rpcError(id, parsed);
    await writeMcpTelemetry(env, request, parsedForTelemetry, response, startedAt);
    return response;
  }

  parsedForTelemetry = parsed;

  // JSON-RPC notifications carry no id and MUST NOT receive a response object.
  // Per the MCP lifecycle the client sends notifications/initialized (and may send
  // other notifications/*) after initialize; acknowledge with 202 and an empty body
  // instead of replying "Method not found".
  if (isJsonRpcNotification(parsed)) {
    response = acceptedNotification();
    await writeMcpTelemetry(env, request, parsedForTelemetry, response, startedAt);
    return response;
  }

  if (parsed.method === 'initialize') response = initializeResponse(parsed.id, parsed.params);
  else if (parsed.method === 'tools/list') response = toolListResponse(parsed.id, env);
  else if (parsed.method === 'tools/call') response = await toolCallResponse(parsed.id, parsed.params, env);
  else if (parsed.method === 'resources/list') response = resourceListResponse(parsed.id);
  else if (parsed.method === 'resources/read') response = resourceReadResponse(parsed.id, parsed.params);
  else {
    response = rpcError(parsed.id, {
      code: -32601,
      message: `Method not found: ${parsed.method}`,
    });
  }

  await writeMcpTelemetry(env, request, parsedForTelemetry, response, startedAt);
  return response;
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
