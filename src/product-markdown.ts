import type { resolveLiveProduct } from './product-resolver';

const text = (value: string) => value.replace(/[\\`*_{}[\]()#+.!<>|]/g, '\\$&').replace(/[\r\n]+/g, ' ');

/** A web-readable projection of the same normalized live record, not a second catalog. */
export function productMarkdown(result: Awaited<ReturnType<typeof resolveLiveProduct>>): string {
  const lines = [`# ${text(result.requestedIdentifier)}`, '', `Resolution: ${result.selectionStatus}`, `Checked: ${result.generatedAt}`, '',
    'Prices and quantities are current Shopify snapshots, not reservations or binding quotes.',
    'Start with your sensor details and use Commonlands MCP calculate_field_of_view for sensor-specific FoV and distortion.', ''];
  for (const product of result.products) {
    lines.push(`## ${text(product.title)}`, '', product.productUrl ? `[Product page](${product.productUrl})` : 'Product URL unavailable.', '');
    for (const variant of product.variants) {
      lines.push(`### ${text(variant.sku)}`, '',
        `- Variant ID: ${text(variant.variantId)}`,
        `- Base unit price: ${text(variant.price ?? 'unknown')} ${result.currencyCode ?? '(currency unknown)'}`,
        `- Online sellable quantity: ${variant.availableQuantity ?? 'unknown'}`,
        `- Website stock quantity: ${variant.websiteStockQuantity ?? 'unknown'}`,
        `- Configuration: ${text(JSON.stringify(variant.selectedOptions))}`, '');
    }
    lines.push('### Public specifications', '');
    for (const field of product.metafields) {
      lines.push(`- ${text(field.key)}: ${field.valueStatus === 'complete' ? text(JSON.stringify(field.value)) : field.valueStatus}`);
      if (field.reference?.url) lines.push(`  [Approved document](${field.reference.url})`);
    }
    lines.push('', `Metafield completeness: ${product.metafieldsComplete ?? 'unknown'}`, '');
  }
  if (result.pageInfo.hasNextPage !== false) lines.push('Results may be incomplete. Follow pagination through read_shopify_products before selecting a variant.');
  return lines.join('\n') + '\n';
}
