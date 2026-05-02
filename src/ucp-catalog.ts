import { CATALOG_SNAPSHOT, getLensBySku, searchLenses, type LensCatalogItem } from './catalog';
import { buildProductPageDetails } from './product-page';

export const UCP_VERSION = '2026-04-08' as const;

export interface UcpCatalogMessage {
  type: 'info' | 'warning' | 'error';
  code: string;
  text: string;
}

interface UcpPrice {
  amount: number;
  currency: 'USD';
}

interface UcpCatalogVariant {
  id: string;
  sku: string;
  title: string;
  description: { plain: string };
  url: string;
  price: UcpPrice;
  availability: {
    available: boolean;
    status: LensCatalogItem['availability'];
  };
  options: Array<{ name: string; label: string }>;
  metadata: {
    mount: string;
    eflMm: number;
    imageCircleMm: number;
    resolution: string;
    projectionModel: LensCatalogItem['projectionModel'];
  };
}

export interface UcpCatalogProduct {
  id: string;
  handle: string;
  title: string;
  description: { plain: string };
  url: string;
  categories: Array<{ value: string; taxonomy: 'merchant' }>;
  price_range: { min: UcpPrice; max: UcpPrice };
  variants: UcpCatalogVariant[];
  tags: string[];
  metadata: {
    sku: string;
    mount: string;
    lensType: string;
    opticalSource: LensCatalogItem['source']['optical'];
    commerceSource: LensCatalogItem['source']['commerce'];
    mechanicalDrawingUrl?: string;
    datasheet: LensCatalogItem['datasheet'];
  };
}

export interface UcpCatalogResult {
  schemaVersion: 'ucp.catalog.v1';
  generatedAt: string;
  ucp: {
    version: typeof UCP_VERSION;
    capability: 'search_catalog' | 'lookup_catalog' | 'get_product';
    transport: 'mcp';
  };
  catalog: {
    products: UcpCatalogProduct[];
  };
  messages: UcpCatalogMessage[];
  source: {
    mode: 'fixture_static';
    optical: LensCatalogItem['source']['optical'];
    commerce: LensCatalogItem['source']['commerce'];
    liveConnectors: 'not_connected';
  };
}

export interface ShopifyPurchaseHandoff {
  schemaVersion: 'shopify.purchase_handoff.v1';
  correctionStatus: 'fixture_transaction_seam_no_mutation';
  generatedAt: string;
  quantity: number;
  product: {
    sku: string;
    title: string;
    handle: string;
    productUrl: string;
    variantId: string;
    selectedVariantIdSource: 'fixture_commonlands_gid_non_authoritative' | 'caller_supplied_unverified_not_product_truth';
    price: UcpPrice;
    availability: LensCatalogItem['availability'];
  };
  optionalContext: {
    sensorPartNumber?: string;
  };
  productDetails: ReturnType<typeof buildProductPageDetails>;
  transaction: {
    mode: 'read_only_handoff';
    cartCheckout: 'not_created';
    createsCart: false;
    createsCheckout: false;
    writesShopify: false;
    requiresApprovalBeforeLiveMutation: true;
    futureNativePath: 'Shopify Storefront Cart/Checkout or UCP transaction flow after explicit approval';
  };
  warnings: string[];
  provenance: {
    optical: LensCatalogItem['source']['optical'];
    commerce: LensCatalogItem['source']['commerce'];
  };
}

export interface UcpDiscoveryProfile {
  version: typeof UCP_VERSION;
  transport: 'mcp';
  endpoint: string;
  capabilities: [
    'dev.ucp.shopping.catalog.search',
    'dev.ucp.shopping.catalog.lookup',
    'dev.ucp.shopping.cart',
    'dev.ucp.shopping.checkout',
  ];
  schema: {
    name: 'Commonlands catalog, cart, and checkout profile';
    url: string;
  };
  metadata: {
    service: 'commonlands-mcp';
    mode: 'fixture_static_with_shopify_cart_checkout_proxy';
    liveConnectors: 'shopify_cart_checkout_mcp_configured_separately';
    cartPersistence: 'shopify_owned_cart_checkout_id_resume';
    cartBoundary: 'cart_and_checkout_mcp_enabled_authenticated_completion';
  };
}

