import { readShopifyProducts, type ShopifyReadAdapterEnv } from './shopify-read-adapter';

/** Only join on a full SKU or a delimited family prefix; never choose a sibling. */
export async function resolveLiveProduct(env: ShopifyReadAdapterEnv, identifier: string) {
  const requested = identifier.trim().toUpperCase();
  const live = await readShopifyProducts(env, { sku: requested, limit: 25, includeMetafields: true });
  const products = live.products.map(product => ({
    ...product,
    variants: product.variants.filter(variant => {
      const sku = variant.sku.toUpperCase();
      return sku === requested || (/^CIL\d{3}[A-Z]?$/.test(requested) && sku.startsWith(`${requested}-`));
    }),
  })).filter(product => product.variants.length > 0);
  const exact = products.flatMap(product => product.variants).filter(variant => variant.sku.toUpperCase() === requested);
  return {
    ...live,
    schemaVersion: 'commonlands.product_resolution.v1',
    requestedIdentifier: requested,
    selectionStatus: live.connector.status !== 'ok' ? 'unavailable'
      : exact.length === 1 ? 'exact_variant'
      : products.length ? 'requires_variant_selection' : 'not_found',
    selectedVariant: exact.length === 1 ? exact[0]! : null,
    products,
    provenance: {
      commerce: 'live_shopify_admin_graphql',
      optics: 'Use search_lens_catalog and calculate_field_of_view with the optical part number. Family specifications do not establish a full variant configuration.',
    },
  };
}

/** Text normalization shared by search and mount filtering. CS is deliberately separate. */
export function normalizeMountText(value: string): string {
  return value.toLowerCase().replace(/\bc[ -]?mount\b|\bc\s+fa\b/g, 'cmount')
    .replace(/\bs[ -]?mount\b|\bm12\b/g, 'm12');
}
