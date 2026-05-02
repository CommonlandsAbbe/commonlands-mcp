# Live MCP end-user usage guide

This guide is for agents and humans using the live public Commonlands MCP endpoint.

The current service is intentionally public and read-only. Its user-facing catalog, optics, product lookup, and purchase-handoff flows remain fixture-backed by default. It also exposes credential-gated diagnostic Shopify Admin read tools for product/metaobject summary checks when approved read-only Shopify configuration is present. It does not create carts, checkouts, orders, RFQs, customer records, inventory reservations, Shopify writes, or inventory sync changes.

## Endpoint

Use the Workers.dev endpoint until Commonlands chooses the Cloudflare Business custom-hostname/proxy path.

- MCP endpoint: `https://commonlands-mcp.erp-14c.workers.dev/mcp`
- UCP discovery profile: `https://commonlands-mcp.erp-14c.workers.dev/.well-known/ucp`
- Health check: `https://commonlands-mcp.erp-14c.workers.dev/healthz`

Do not move `commonlands.com` DNS to Cloudflare just to get `mcp.commonlands.com`. The safe current launch path is Workers.dev.

## Recommended end-user usage method

Use the server as a remote HTTP MCP endpoint.

Recommended flow:

1. Connect the agent/client to `https://commonlands-mcp.erp-14c.workers.dev/mcp` as a remote MCP server.
2. If the client supports UCP discovery, point it at `https://commonlands-mcp.erp-14c.workers.dev/.well-known/ucp`.
3. Ask the agent lens-selection questions in normal language.
4. Let the agent call MCP tools for catalog search, product lookup, FoV calculation, comparison, recommendation, and purchase-route planning.
5. Treat returned product links and engineering-review routes as handoff destinations, not as transactions.

Good prompts:

- `Find M12 lenses for a 1/2.8 inch sensor around 80 degrees horizontal FoV.`
- `Compare CIL078 and CIL250 for a robotics camera application.`
- `Recommend Commonlands lenses for low-distortion machine vision on a 1/1.8 inch sensor.`
- `Find the Commonlands product page for CIL078 and tell me what information is still fixture-backed.`
- `What is the safest purchase route for two CIL078 lenses for prototype evaluation?`

## What agents should do

Agents should treat this MCP server as an engineering/catalog intelligence endpoint, not a commerce mutation endpoint.

Recommended tool flow:

1. Call `tools/list` to discover available tools.
2. Use `search_catalog` for broad lens discovery.
3. Use `get_product` or `lookup_catalog` for exact SKU/product resolution.
4. Use `compute_fov`, `match_lenses_to_sensor`, `compare_lenses`, or `recommend_lenses_for_application` for optical fit and tradeoff analysis.
5. Use `prepare_shopify_purchase_handoff` or `get_purchase_route_options` only to prepare a safe product/page handoff.
6. Send the buyer to the returned Commonlands product URL or engineering review path for human-visible next steps.

## Current safe boundaries

The live Worker must remain read-only.

Allowed:

- Catalog search.
- Product lookup.
- Sensor lookup.
- FoV and optical calculations.
- Lens comparison.
- Lens recommendations.
- Snapshot/status inspection.
- Credential-gated diagnostic Shopify Admin reads for product/variant/metaobject summaries.
- Safe purchase-route planning that points users to pages or engineering review.

Not allowed:

- Cart creation or cart updates.
- Checkout creation.
- Orders.
- RFQs.
- Customer/account access.
- Inventory reservations or inventory writes.
- Shopify product, variant, collection, tag, or metafield writes.
- Acumatica writes.
- Database writes or live scans.
- Direct gated-document URLs.

## Copy-paste smoke tests

Health check:

```bash
curl -s 'https://commonlands-mcp.erp-14c.workers.dev/healthz' | python3 -m json.tool
```

Discovery profile:

```bash
curl -s 'https://commonlands-mcp.erp-14c.workers.dev/.well-known/ucp' | python3 -m json.tool
```

List available tools:

```bash
curl -s -X POST 'https://commonlands-mcp.erp-14c.workers.dev/mcp' -H 'content-type: application/json' --data-binary '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | python3 -m json.tool
```

Search fixture catalog and print product titles:

```bash
curl -s -X POST 'https://commonlands-mcp.erp-14c.workers.dev/mcp' -H 'content-type: application/json' --data-binary '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_catalog","arguments":{"query":"M12 lens"}}}' | python3 -c 'import sys,json; d=json.load(sys.stdin); print("\n".join(p["title"] for p in d["result"]["structuredContent"]["catalog"]["products"]))'
```

