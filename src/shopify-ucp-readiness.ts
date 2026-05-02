import { CATALOG_SNAPSHOT, type CatalogSnapshot, type LensCatalogItem } from './catalog';

const UCP_VERSION = '2026-04-08';

interface UcpPrice {
  amount: number;
  currency: 'USD';
}

interface UcpCatalogProduct {
  id: string;
  handle: string;
  title: string;
  description: {
    plain: string;
  };
  url: string;
  categories: Array<{
    value: string;
    taxonomy: 'merchant';
  }>;
  price_range: {
    min: UcpPrice;
    max: UcpPrice;
  };
  variants: Array<{
    id: string;
    sku: string;
    title: string;
    description: {
      plain: string;
    };
    url: string;
    price: UcpPrice;
    availability: {
      available: boolean;
      status: 'in_stock' | 'out_of_stock' | 'unknown';
    };
    options: Array<{
      name: string;
      label: string;
    }>;
    metadata: {
      mount: string;
      eflMm: number;
      imageCircleMm: number;
      resolution: string;
      projectionModel: LensCatalogItem['projectionModel'];
    };
  }>;
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

export interface ShopifyUcpReadiness {
  schemaVersion: 'shopify.ucp_readiness.v1';
  generatedAt: string;
  compatibilityTarget: {
    shopifyStorefrontMcp: 'storefront-mcp';
    ucpCatalogVersion: typeof UCP_VERSION;
    referenceTools: ['search_catalog', 'lookup_catalog', 'get_product'];
    nonGoals: string[];
  };
  readiness: {
    status: 'fixture_ready_connector_blocked';
    liveConnectors: 'not_connected';
    cartCheckout: 'intentionally_not_implemented_read_only_mvp';
    customerAccounts: 'not_implemented_requires_oauth_and_protected_customer_data';
    policyFaqs: 'not_implemented_needs_approved_public_policy_source';
  };
  ucpCatalog: {
    compatibleTools: ['search_catalog', 'lookup_catalog', 'get_product'];
    productCount: number;
    variantCount: number;
    missingRequiredFields: string[];
    sampleProduct: UcpCatalogProduct;
    mappingNotes: string[];
  };
  commonlandsAdvantages: string[];
  differentiators: string[];
  launchBlockers: string[];
  safeguards: string[];
}

export function getShopifyUcpReadiness(snapshot: CatalogSnapshot = CATALOG_SNAPSHOT): ShopifyUcpReadiness {
  const products = snapshot.lenses.map(toUcpCatalogProduct);
  const sampleProduct = products[0];
  if (!sampleProduct) {
    throw new Error('Shopify/UCP readiness requires at least one fixture product');
  }

  return {
    schemaVersion: 'shopify.ucp_readiness.v1',
    generatedAt: snapshot.generatedAt,
    compatibilityTarget: {
      shopifyStorefrontMcp: 'storefront-mcp',
      ucpCatalogVersion: UCP_VERSION,
      referenceTools: ['search_catalog', 'lookup_catalog', 'get_product'],
      nonGoals: [
        'get_cart/update_cart are intentionally excluded from the public read-only MVP.',
        'Customer-account/order tools require OAuth and protected customer-data approval before any implementation.',
        'Live Shopify Storefront/Admin API calls are blocked until read-only credentials, metafield keys, and rate-limit policy are approved.',
      ],
    },
    readiness: {
      status: 'fixture_ready_connector_blocked',
      liveConnectors: 'not_connected',
      cartCheckout: 'intentionally_not_implemented_read_only_mvp',
      customerAccounts: 'not_implemented_requires_oauth_and_protected_customer_data',
      policyFaqs: 'not_implemented_needs_approved_public_policy_source',
    },
    ucpCatalog: {
      compatibleTools: ['search_catalog', 'lookup_catalog', 'get_product'],
      productCount: products.length,
      variantCount: products.reduce((count, product) => count + product.variants.length, 0),
      missingRequiredFields: findMissingRequiredFields(products),
      sampleProduct,
      mappingNotes: [
        'Existing Commonlands tools can map to UCP search_catalog, lookup_catalog, and get_product without adding write behavior.',
        'UCP prices are minor currency units; fixture priceUsd is converted to USD cents for compatibility samples.',
        'Catalog responses are session freshness contracts; live connector work must revalidate Shopify price and availability instead of caching search results indefinitely.',
        'Commonlands optical metadata belongs in UCP product/variant metadata so generic shopping agents retain engineering context.',
      ],
    },
    commonlandsAdvantages: [
      'Optical source-of-truth provenance from DynamoDB/AppSync instead of Shopify-only merchandising text.',
      'Distortion-aware FoV and angular-resolution tools for engineering fit checks before purchase handoff.',
      'Sensor/lens matching and application-specific recommendations that Shopify Storefront MCP does not provide by default.',
      'Explicit gated-document and public mechanical-drawing policies for industrial optics buyers.',
    ],
    differentiators: [
      'distortion-aware FoV and angular-resolution tools',
      'sensor-specific lens matching',
      'engineering recommendation tradeoff explanations',
      'DynamoDB/AppSync optical provenance preserved separately from Shopify commerce enrichment',
    ],
    launchBlockers: [
      'Confirm Shopify read-only API path, product IDs, variant IDs, handle mapping, and mechanical drawing metafield/file-reference source.',
      'Confirm whether UCP catalog aliases should be exposed as first-class tool names in addition to Commonlands-native tools.',
      'Confirm Cloudflare route, /.well-known/ucp profile, and whether any legacy /sse compatibility endpoint is required.',
      'Confirm public policy/FAQ source if search_shop_policies_and_faqs parity is desired.',
    ],
    safeguards: [
      'No Shopify writes, cart updates, checkout creation, customer-account access, order lookup, or protected customer data in this phase.',
      'No direct gated-document URLs are emitted.',
      'No credentials, tokens, or signed URLs are stored in fixtures or responses.',
    ],
  };
}

function toUcpCatalogProduct(lens: LensCatalogItem): UcpCatalogProduct {
  const price = toUsdMinorUnits(lens.priceUsd);
  const availability = lens.availability === 'in_stock';

  return {
    id: `gid://commonlands/Product/${lens.sku}`,
    handle: lens.handle,
    title: lens.title,
    description: {
      plain: `${lens.mount} ${lens.lensType} with ${lens.eflMm}mm EFL, f/${lens.fNumber}, ${lens.imageCircleMm}mm image circle, and ${lens.resolution} lens resolution.`,
    },
    url: lens.productUrl,
    categories: [{ value: `Optics > ${lens.mount} lenses`, taxonomy: 'merchant' }],
    price_range: {
      min: price,
      max: price,
    },
    variants: [
      {
        id: `gid://commonlands/ProductVariant/${lens.sku}`,
        sku: lens.sku,
        title: lens.sku,
        description: { plain: lens.title },
        url: lens.productUrl,
        price,
        availability: {
          available: availability,
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

function toUsdMinorUnits(priceUsd: number): UcpPrice {
  return {
    amount: Math.round(priceUsd * 100),
    currency: 'USD',
  };
}

function findMissingRequiredFields(products: UcpCatalogProduct[]): string[] {
  const missing: string[] = [];

  for (const product of products) {
    if (!product.id) missing.push(`${product.handle}: product.id`);
    if (!product.title) missing.push(`${product.handle}: product.title`);
    if (!product.description.plain) missing.push(`${product.handle}: product.description`);
    if (!product.price_range.min.currency || !Number.isFinite(product.price_range.min.amount)) {
      missing.push(`${product.handle}: product.price_range.min`);
    }
    if (product.variants.length < 1) missing.push(`${product.handle}: product.variants`);

    for (const variant of product.variants) {
      if (!variant.id) missing.push(`${product.handle}: variant.id`);
      if (!variant.title) missing.push(`${product.handle}: variant.title`);
      if (!variant.description.plain) missing.push(`${product.handle}: variant.description`);
      if (!variant.price.currency || !Number.isFinite(variant.price.amount)) {
        missing.push(`${product.handle}: variant.price`);
      }
    }
  }

  return missing;
}