export function buildUcpDiscoveryProfile(origin: string): UcpDiscoveryProfile {
  return {
    version: UCP_VERSION,
    transport: 'mcp',
    endpoint: `${origin}/mcp`,
    capabilities: [
      'dev.ucp.shopping.catalog.search',
      'dev.ucp.shopping.catalog.lookup',
      'dev.ucp.shopping.cart',
      'dev.ucp.shopping.checkout',
    ],
    schema: {
      name: 'Commonlands catalog, cart, and checkout profile',
      url: `${origin}/schemas/ucp-catalog.json`,
    },
    metadata: {
      service: 'commonlands-mcp',
      mode: 'fixture_static_with_shopify_cart_checkout_proxy',
      liveConnectors: 'shopify_cart_checkout_mcp_configured_separately',
      cartPersistence: 'shopify_owned_cart_checkout_id_resume',
      cartBoundary: 'cart_and_checkout_mcp_enabled_authenticated_completion',
    },
  };
}

export function searchCatalog(args: Record<string, unknown>): UcpCatalogResult {
  const catalog = readCatalogArgs(args);
  const query = typeof catalog.query === 'string' ? catalog.query : '';
  const limit = typeof catalog.limit === 'number' ? catalog.limit : 10;
  return catalogResult('search_catalog', searchLenses(query, limit).map(toUcpCatalogProduct), []);
}

export function lookupCatalog(args: Record<string, unknown>): UcpCatalogResult {
  const catalog = readCatalogArgs(args);
  const ids = readIds(catalog.ids);
  const found: UcpCatalogProduct[] = [];
  const unresolved: string[] = [];

  for (const id of ids) {
    const lens = resolveLensIdentifier(id);
    if (lens) {
      if (!found.some((product) => product.metadata.sku === lens.sku)) {
        found.push(toUcpCatalogProduct(lens));
      }
    } else {
      unresolved.push(id);
    }
  }

  return catalogResult('lookup_catalog', found, unresolvedMessages(unresolved));
}

export function getProduct(args: Record<string, unknown>): UcpCatalogResult {
  const catalog = readCatalogArgs(args);
  const id = typeof catalog.id === 'string' ? catalog.id : undefined;
  if (!id) {
    throw new Error('Invalid params: catalog.id is required');
  }

  const lens = resolveLensIdentifier(id);
  return catalogResult('get_product', lens ? [toUcpCatalogProduct(lens)] : [], unresolvedMessages(lens ? [] : [id]));
}

export function prepareShopifyPurchaseHandoff(args: Record<string, unknown>): ShopifyPurchaseHandoff {
  if (typeof args.sku !== 'string' || args.sku.trim() === '') {
    throw new Error('Invalid params: sku is required');
  }
  if (args.quantity !== undefined && (typeof args.quantity !== 'number' || !Number.isFinite(args.quantity) || args.quantity < 1 || args.quantity > 999)) {
    throw new Error('Invalid params: quantity must be between 1 and 999 when provided');
  }
  if (args.sensorPartNumber !== undefined && typeof args.sensorPartNumber !== 'string') {
    throw new Error('Invalid params: sensorPartNumber must be a string when provided');
  }
  if (args.selectedVariantId !== undefined && typeof args.selectedVariantId !== 'string') {
    throw new Error('Invalid params: selectedVariantId must be a string when provided');
  }

  const lens = getLensBySku(args.sku);
  if (!lens) {
    throw new Error(`Lens not found: ${args.sku}`);
  }

  const quantity = typeof args.quantity === 'number' ? Math.trunc(args.quantity) : 1;
  const fixtureVariantId = variantIdForSku(lens.sku);
  const selectedVariantId = typeof args.selectedVariantId === 'string' && args.selectedVariantId.trim() !== ''
    ? args.selectedVariantId.trim()
    : fixtureVariantId;

  return {
    schemaVersion: 'shopify.purchase_handoff.v1',
    correctionStatus: 'fixture_transaction_seam_no_mutation',
    generatedAt: CATALOG_SNAPSHOT.generatedAt,
    quantity,
    product: {
      sku: lens.sku,
      title: lens.title,
      handle: lens.handle,
      productUrl: lens.productUrl,
      variantId: selectedVariantId,
      selectedVariantIdSource: selectedVariantId === fixtureVariantId ? 'fixture_commonlands_gid_non_authoritative' : 'caller_supplied_unverified_not_product_truth',
      price: toUsdMinorUnits(lens.priceUsd),
      availability: lens.availability,
    },
    optionalContext: {
      ...(typeof args.sensorPartNumber === 'string' ? { sensorPartNumber: args.sensorPartNumber } : {}),
    },
    productDetails: buildProductPageDetails(lens),
    transaction: {
      mode: 'read_only_handoff',
      cartCheckout: 'not_created',
      createsCart: false,
      createsCheckout: false,
      writesShopify: false,
      requiresApprovalBeforeLiveMutation: true,
      futureNativePath: 'Shopify Storefront Cart/Checkout or UCP transaction flow after explicit approval',
    },
    warnings: [
      'No Shopify cart or checkout was created; this is a read-only handoff contract.',
      'Variant IDs are fixture Commonlands IDs and are not live Shopify ProductVariant IDs unless resolved through read_shopify_products.',
      'Cart and checkout tools are exposed but safe-fail until SHOPIFY_CART_MCP_ENDPOINT and SHOPIFY_CHECKOUT_MCP_ENDPOINT are configured.',
      'Live price and availability must be revalidated by Shopify before any future transaction.',
    ],
    provenance: {
      optical: lens.source.optical,
      commerce: lens.source.commerce,
    },
  };
}