Prepare a read-only purchase handoff:

```bash
curl -s -X POST 'https://commonlands-mcp.erp-14c.workers.dev/mcp' -H 'content-type: application/json' --data-binary '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"prepare_shopify_purchase_handoff","arguments":{"sku":"CIL078","quantity":2}}}' | python3 -m json.tool
```

Check purchase route options:

```bash
curl -s -X POST 'https://commonlands-mcp.erp-14c.workers.dev/mcp' -H 'content-type: application/json' --data-binary '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_purchase_route_options","arguments":{"sku":"CIL078","quantity":2,"buyerIntent":"prototype evaluation","agentType":"engineering assistant"}}}' | python3 -m json.tool
```

## Current limitations

The fixture catalog remains the default user-facing source. The live Worker validates the agent interface, endpoint discovery, response contracts, catalog shape, optical workflow, safe commerce handoff design, and now a narrow live Shopify read-only diagnostic seam.

Current limitations:

- Catalog/search/recommendation/purchase-handoff flows still use fixture data.
- Fixture catalog product/variant IDs, price, and availability are not guaranteed to match production Shopify.
- Diagnostic Shopify reads are separate tools: `get_shopify_readonly_config_status`, `read_shopify_products`, and `read_shopify_metaobjects`.
- Diagnostic Shopify reads require approved client credentials/scopes and may return `not_configured`, `missing_scope`, or sanitized Shopify errors if the production app/store cannot exchange a token.
- No live DynamoDB/AppSync optical reads.
- No carts, checkouts, orders, RFQs, customer records, inventory reservations, inventory sync changes, or Shopify writes.
- Datasheets remain gated; responses must not expose direct gated-document URLs.

## Shopify read-only diagnostic access

Commonlands has a Shopify Dev Dashboard app path for read-only catalog diagnostics. The app uses the current Shopify client credential model, not the older custom-app token reveal flow. These tools are for controlled verification and future enrichment work; they do not silently replace fixture-backed catalog results.

Approved read scopes for the diagnostic integration:

- `read_discovery`
- `read_files`
- `read_inventory`
- `read_legal_policies`
- `read_locations`
- `read_marketing_integrated_campaigns`
- `read_marketing_events`
- `read_metaobject_definitions`
- `read_metaobjects`
- `read_online_store_navigation`
- `read_online_store_pages`
- `read_payment_terms`
- `read_product_feeds`
- `read_product_listings`
- `read_products`
- `read_shipping`
- `read_content`

These scopes remain read-only. They do not permit carts, checkouts, orders, customer records, inventory mutations, product writes, variant writes, collection writes, tag writes, or metafield writes.

Diagnostic tools:

- `get_shopify_readonly_config_status` reports sanitized config/scope readiness only; it never returns secret values.
- `read_shopify_products` reads product, variant, selected public metafield/media URL, price, and inventory summary fields through Shopify Admin GraphQL. SKU search is the safest path; handle-only lookup uses Shopify `productByHandle`.
- `read_shopify_metaobjects` reads metaobjects by type and optional handle, returning redacted field previews only.

All diagnostic results include read-only safety flags and redact tokens/client credentials. Use them to validate connector readiness, not to make final public stock/price claims until the joined catalog snapshot is audited.

## Shopify product read syntax and metafield guide

Use the credential-gated `read_shopify_products` tool when an agent needs current Shopify product, variant, metafield, media, price, or inventory-summary data. This is a read-only diagnostic/enrichment path; it does not change the fixture-backed catalog tools and must not be used to create carts, checkouts, orders, customers, inventory changes, or Shopify writes.

### Tool arguments

`read_shopify_products` accepts one of these lookup styles:

- `sku`: Commonlands short part number such as `CIL250`. The tool first tries Shopify's exact `sku:` variant search. If Shopify returns zero results and no explicit `query` was supplied, it retries once as safe text search so short part numbers, MPNs, and product metafields can resolve. The fallback is broader than exact SKU lookup, so preserve the connector message when explaining the result.
- `handle`: exact Shopify product handle such as `telephoto-25mm-m12-lens-cil250`. Handle lookup uses Shopify `productByHandle` and is the cleanest way to jump from a known product page slug to the live Shopify product.
- `query`: safe Shopify product/variant search text such as `CIL250` or `M12`. Use this for broad discovery, but do not treat a broad query as an exact product match without checking returned handles/SKUs/metafields.
- `limit`: `1` to `25`, default `10`.
- `includeMetafields`: default `true`. Set `false` only when a client needs a lighter response. When true, the adapter currently reads up to the first 100 product metafields and first 100 variant metafields per Shopify connection.

