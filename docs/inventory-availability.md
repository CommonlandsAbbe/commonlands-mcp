# Variant Inventory in Public Product Reads

The November 4, 2026 inventory update authorizes quantities for ACTIVE products published to the Online Store. It supersedes the earlier coarse-availability-only policy recorded in the directory review. Inventory locations, inventory item IDs, private products, and private metafields remain excluded.

`read_shopify_products` returns inventory per full variant SKU and Shopify Variant GID:

| Field | Meaning |
| --- | --- |
| `websiteStockQuantity` | Tracked Shopify `inventoryQuantity`, clamped to zero. This is the variant stock field used by Commonlands theme stock labels. |
| `availableQuantity` | Tracked Shopify `sellableOnlineQuantity`, clamped to zero. Online stock can differ from the website's aggregate stock count. |
| `inventoryTracked` | Whether Shopify tracks inventory; null means unknown. |
| `availableForSale` | Shopify's purchase-eligibility flag; not a stock count. |
| `continueSellingWhenOutOfStock` | Whether the variant permits sales after stock is depleted; null means unknown. |
| `availability` | Existing stock category retained for compatibility. A backorderable variant may be out of stock but available for sale. |

Unknown or untracked quantities are null, never an invented zero. Use the response's `generatedAt` for read freshness. Match the selected full SKU and Variant GID; do not sum inventory across variants or use another variant's stock. Counts are snapshots, do not reserve inventory, and do not capture every customer-location restriction. Recheck cart/checkout warnings before purchase approval.

The website may hide a stock count based on its template settings, and inventory can change between requests. This response uses the same Shopify variant source; it does not scrape or guarantee identical text on every page.

Source: [Shopify ProductVariant](https://shopify.dev/docs/api/admin-graphql/2026-04/objects/ProductVariant). Theme references: `sections/main-product.liquid` and `snippets/cl-product-cards.liquid` in `CommonlandsAbbe/commonlands-shopify-2026`.

Each call reads Shopify Admin GraphQL again. Only authentication tokens are cached;
product prices and inventory are not cached or scraped. `generatedAt` is set after
the successful read. A connector failure returns no product truth, never a saved
stock count. `currencyCode` is the shop currency for the Admin variant base price;
checkout may use a different market currency or discounts.

Public metafields include complete typed `value`, `valueStatus`, and `truncated`.
Legacy `valuePreview` is display-only and has its own `valuePreviewTruncated` flag.
A value over 16,384 characters is omitted with `too_large`, not cut into invalid
JSON. Lists and JSON are parsed; numeric/boolean types retain their native types.
Shopify dimension/weight objects preserve their supplied units. String display
specifications keep their original units rather than guessing a conversion.

`specifications.faqs` and `specifications.compatibility` pair equal-length string
arrays. Mismatched/malformed arrays return `invalid_or_incomplete`; raw complete
fields remain available for inspection. `metafieldsComplete` is false when
Shopify has more than the fetched 100 fields, and null when completeness is
unknown. Product/variant lists expose `pageInfo`; pass its `endCursor` as `after`
with the same search parameters. A page may contain no public results while
`hasNextPage` is true. Never infer that this means the entire catalog is empty.

The public allowlist is unchanged. Gated DocSend fields, private namespaces,
location IDs and inventory item IDs remain excluded. Typed fields redact
unsupported external links and credential-like values.
