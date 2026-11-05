import { resolveLiveProduct } from './product-resolver';
import type { ShopifyReadAdapterEnv } from './shopify-read-adapter';

export interface PurchaseOptionsArgs {
  sku?: unknown;
  quantity?: unknown;
  variant_id?: unknown;
}

export async function getPurchaseOptions(env: ShopifyReadAdapterEnv, args: PurchaseOptionsArgs) {
  if (typeof args.sku !== 'string' || !args.sku.trim() || !Number.isSafeInteger(args.quantity) || Number(args.quantity) < 1 || Number(args.quantity) > 10000) {
    return { schemaVersion: 'commonlands.purchase_options.v1', status: 'invalid_request', message: 'Provide the exact full SKU and an integer quantity from 1 to 10000.' };
  }
  const resolved = await resolveLiveProduct(env, args.sku);
  const variant = resolved.selectedVariant;
  if (!variant || resolved.selectionStatus !== 'exact_variant') {
    return { schemaVersion: 'commonlands.purchase_options.v1', status: resolved.selectionStatus, checkedAt: resolved.generatedAt, resolution: resolved };
  }
  if (args.variant_id !== undefined && args.variant_id !== variant.variantId) {
    return { schemaVersion: 'commonlands.purchase_options.v1', status: 'variant_mismatch', message: 'The selected full SKU and variant_id do not identify the same current Shopify variant.' };
  }
  if (!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(variant.variantId)) {
    return { schemaVersion: 'commonlands.purchase_options.v1', status: 'unavailable', message: 'Shopify did not return a valid variant ID.' };
  }
  const quantity = Number(args.quantity);
  const currency = resolved.currencyCode;
  const unit = money(variant.price, currency);
  const extended = unit ? multiplyMoney(unit, quantity) : null;
  const available = variant.availableQuantity;
  const canSupplyFromOnlineStock = variant.availableForSale === false ? false
    : available === null || variant.availableForSale === null ? null : available >= quantity;
  const product = resolved.products.find(product => product.variants.some(candidate => candidate.variantId === variant.variantId))!;
  return {
    schemaVersion: 'commonlands.purchase_options.v1', status: 'ok',
    source: 'live_shopify_admin_graphql', checkedAt: resolved.generatedAt,
    expiresAt: null, bindingQuote: false, reservesInventory: false,
    selection: { sku: variant.sku, variantId: variant.variantId, productUrl: product.productUrl, options: variant.selectedOptions },
    requestedQuantity: quantity,
    pricing: {
      basis: 'shop_currency_base_price_before_discounts_shipping_tax',
      unitPrice: unit, extendedBasePrice: extended,
      quantityPricing: { status: quantity > 1 ? 'requires_quote' : 'base_price_only', applicableTier: null },
      reason: 'Published quantity tiers and buyer-specific discounts are not verified by this read. Shopify checkout calculates applicable discounts; request an RFQ for production terms.',
    },
    availability: {
      availableQuantity: available, websiteStockQuantity: variant.websiteStockQuantity,
      inventoryTracked: variant.inventoryTracked, availableForSale: variant.availableForSale,
      canSupplyFromOnlineStock,
      backorderAllowed: variant.continueSellingWhenOutOfStock,
      backorderRequired: available === null ? null : available < quantity,
      leadTime: null, dispatchDate: null,
      destinationEligibility: 'verify_in_checkout',
    },
    fulfillment: { status: 'checkout_required', shipping: null, tax: null, total: null, carrier: null, service: null, transitTime: null },
    missingData: ['confirmed_quantity_pricing', 'destination_shipping_and_tax', 'confirmed_dispatch_and_transit_dates', 'quote_expiry'],
    nextSteps: {
      // Existing cart input limit is 999. Larger production requests stay on the RFQ route.
      createCart: quantity <= 999 && variant.availableForSale === true && (canSupplyFromOnlineStock === true || variant.continueSellingWhenOutOfStock === true)
        ? { requiresBuyerConfirmation: true, tool: 'create_cart', arguments: { cart: { line_items: [{ quantity, item: { id: variant.variantId } }] } } } : null,
      rfq: { tool: 'submit_rfq', requiresBuyerConfirmation: true, sku: variant.sku, quantity },
    },
  };
}

export interface Money { amount: string; currency: string }
/** Preserve decimal precision with integers; do not round floats or assume USD. */
function money(raw: unknown, currency: string | null): Money | null {
  return typeof raw === 'string' && /^\d{1,12}(?:\.\d{1,6})?$/.test(raw) && currency !== null
    ? { amount: raw, currency } : null;
}
export function multiplyMoney(unit: Money, quantity: number): Money | null {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || !/^\d{1,12}(?:\.\d{1,6})?$/.test(unit.amount)) return null;
  const [whole = '0', fraction = ''] = unit.amount.split('.');
  const digits = (BigInt(whole + fraction) * BigInt(quantity)).toString().padStart(fraction.length + 1, '0');
  return { amount: fraction.length ? `${digits.slice(0, -fraction.length)}.${digits.slice(-fraction.length)}` : digits, currency: unit.currency };
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

/** Accept only an owner-verified checkout read; never consume a caller-supplied quote. */
export function checkoutEstimate(checkout: unknown, variantId: string, quantity: number) {
  const unavailable = (status: string) => ({ status, shipping: null, tax: null, total: null, expiresAt: null });
  if (!record(checkout)) return unavailable('checkout_unavailable');
  if (typeof checkout.expires_at !== 'string' || !Number.isFinite(Date.parse(checkout.expires_at))) return unavailable('checkout_expiry_unknown');
  if (Date.parse(checkout.expires_at) <= Date.now()) return unavailable('checkout_expired');
  // A mixed cart is not a quote for one selected variant. Do not attribute its totals to it.
  const lines = checkout.line_items;
  if (!Array.isArray(lines) || lines.length !== 1 || !record(lines[0]) || !record(lines[0].item)
      || lines[0].item.id !== variantId || lines[0].quantity !== quantity) return unavailable('checkout_selection_mismatch');
  if (typeof checkout.currency !== 'string' || !/^[A-Z]{3}$/.test(checkout.currency)) return unavailable('checkout_currency_unknown');
  const totals = Array.isArray(checkout.totals) ? checkout.totals : [];
  const total = (type: string) => {
    const matches = totals.filter(item => record(item) && item.type === type);
    const item = matches.length === 1 ? matches[0] : null;
    return record(item) && Number.isSafeInteger(item.amount) && Number(item.amount) >= 0
      ? { amountMinor: Number(item.amount), currency: String(checkout.currency), estimated: true } : null;
  };
  return {
    status: 'shopify_checkout_estimate', shipping: total('shipping'), tax: total('tax'), total: total('total'),
    expiresAt: checkout.expires_at, carrier: null, service: null, dispatchDate: null, transitTime: null,
    warning: 'Shopify may change totals when destination, delivery method, discounts or stock change. Review the current checkout before payment. No order or shipping promise is implied.',
  };
}