Example JSON-RPC call for a short part number:

```json
{
  "jsonrpc": "2.0",
  "id": "cil250",
  "method": "tools/call",
  "params": {
    "name": "read_shopify_products",
    "arguments": { "sku": "CIL250", "limit": 1 }
  }
}
```

Example JSON-RPC call for a product handle:

```json
{
  "jsonrpc": "2.0",
  "id": "cil250-handle",
  "method": "tools/call",
  "params": {
    "name": "read_shopify_products",
    "arguments": { "handle": "telephoto-25mm-m12-lens-cil250", "limit": 1 }
  }
}
```

### Navigating to the product page from a handle

A returned Shopify product `handle` is the product page slug. Build the customer-facing page URL as:

```text
https://commonlands.com/products/{handle}
```

For example:

```text
handle: telephoto-25mm-m12-lens-cil250
product page: https://commonlands.com/products/telephoto-25mm-m12-lens-cil250
```

Prefer the returned `productUrl` when present because it is already normalized and allowlisted. If `productUrl` is missing, use the handle pattern above and still treat the URL as a human handoff, not a checkout/cart operation.

### Product information priority order

When multiple fields overlap, agents should rank product facts in this order:

1. **Core Shopify product fields:** `title`, `handle`, `productUrl`, `productType`, `vendor`, `tags`, and product media. The product title and description are pulled directly from Shopify product information, so use these as the primary merchandising/customer-facing wording.
2. **Variant fields:** variant `sku`, variant title, price, and inventory summary fields. Use these for orderable variant identity and diagnostic availability context, but do not make final stock guarantees until the joined catalog snapshot is audited.
3. **Commonlands `custom.*` product metafields:** optical specs, compatibility content, engineering assets, product-page sections, and short part number. These are the main structured product enrichment fields.
4. **Shopping-channel metafields:** `mm-google-shopping.*`, `mc-facebook.*`, and `msft_bingads.*`. Use mostly for MPN/category/status hints or ad/feed diagnostics, not primary engineering truth.
5. **SEO/review/app metafields:** `global.title_tag`, `global.description_tag`, `product_seo.*`, `booster_apps_seo.*`, `opinew_metafields.*`, and similar app-owned fields. These are secondary display/SEO/review artifacts.
6. **Metaobjects:** use only when explicitly needed. Commonlands currently relies much more on product metafields than metaobjects.

If a metafield conflicts with a core Shopify product title/description, keep the Shopify product title/description as the displayed product copy and mention the metafield as supporting structured data.

### Commonlands product metafields currently exposed

`read_shopify_products` returns product and variant metafields as objects with:

- `namespace`
- `key`
- `type`
- `valuePreview` when Shopify stores a scalar/string value
- `reference` when Shopify returns a file, image, or metaobject reference

Important Commonlands product metafields include:

| Metafield | Purpose / interpretation |
| --- | --- |
| `custom.short_partnumber` | Commonlands short part number, e.g. `CIL250`. Use for exact human-recognizable lens identity. |
| `custom.product_group_id` / `custom.group_id` | Product family/grouping identifiers. Useful for grouping mechanical or optical variants. |
| `custom.headline_description` | Short product-page headline/subtitle. Secondary to Shopify title, useful as a concise description. |
| `custom.docsend_page` | Spec/document link when present and approved for customer-facing use. Treat as a page/link handoff, not as a secret or credential. |
| `custom.efl` | Effective focal length. Usually numeric millimeters. |
| `custom.f_number` | F-number list, e.g. `["2.0"]`. Use for aperture/F# summaries. |
| `custom.field_of_view` | Human-readable FoV claim, often tied to a sensor/image-circle context, e.g. `20° @ 8.8mm`. Use as display/spec text, not as a substitute for server-side FoV calculations. |
| `custom.distortion` | Public distortion summary such as `<3%`. Do not infer or expose private distortion coefficients from this. |
| `custom.image_circle` | Image circle coverage text, e.g. `9.4mm`. |
| `custom.compatible_resolution` | Human-readable resolution compatibility. |
| `custom.ir_cut_off_filter` | Variant/filter nomenclature text, including filtered and NIR/no-filter part-number variants. |
| `custom.construction` | Construction summary such as `All-Glass`. |
| `custom.weight` | Product weight display text. |
| `custom.mechanical_drawing` | Mechanical drawing asset URL when present. Prefer allowlisted/public URLs returned in references or value previews. |
| `custom.mechanical_drawing_alt_text` | Alt text for the mechanical drawing. |
| `custom.3d_model` | 3D model URL when present. |
| `custom.mechanical_variants_title` | Titles/labels for mechanical variant sections. |
| `custom.mechanical_variant_description` | Description of mechanical variant details. |
| `custom.features_titles` / `custom.features_description` | Product-page feature blocks. Keep list order aligned by index when possible. |
| `custom.compatibility_company_list` | Compatibility vendor/camera labels, often markdown-style links. |
| `custom.compatibility_table_result` | Compatibility result values aligned with the company/list entries. |
| `custom.compatibility_table_result_url` / `custom.compatibility_table_urls` | Compatibility source URLs. |
| `custom.product_long_description` | Rich-text product description. Product title/description still have priority for primary display copy. |
| `custom.faq_questions` / `custom.faq_answers` | FAQ content. Keep question/answer list order aligned by index. |
| `custom.related_collection` | Shopify collection reference. Use as relationship metadata only unless resolved separately. |
| `custom.date_modified` | Product content/spec modification date. |