export function toUcpCatalogProduct(lens: LensCatalogItem): UcpCatalogProduct {
  const price = toUsdMinorUnits(lens.priceUsd);

  return {
    id: productIdForSku(lens.sku),
    handle: lens.handle,
    title: lens.title,
    description: {
      plain: `${lens.mount} ${lens.lensType} with ${lens.eflMm}mm EFL, f/${lens.fNumber}, ${lens.imageCircleMm}mm image circle, and ${lens.resolution} lens resolution.`,
    },
    url: lens.productUrl,
    categories: [{ value: `Optics > ${lens.mount} lenses`, taxonomy: 'merchant' }],
    price_range: { min: price, max: price },
    variants: [
      {
        id: variantIdForSku(lens.sku),
        sku: lens.sku,
        title: lens.sku,
        description: { plain: lens.title },
        url: lens.productUrl,
        price,
        availability: {
          available: lens.availability === 'in_stock',
          status: lens.availability,
        },
        options: [{ name: 'Part number', label: lens.sku }],
        metadata: {
          mount: lens.mount,
          eflMm: lens.eflMm,
          imageCircleMm: lens.imageCircleMm,
          resolution: lens.resolution,
          projectionModel: lens.projectionModel,
        },
      },
    ],
    tags: [lens.mount, lens.lensType, lens.sku],
    metadata: {
      sku: lens.sku,
      mount: lens.mount,
      lensType: lens.lensType,
      opticalSource: lens.source.optical,
      commerceSource: lens.source.commerce,
      ...(lens.mechanicalDrawingUrl ? { mechanicalDrawingUrl: lens.mechanicalDrawingUrl } : {}),
      datasheet: lens.datasheet,
    },
  };
}

function catalogResult(
  capability: UcpCatalogResult['ucp']['capability'],
  products: UcpCatalogProduct[],
  messages: UcpCatalogMessage[],
): UcpCatalogResult {
  return {
    schemaVersion: 'ucp.catalog.v1',
    generatedAt: CATALOG_SNAPSHOT.generatedAt,
    ucp: { version: UCP_VERSION, capability, transport: 'mcp' },
    catalog: { products },
    messages,
    source: {
      mode: 'fixture_static',
      optical: 'fixture:dynamodb-audit',
      commerce: 'fixture:shopify-products-sheet',
      liveConnectors: 'not_connected',
    },
  };
}

function readCatalogArgs(args: Record<string, unknown>): Record<string, unknown> {
  if (args.catalog === undefined) return {};
  if (typeof args.catalog !== 'object' || args.catalog === null || Array.isArray(args.catalog)) {
    throw new Error('Invalid params: catalog must be an object when provided');
  }
  return args.catalog as Record<string, unknown>;
}

function readIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10 || value.some((id) => typeof id !== 'string' || id.trim() === '')) {
    throw new Error('Invalid params: catalog.ids must include 1-10 identifiers');
  }
  return value.map((id) => id.trim());
}

function resolveLensIdentifier(identifier: string): LensCatalogItem | undefined {
  const normalized = identifier.trim();
  const skuFromGid = normalized.match(/^gid:\/\/commonlands\/(?:Product|ProductVariant)\/([^/]+)$/i)?.[1];
  if (skuFromGid) return getLensBySku(skuFromGid);

  const bySku = getLensBySku(normalized);
  if (bySku) return bySku;

  const lower = normalized.toLowerCase();
  return CATALOG_SNAPSHOT.lenses.find((lens) => lens.handle.toLowerCase() === lower || lens.productUrl.toLowerCase() === lower);
}

function unresolvedMessages(ids: string[]): UcpCatalogMessage[] {
  return ids.map((id) => ({
    type: 'info',
    code: 'not_found',
    text: `No fixture catalog product matched ${id}.`,
  }));
}

function productIdForSku(sku: string): string {
  return `gid://commonlands/Product/${sku}`;
}

function variantIdForSku(sku: string): string {
  return `gid://commonlands/ProductVariant/${sku}`;
}

function toUsdMinorUnits(priceUsd: number): UcpPrice {
  return { amount: Math.round(priceUsd * 100), currency: 'USD' };
}
