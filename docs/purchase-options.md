# Quantity purchase options

First identify the image sensor and required field of view. Use
`match_lens_to_sensor`, then `calculate_field_of_view` for the final lens/sensor
pair, including the returned distortion status. Resolve the lens family with
`resolve_lens_product` and select a full variant SKU.

Call `get_purchase_options` with that full SKU and an integer `quantity` (1–10000).
Optionally supply `variant_id`; it must match the SKU. Every call reads the Shopify
backend again. It does not create a cart, submit an RFQ, place an order or reserve
inventory.

```json
{"name":"get_purchase_options","arguments":{"sku":"CIL250-F2.0-M12ANIR","quantity":100}}
```

This is an example input, not a claim that this configuration is currently
available. Discover exact SKUs using live product resolution first.

The response separates:

- Base unit price and extended base price in the shop's explicit currency. Decimal
  arithmetic uses integers. These amounts exclude discounts, shipping and tax.
- Online sellable quantity, the website's aggregate variant quantity, purchase
  eligibility, and backorder policy. Unknown stock is null. `canSupplyFromOnlineStock`
  compares the requested quantity with current online stock; destination eligibility
  still requires checkout. A backorder permission does not establish a lead time.
- Volume terms: `requires_quote` for quantities above one until an applicable
  published tier is verified. No 10/50/100-unit rule is hard-coded. Existing theme
  references to quantity-price breaks do not establish this store's configured
  prices; neither do FAQ or page-copy thresholds.
- Buyer-confirmed cart and RFQ routes. The cart route preserves the exact Variant
  GID and quantity and respects the existing 999-unit cart limit. Larger requests
  use the RFQ route. `submit_rfq` retains its existing confirmation requirements.

## Shipping and tax

After the buyer authorizes the existing cart/checkout flow, Shopify collects their
destination and delivery choice. Pass `checkout_id` and its matching
`checkout_access_token` to `get_purchase_options` to read that checkout's totals.
The selected variant and quantity must match its single line. Mixed carts,
expired checkouts, unknown expiry, and mismatches do not produce quote totals.

Returned shipping, tax and total amounts are explicitly **estimates**, in currency
minor units, copied from Shopify. Missing amounts remain null. Carrier, service,
dispatch date and transit time remain unknown because the existing safe checkout
summary does not expose them. The final checkout may change discounts, tax,
currency or shipping. Review it again before payment; this tool does not complete
payment or confirm an order. Owner tokens, addresses, buyer and payment details
are not returned in purchase options. An estimate is not a merchant commitment;
top-level `expiresAt` stays null rather than inventing a quote guarantee.

## Public web reads

The same normalized Shopify adapter also serves web-only agents:

- `GET /catalog?limit=10` returns published products and their variants. Follow
  `pageInfo.endCursor` with `after` while keeping the same query. Optional `query`
  uses the same safe Shopify search as `read_shopify_products`.
- `GET /products/{full-SKU}` returns the same resolution as `resolve_lens_product`.
  A family can return several configurations and requires explicit selection.
- Add `?format=markdown` to that product URL for a readable specification summary
  and approved document links.

All three routes use `Cache-Control: no-store` and the existing global request
limiter. Limits apply to Shopify variants before unpublished products are filtered;
an empty page can still have a next page. Product response caching is absent.
Read `valueStatus`, `metafieldsComplete` and pagination before assuming completeness.
Gated datasheets remain gated. Sensor-specific FoV still requires Commonlands MCP;
the GET catalog does not duplicate the private optical calculation service.

Commonlands' custom MCP is separate from official Shopify Shop MCP, merchant UCP
and browser WebMCP. A compatible buyer agent may use the existing Shop handoff for
authorized checkout. Publishing these GET URLs does not install a connector or
enable browser tools in another person's chat. See [commerce](commerce.md).

API basis: [Shopify ProductVariant](https://shopify.dev/docs/api/admin-graphql/2026-04/objects/ProductVariant)
and [contextual quantity pricing](https://shopify.dev/docs/api/admin-graphql/2026-04/objects/ProductVariantContextualPricing).