Common variant/feed metafields include:

| Metafield | Purpose / interpretation |
| --- | --- |
| `mm-google-shopping.mpn` | Manufacturer part number / short part-number hint. Useful when exact Shopify SKU search misses but text search finds a product. |
| `mm-google-shopping.condition` | Feed condition such as `new`. |
| `mm-google-shopping.google_product_category` | Google product category ID. |
| `mm-google-shopping.custom_label_0` / `custom_label_1` | Feed labels such as lens category. |
| `mc-facebook.google_product_category` | Facebook/Meta catalog category. |
| `msft_bingads.product_status` / `import_status` | Microsoft feed status diagnostics. |
| `global.title_tag` / `global.description_tag` | SEO title/description. Secondary to product title/description. |
| `global.Product`, `global.Product Id`, `global.ProductTypes` | Legacy/import identifiers seen on some products. Use only as diagnostics unless reconciled. |
| `opinew_metafields.*` | Reviews app artifacts. Do not treat as engineering specs. |

### Part-number nomenclature notes

Commonlands short part numbers such as `CIL250` identify the lens family/optical SKU. Extended part numbers encode mechanical and optical/filter variants.

Interpret suffixes conservatively:

- `-F#.#` means the F-number/aperture. Example: `-F2.0` means F/2.0.
- `-M12A650` means M12 threaded, mechanical version `A`, with `650` indicating the IR-cut filter cutoff wavelength in nanometers.
- `-M12ANIR` means M12 threaded, mechanical version `A`, with `NIR` indicating no IR-cut filter on the lens.

Example from `custom.ir_cut_off_filter`:

```text
P/N With: CIL250-F2.0-M12A650; P/N Without: CIL250-F2.0-M12ANIR
```

Interpretation:

- `CIL250`: short part number / lens family.
- `F2.0`: F/2.0 aperture.
- `M12`: M12 threaded mount/mechanics.
- `A`: mechanical version A.
- `650`: 650 nm IR-cut filter cutoff wavelength.
- `NIR`: no filter on the lens.

Do not expose private distortion coefficients or ask customer agents to calculate distortion-aware FoV/angular resolution from metafields. Server-side optics tools should perform those calculations and return only final computed values, warnings, provenance, and safe status metadata.

## How to interpret results

Agents and users should label default catalog output as fixture-backed when discussing price, availability, Shopify IDs, variant IDs, or catalog completeness. If a diagnostic Shopify read tool was used, say that explicitly and preserve uncertainty until the joined catalog snapshot is audited.

Good phrasing:

- `The MCP fixture catalog includes CIL078 as a candidate.`
- `Use the returned product URL as the next step; this MCP server did not create a checkout.`
- `Price and availability from the default catalog are fixture-backed unless a diagnostic Shopify read result is explicitly cited.`

Bad phrasing:

- `This item is definitely in stock.`
- `The live Shopify price is final/guaranteed...`
- `I created a checkout/cart/RFQ for you.`

## Future custom domain note

Current approved public endpoint remains Workers.dev:

`https://commonlands-mcp.erp-14c.workers.dev/mcp`

Do not move `commonlands.com` DNS to Cloudflare for this. The future clean custom-domain path requires Cloudflare Business custom hostname/proxy setup, currently estimated around `$200/month`.
