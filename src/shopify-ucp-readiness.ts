import { CATALOG_SNAPSHOT, type CatalogSnapshot } from './catalog';
import { toUcpCatalogProduct, UCP_VERSION, type UcpCatalogProduct } from './ucp-catalog';

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
    status: 'catalog_fixture_ready_commerce_mutations_disabled_by_default';
    liveConnectors: 'not_connected';
    cartCheckout: 'cart_checkout_mutation_tools_hidden_pending_approval';
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
        'Commerce mutation tools are hidden by default pending official approval; customer-account, discount, inventory-reservation, and inventory-sync tools remain excluded.',
        'Customer-account/order tools require OAuth and protected customer-data approval before any implementation.',
        'Live catalog connectors remain separate from the Cart/Checkout MCP proxies and require audited read-only enrichment before replacing fixture defaults.',
      ],
    },
    readiness: {
      status: 'catalog_fixture_ready_commerce_mutations_disabled_by_default',
      liveConnectors: 'not_connected',
      cartCheckout: 'cart_checkout_mutation_tools_hidden_pending_approval',
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
        'Existing Commonlands catalog tools map to UCP search_catalog, lookup_catalog, and get_product without adding catalog write behavior.',
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
      'Confirm official approval, Cloudflare protections, endpoint bindings, and merchant-side availability before enabling any live cart/checkout tools.',
      'Confirm Cloudflare route, /.well-known/ucp profile, and whether any legacy /sse compatibility endpoint is required.',
      'Confirm public policy/FAQ source if search_shop_policies_and_faqs parity is desired.',
    ],
    safeguards: [
      'Cart/checkout mutation tools are hidden by default pending official approval; customer-account access, order lookup, inventory mutation, product writes, raw payment credentials, and protected customer data remain blocked.',
      'No direct gated-document URLs are emitted.',
      'No credentials, tokens, or signed URLs are stored in fixtures or responses.',
    ],
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
