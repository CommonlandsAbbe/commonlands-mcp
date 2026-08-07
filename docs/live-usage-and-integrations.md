# Commonlands MCP live guide

Commonlands MCP lets AI agents answer lens-selection questions with Commonlands product data, optical calculations, and safe Shopify cart handoff. Use it when you want an agent to help choose a lens, compare tradeoffs, verify live product facts, or prepare a Shopify cart link without asking you to copy specs between tools.

The live server is:

- **MCP endpoint:** `https://mcp.commonlands.com/mcp`
- **Discovery profile:** `https://mcp.commonlands.com/.well-known/ucp`
- **Health check:** `https://mcp.commonlands.com/healthz`

The current public surface (v0.2.0) exposes **21 tools** with intent-named optics tools (`calculate_field_of_view`, `match_lens_to_sensor`, `search_lens_catalog`, `get_lens_distortion_profile`). UCP discovery advertises catalog + cart discovery. Checkout tools, `cancel_cart`, and `read_shopify_metaobjects` are not exposed. The pre-v0.2.0 optics names (`compute_fov`, `compute_fov_catalog`, `match_lenses_to_sensor`, `search_lenses`, `get_lens_details`) still dispatch as hidden aliases but do not appear in `tools/list`.

## The short version

Ask normal engineering questions. The agent should use Commonlands MCP behind the scenes.

Good prompts:

- `Find M12 lenses for an IMX477 sensor around 50° horizontal FoV. Verify live Shopify product truth before recommending a purchasable SKU.`
- `Compare CIL078 and CIL250 on IMX477 and explain the tradeoffs.`
- `Compute the FoV for CIL160 on IMX477 and tell me where the lens data came from.`
- `For IMX477, return the catalog lenses with computed FoV values and flag whether the output came from live DynamoDB or fixture fallback.`
- `Find the live Shopify product and variant ID for CIL250.`
- `Create a Shopify cart for two units of this live ProductVariant ID and return the cart handoff URL.`

The agent should not make final buying claims from fixture catalog data. It must call `read_shopify_products` before giving live price, stock, product URL, Shopify Product/Variant IDs, or cart-ready variant IDs.

## What it is good at

### Lens discovery

Use it to search the Commonlands lens catalog, shortlist lenses by sensor/application, and compare M12 or C-mount options. Some discovery and recommendation tools still use fixture-backed catalog data, so treat them as selection aids rather than final product truth.

### Optical calculations

Use `calculate_field_of_view` for one lens/sensor pair and `match_lens_to_sensor` for catalog-wide FoV on one sensor. In production, these use the authenticated AWS Lambda/DynamoDB FoV backend when configured. Sensor specs come from the read-only live sensor table when configured, with fixture fallback when unavailable. Agent-facing FoV responses are sanitized before return and never expose raw distortion coefficients.

Catalog EFL, image circle, max FoV/FOV@image-circle, and distortion display fields are insufficient to compute field of view on a specific sensor. Agents must not interpolate interior-sensor FoV from those fields or run their own FoV scripts. For sensor-specific discovery, call `match_lens_to_sensor` first and use the returned per-sensor `hfov`, `vfov`, `dfov`, nested `fov`, `coverageClass`, `coverage.pixelCounts`, `distortionAtFieldEdge`, and provenance/source metadata.

### Live Shopify product truth

Use `read_shopify_products` for purchasable facts: live product URLs, Shopify Product/Variant GIDs, SKUs, prices, inventory signals, media, and selected metafields. This is read-only and does not write to Shopify.

### Cart handoff

If a buyer explicitly asks for a cart, the agent can use live Shopify Variant GIDs from `read_shopify_products`, then call `create_cart`, `get_cart`, or `update_cart`. Cart state is stored by Shopify, not by the Commonlands Worker. The agent should show the returned Shopify cart or continue URL.

## Current production status

- **Live tool count:** 21
- **Live Shopify product truth:** `read_shopify_products` is configured and read-only.
- **Live FoV backend:** `calculate_field_of_view` and `match_lens_to_sensor` use the authenticated AWS Lambda/DynamoDB backend when configured. The Worker sends the backend secret server-side; agents never receive it, and returned lens records are allowlisted.
- **Sensor specs:** `get_sensor_specs` prefers the read-only live sensor table when configured and falls back to the Worker fixture sensor catalog when unavailable.
- **Cart tools:** `create_cart`, `get_cart`, and `update_cart` are exposed through Shopify's standard Storefront MCP endpoint.
- **Checkout tools:** hidden. `create_checkout` returns `Tool not found`; checkout still needs a validated Shopify Checkout MCP endpoint, Cloudflare protections, and explicit approval before exposure.
- **Cancel cart:** hidden for the current standard Storefront MCP endpoint. `cancel_cart` returns `Tool not found` unless a validated UCP Cart MCP endpoint with cancel semantics is configured later.

## Recommended agent workflow

1. Start with `tools/list` and check the live tool surface.
2. For sensor-specific lens finding, call `match_lens_to_sensor` first. There is no current `find_lenses` tool.
3. Use `search_catalog`, `search_lens_catalog`, or `recommend_lenses_for_application` only for broad discovery/shortlist context.
4. Use `get_sensor_specs` to confirm sensor pixels, pixel pitch, and active area when needed.
5. Use `calculate_field_of_view` for one live FoV result or `match_lens_to_sensor` for catalog-wide FoV when the Lambda/DynamoDB backend supports the request.
6. Use `match_lens_to_sensor`, `compare_lenses`, and `search_lens_catalog` for fixture-backed engineering context.
7. Use `read_shopify_products` for live Shopify product/variant IDs, product URLs, price, inventory signals, and cart variant IDs.
8. If the buyer explicitly asks for a cart, use live Shopify Variant GIDs from `read_shopify_products`, then call `create_cart`/`get_cart`/`update_cart`. Show the returned Shopify cart/continue URL to the buyer.
9. Do not claim Checkout MCP is live. Send buyers to Shopify's returned cart/checkout handoff URL when present.


## Better example prompts

These prompts are safer than bare SKU questions because they force the agent to separate scaffold data from live Shopify truth.

- **Shortlist, calculate, verify:** `Find M12 lenses for a Sony IMX477 around 50° horizontal FoV. Use Commonlands MCP tools instead of your own FoV script. Label fixture-backed results, compute FoV where available, then verify any final purchasable SKU with read_shopify_products before giving price, stock, product URL, or Variant GID.`
- **Compare two known lenses:** `Compare CIL078 and CIL250 on IMX477. Include image-circle coverage, horizontal/vertical/diagonal FoV, and tradeoffs. Do not use fixture price or availability as live truth; if you recommend buying one, verify it with read_shopify_products.`
- **Get cart-ready truth:** `Find the live Shopify product and variant for CIL250. Return product URL, Product GID, Variant GID, SKU, price, inventory signal, and storefront cart path. Do not create a cart yet.`
- **Create a cart only after confirmation:** `The buyer confirmed two units of Variant GID gid://shopify/ProductVariant/41702699729014. Create a Shopify cart and return the Shopify-owned cart or continue URL. Do not collect payment or checkout details.`
- **Debug connector state:** `List the live tools, then check get_shopify_readonly_config_status and get_shopify_ucp_readiness. Explain which outputs are live-read truth, which are fixture/readiness scaffolds, and which commerce tools are hidden.`
- **Application shortlist:** `Recommend lenses for robotics navigation on IMX477 near 50° HFOV. Prefer M12 if the optical fit is reasonable. Use recommendation tools for shortlist only, compute/compare optical fit, and verify final product truth through read_shopify_products.`

## Live tool input/output table

This table reflects a live `tools/list` check against the production MCP endpoint on 2026-07-17 PDT. It lists the 21 exposed tools only. Checkout tools, `cancel_cart`, and `read_shopify_metaobjects` are intentionally absent from the live surface.

| Tool | Primary use | Required inputs | Optional inputs | Output shape / what to trust | Usefulness check |
| --- | --- | --- | --- | --- | --- |
| `search_lens_catalog` | Legacy fixture search by SKU, title, mount, or lens type. | None; `query` is accepted but can be empty. | `query`, `limit` 1-25. | `catalog.snapshot.v1` with `results[]`, count, generated time, and `fixture_not_product_truth` warning. | Useful for broad discovery, not live SKU/price/stock truth. |
| `get_sensor_specs` | Sensor dimensions used by FoV and ranking tools. | `partNumber`. | None. | `catalog.snapshot.v1` with resolution, active area, and pixel size. | Primary path for sensor specs; production prefers the read-only live sensor table when configured, with fixture fallback when unavailable. |
| `calculate_field_of_view` | FoV for one lens/sensor pair. | `lensSku`, `sensorPartNumber`. | `workingDistanceMm`. | `optics.fov.live.v1` when Lambda/DynamoDB has the lens; otherwise a fixture-backed FoV shape or a fail-closed error. Returned lens records include per-sensor HFOV/VFOV/DFOV, nested `fov`, `coverageClass`, `coverage.pixelCounts`, `distortionAtFieldEdge`, and provenance when the Worker can provide them. | Required path for sensor-specific FoV; failures are useful because they prevent unsupported calculations. |
| `match_lens_to_sensor` | FoV sweep for available catalog lenses on one sensor. | `sensorPartNumber`. | `workingDistanceMm`. | Live/sanitized catalog FoV records with per-sensor HFOV/VFOV/DFOV, nested `fov`, `coverageClass`, `coverage.pixelCounts`, `distortionAtFieldEdge`, payload/lens provenance, and sanitized errors when backend is enabled; never returns raw coefficients. | First-choice tool for sensor-specific lens finding; still needs product verification before recommendation. |
| `get_lens_distortion_profile` | Return the live distortion status and display distortion for one lens. | `lensSku`. | None. | Distortion provenance and status without exposing or inventing polynomial coefficients. | Required when an agent needs to qualify distortion claims for a selected lens. |
| `compare_lenses` | Compare selected SKUs on the same sensor. | `lensSkus` 1-10, `sensorPartNumber`. | `workingDistanceMm`. | `recommendations.v1` comparison records with rank, fit, FoV, tradeoffs. | Useful for explaining tradeoffs after the user or another tool chose candidate SKUs. |
| `get_product_page_details` | Fixture product-page handoff and gated datasheet policy. | `sku`. | None. | `product_page.v1` with fixture product, specs, gated datasheet note, and safety warnings. | Useful for handoff context; not authoritative for current product URL, price, stock, or Variant GID. |
| `get_catalog_snapshot_status` | Fixture catalog provenance and validation. | None. | None. | `catalog.snapshot_status.v1` with counts, validation status, sources, refresh mode. | Useful for deciding how much to trust fixture outputs. |
| `get_shopify_ucp_readiness` | Conservative Storefront/UCP readiness metadata. | None. | None. | `shopify.ucp_readiness.v1` with compatibility target, readiness, catalog counts, blockers/safeguards. | Useful for planning; `tools/list` is still authoritative for live exposure. |
| `get_shopify_readonly_config_status` | Sanitized read-only Shopify connector config. | None. | None. | `shopify.readonly_config_status.v1` with redacted binding/scopes status and safety flags. | Useful for debugging connector configuration without exposing secrets or calling Shopify. |
| `read_shopify_products` | Live Shopify product truth (public data only). | At least one of `sku`, `handle`, or `query` should be supplied for useful results. | `limit` 1-25, `includeMetafields` true/false (default false; allowlisted `custom.*` display fields only). | `shopify.live_read.v1` with live Product/Variant GIDs, SKU, price, coarse `availability`, product URL, media, allowlisted metafields when requested, read-only safety flags. ACTIVE products only; no exact inventory counts. | Essential before final purchasable claims or cart handoff. This is the main truth tool. |
| `create_cart` | Create Shopify-owned cart from confirmed live Variant GIDs. | `cart.line_items[]` with `quantity` and `item.id` Variant GID. | `meta`, `cart.context`, `cart.signals`. | `commonlands.cart_ucp.v1` with connector status, Shopify-owned cart payload when returned, safety flags. | Useful only after explicit buyer line-item/quantity confirmation. Mutates Shopify cart state; does not checkout or collect payment. |
| `get_cart` | Retrieve a Shopify-owned cart by ID. | `id` Shopify Cart GID. | `meta`. | `commonlands.cart_ucp.v1` with cart payload when Shopify returns one, persistence notes, safety flags. | Useful for cart refresh/resume if the agent retained the cart ID. |
| `update_cart` | Add variants, change quantities, or remove lines in a Shopify-owned cart. | `id`, `cart`. | `cart.line_items`, `cart.update_items`, `cart.remove_line_ids`, `context`, `signals`, `meta`. | `commonlands.cart_ucp.v1` with operation status, cart payload when returned, and safety flags. | Useful for buyer-confirmed cart edits; mutates cart only, not checkout/order/customer/inventory/catalog. |
| `search_catalog` | UCP-style fixture catalog search for shopping agents. | None; useful calls include `catalog.query`. | `meta`, `catalog.query`, `catalog.limit` 1-25. | `ucp.catalog.v1` with fixture `catalog.products[]`, UCP metadata, messages, fixture warning. | Useful for UCP compatibility and discovery, not live commerce truth. |
| `lookup_catalog` | UCP-style fixture lookup by IDs/SKUs/handles/URLs. | `catalog.ids[]` 1-10. | `meta`. | `ucp.catalog.v1` product records or not-found messages, plus fixture warning. | Useful for resolving scaffold catalog records; not live Shopify IDs. |
| `get_product` | UCP-style fixture product detail. | `catalog.id`. | `meta`. | `ucp.catalog.v1` product detail record with fixture metadata and warning. | Useful for UCP product-card context; verify live facts separately. |
| `prepare_shopify_purchase_handoff` | Non-mutating purchase handoff plan for a SKU. | `sku`. | `quantity`, `sensorPartNumber`, `selectedVariantId`. | `shopify.purchase_handoff.v1` with product scaffold, transaction safety, warnings; no cart/checkout created. | Useful as a safe planning seam; any selected variant must come from `read_shopify_products` to be cart-ready. |
| `get_purchase_route_options` | Explain available/planned purchase routes without mutation. | `sku`. | `quantity`, `sensorPartNumber`, `buyerIntent`, `agentType`. | `commerce.purchase_routes.v1` with routes, safety flags, required checks, warnings. | Useful to explain next steps and boundaries; it does not buy anything. |
| `recommend_lenses_for_application` | Fixture-backed application-specific shortlist. | `sensorPartNumber`. | `application`, `desiredHorizontalFovDeg`, `workingDistanceMm`, `mount`, `preferLowDistortion`, `requireInStock`, `maxResults` 1-10. | `recommendations.v1` with ranked application-fit records, tradeoffs, warnings. | Useful for natural-language application triage; may later consolidate with `match_lens_to_sensor`. |
| `submit_rfq` | Forward a buyer quote request or engineering question to the fixed Commonlands inbox. | Buyer contact and inquiry details. | Request-specific context accepted by the tool schema. | Inquiry-routing status only; it does not create an order, payment, or Shopify write. | Useful when the configured SendGrid route is available; otherwise returns the Commonlands contact-page fallback. |

## Safety boundaries

- Do not invent live price, stock, product URL, Shopify ID, or variant ID from fixture tools.
- Do not call `create_cart` or `update_cart` until the buyer has explicitly selected line items and quantities.
- Do not claim Checkout MCP is live.
- Do not ask users for, store, or transmit raw card numbers, CVV/CVC, passwords, payment tokens, or customer-account credentials.
- Do not attempt Shopify product, variant, collection, tag, metafield, inventory, order, customer, discount, RFQ, Acumatica, or database writes.
- Do not expose direct gated datasheet URLs.
- For live FoV, agents call Commonlands MCP only. Agents must not call the AWS Lambda/API Gateway endpoint directly.

## Technical reference

## Tool-by-tool usage and current outputs

The output excerpts below are from live-safe calls to the production endpoint unless marked otherwise. Mutable cart tools are documented with their input contract and expected output shape; this documentation pass did **not** create or update a live cart.

### `search_lens_catalog`

**Use for:** fixture-backed legacy lens catalog search by SKU, title, mount, or lens type.

**Example prompt:** `Search the Commonlands lens catalog for CIL250.`

**Tool call:**

```json
{"name":"search_lens_catalog","arguments":{"query":"CIL250","limit":1}}
```

**Actual output excerpt:**

```json
{
  "schemaVersion": "catalog.snapshot.v1",
  "results": [
    {
      "sku": "CIL250",
      "title": "CIL250 M12 lens",
      "productUrl": "https://commonlands.com/products/cil250",
      "priceUsd": 34,
      "availability": "in_stock",
      "eflMm": 6,
      "imageCircleMm": 7.2
    }
  ],
  "sourceWarning": { "code": "fixture_not_product_truth" }
}
```

### `search_lens_catalog`

**Use for:** fixture-backed optical/product details for one lens SKU.

**Example prompt:** `Show fixture-backed engineering details for CIL250.`

**Tool call:**

```json
{"name":"search_lens_catalog","arguments":{"sku":"CIL250"}}
```

**Actual output excerpt:**

```json
{
  "schemaVersion": "catalog.snapshot.v1",
  "lens": {
    "sku": "CIL250",
    "title": "CIL250 M12 lens",
    "eflMm": 6,
    "fNumber": 2.4,
    "imageCircleMm": 7.2,
    "resolution": "5MP",
    "datasheet": { "gated": true }
  },
  "sourceWarning": { "code": "fixture_not_product_truth" }
}
```

### `get_sensor_specs`

**Use for:** sensor pixel count, pixel pitch, and active area used by FoV calculations. Production prefers the read-only live sensor table when configured, with fixture fallback when unavailable.

**Example prompt:** `What are the IMX477 sensor dimensions for FoV input?`

**Tool call:**

```json
{"name":"get_sensor_specs","arguments":{"partNumber":"IMX477"}}
```

**Actual output:**

```json
{
  "schemaVersion": "catalog.snapshot.v1",
  "sensor": {
    "partNumber": "IMX477",
    "manufacturer": "Sony",
    "name": "Sony IMX477",
    "resolution": { "widthPx": 4056, "heightPx": 3040 },
    "activeAreaMm": { "width": 6.287, "height": 4.712 },
    "pixelSizeUm": 1.55
  }
}
```

### `calculate_field_of_view`

**Use for:** FoV for one lens/sensor pair. In production this is wired to authenticated AWS Lambda/DynamoDB when the lens exists in the Lambda table. The Lambda lens table is maintained separately, so coverage can change by SKU.

**Example prompt:** `Compute FoV for CIL160 on IMX477.`

**Tool call:**

```json
{"name":"calculate_field_of_view","arguments":{"lensSku":"CIL160","sensorPartNumber":"IMX477"}}
```

**Expected sanitized output shape after the current Worker change:**

```json
{
  "schemaVersion": "optics.fov.live.v1",
  "modelVersion": "lambda-dynamodb-fov-0.1.0",
  "correctionStatus": "live_lambda_dynamodb",
  "source": "aws-lambda-dynamodb-readonly",
  "requested": { "lensSku": "CIL160", "sensorPartNumber": "IMX477" },
  "sensor": { "partNumber": "IMX477", "hsize": 6.287, "vsize": 4.712, "pixpitch": 1.55 },
  "count": 1,
  "backendCount": 1,
  "resultLimit": 10,
  "truncated": false,
  "provenance": {
    "method": "lambda_dynamodb_fov_backend",
    "rev": "lambda-dynamodb-fov-0.1.0",
    "source": "aws-lambda-dynamodb-readonly"
  },
  "lenses": [
    {
      "partNum": "CIL160",
      "efl": 16,
      "hfov": 22,
      "vfov": 17,
      "dfov": 28,
      "fov": { "horizontalDeg": 22, "verticalDeg": 17, "diagonalDeg": 28 },
      "pixpitch": 1.55,
      "coverageClass": "full",
      "coverage": {
        "class": "full",
        "pixelCounts": {
          "sensorPixels": 12330240,
          "coveredPixels": 12330240,
          "croppedPixels": 0
        }
      },
      "distortionAtFieldEdge": { "status": "unavailable" },
      "provenance": {
        "method": "lambda_dynamodb_fov_backend",
        "rev": "lambda-dynamodb-fov-0.1.0",
        "source": "aws-lambda-dynamodb-readonly"
      }
    }
  ],
  "errors": []
}
```

Live backend records are allowlisted by the Worker before they are returned to agents. Raw DynamoDB/Lambda distortion-coefficient fields are not exposed. If a SKU is missing from, or rejected by, the Lambda's current DynamoDB table, the tool fails closed with:

```json
{ "code": -32603, "message": "Live FoV backend rejected request" }
```

### `match_lens_to_sensor`

**Use for:** FoV for the available lens catalog on one sensor.

**Example prompt:** `For IMX477, compute FoV for the available catalog and show the top lens fields only.`

**Tool call:**

```json
{"name":"match_lens_to_sensor","arguments":{"sensorPartNumber":"IMX477"}}
```

**Expected sanitized output shape:**

```json
{
  "schemaVersion": "optics.fov.live.v1",
  "source": "aws-lambda-dynamodb-readonly",
  "requested": { "sensorPartNumber": "IMX477" },
  "count": 250,
  "backendCount": 251,
  "resultLimit": 250,
  "truncated": true,
  "provenance": {
    "method": "lambda_dynamodb_fov_backend",
    "rev": "lambda-dynamodb-fov-0.1.0",
    "source": "aws-lambda-dynamodb-readonly"
  },
  "lenses": [
    {
      "partNum": "CIL034",
      "hfov": 88,
      "vfov": 72,
      "dfov": 101,
      "fov": { "horizontalDeg": 88, "verticalDeg": 72, "diagonalDeg": 101 },
      "coverageClass": "unknown",
      "coverage": {
        "class": "unknown",
        "pixelCounts": { "sensorPixels": 12330240 }
      },
      "provenance": {
        "method": "lambda_dynamodb_fov_backend",
        "rev": "lambda-dynamodb-fov-0.1.0",
        "source": "aws-lambda-dynamodb-readonly"
      },
      "distortion": { "display": "0% TV", "status": "source_display_only" },
      "distortionAtFieldEdge": { "display": "0% TV", "status": "source_display_only" }
    }
  ],
  "errors": []
}
```

Live catalog mode depends on the Lambda supporting a bounded catalog scan when no `partNums` are supplied. If the live backend is disabled, the Worker returns fixture-backed catalog FoV scaffold data instead.

### `match_lens_to_sensor`

**Use for:** fixture-backed ranking of catalog lenses for a sensor and optional target FoV.

**Example prompt:** `Rank lenses for IMX477 near 50° horizontal FoV.`

**Tool call:**

```json
{"name":"match_lens_to_sensor","arguments":{"sensorPartNumber":"IMX477","desiredHorizontalFovDeg":50,"maxResults":2}}
```

**Actual output excerpt:**

```json
{
  "schemaVersion": "recommendations.v1",
  "correctionStatus": "fixture_recommendation_scaffold",
  "recommendations": [
    {
      "lens": { "sku": "CIL250", "title": "CIL250 M12 lens" },
      "score": 71.7,
      "rank": 1,
      "fit": "good",
      "fov": { "horizontalDeg": 51.3, "verticalDeg": 39.6, "diagonalDeg": 61.9 }
    },
    {
      "lens": { "sku": "CIL121", "title": "CIL121 M12 machine vision lens" },
      "score": 67,
      "rank": 2,
      "fit": "conditional",
      "fov": { "horizontalDeg": 19.3, "verticalDeg": 14.6, "diagonalDeg": 24 }
    }
  ],
  "sourceWarning": { "code": "fixture_not_product_truth" }
}
```

### `compare_lenses`

**Use for:** fixture-backed comparison of selected lenses on the same sensor.

**Example prompt:** `Compare CIL078 and CIL250 on IMX477.`

**Tool call:**

```json
{"name":"compare_lenses","arguments":{"lensSkus":["CIL078","CIL250"],"sensorPartNumber":"IMX477"}}
```

**Actual output excerpt:**

```json
{
  "schemaVersion": "recommendations.v1",
  "recommendations": [
    {
      "lens": { "sku": "CIL078", "title": "CIL078 M12 wide-angle lens" },
      "rank": 1,
      "fit": "good",
      "fov": { "horizontalDeg": 86.6, "verticalDeg": 70.5, "diagonalDeg": 99.4 }
    },
    {
      "lens": { "sku": "CIL250", "title": "CIL250 M12 lens" },
      "rank": 2,
      "fit": "good",
      "fov": { "horizontalDeg": 51.3, "verticalDeg": 39.6, "diagonalDeg": 61.9 }
    }
  ]
}
```

### `get_product_page_details`

**Use for:** fixture-backed product-page handoff details, gated datasheet policy, and optical specs.

**Example prompt:** `Give me product page handoff details for CIL250.`

**Tool call:**

```json
{"name":"get_product_page_details","arguments":{"sku":"CIL250"}}
```

**Actual output excerpt:**

```json
{
  "schemaVersion": "product_page.v1",
  "correctionStatus": "fixture_commerce_handoff",
  "product": {
    "sku": "CIL250",
    "title": "CIL250 M12 lens",
    "productUrl": "https://commonlands.com/products/cil250",
    "priceUsd": 34,
    "availability": "in_stock"
  },
  "technicalSpecifications": {
    "mount": "M12",
    "eflMm": 6,
    "fNumber": 2.4,
    "imageCircleMm": 7.2
  },
  "datasheet": { "gated": true }
}
```

### `get_catalog_snapshot_status`

**Use for:** fixture catalog counts, validation status, and provenance.

**Example prompt:** `What is the current fixture catalog snapshot status?`

**Tool call:**

```json
{"name":"get_catalog_snapshot_status","arguments":{}}
```

**Actual output excerpt:**

```json
{
  "schemaVersion": "catalog.snapshot_status.v1",
  "counts": { "lenses": 5, "sensors": 3, "joins": 5, "missingCommerce": 0, "missingOptical": 0, "unsafeUrls": 0 },
  "validation": { "ok": true, "errors": [] },
  "refresh": { "mode": "fixture_static", "liveConnectors": "not_connected" }
}
```

### `get_shopify_ucp_readiness`

**Use for:** static readiness/status for Shopify Storefront MCP/UCP catalog compatibility. Treat this as conservative scaffold/readiness metadata; use `tools/list` for the live exposed tool surface.

**Example prompt:** `Is Commonlands MCP ready for Shopify UCP catalog and cart?`

**Tool call:**

```json
{"name":"get_shopify_ucp_readiness","arguments":{}}
```

**Actual output excerpt:**

```json
{
  "schemaVersion": "shopify.ucp_readiness.v1",
  "readiness": {
    "status": "catalog_fixture_ready_live_shopify_read_and_cart_proxy_configured_separately",
    "liveConnectors": "shopify_read_only_configured_separately",
    "cartCheckout": "cart_proxy_create_get_update_when_enabled_checkout_hidden"
  },
  "ucpCatalog": { "compatibleTools": ["search_catalog", "lookup_catalog", "get_product"], "productCount": 5 },
  "safeguards": ["Approved cart tools create/update Shopify-owned cart state only; checkout, customer-account access, order lookup, inventory mutation, product writes, raw payment credentials, and protected customer data remain blocked."]
}
```

Note: the readiness text is conservative/static. The live `tools/list` is authoritative for what is currently exposed. Current approved cart exposure is limited to `create_cart`, `get_cart`, and `update_cart` when configured; UCP discovery advertises catalog + cart discovery; `cancel_cart`, checkout, customer, order, inventory, and catalog-write tools remain hidden/gated.

### `get_shopify_readonly_config_status`

**Use for:** sanitized status of Shopify read-only bindings/scopes. Does not call Shopify and never exposes secrets.

**Example prompt:** `Is the Shopify read-only connector configured safely?`

**Tool call:**

```json
{"name":"get_shopify_readonly_config_status","arguments":{}}
```

**Actual output excerpt:**

```json
{
  "schemaVersion": "shopify.readonly_config_status.v1",
  "configured": true,
  "bindings": { "clientId": "present", "clientSecret": "present", "shopDomain": "present", "scopes": "present" },
  "shopDomain": { "normalizedDomain": "commonlands-camera-components.myshopify.com" },
  "safety": {
    "readOnly": true,
    "writesShopify": false,
    "createsCart": false,
    "createsCheckout": false,
    "mutatesInventory": false,
    "exposesSecrets": false
  }
}
```

### `read_shopify_products`

**Use for:** live Shopify product truth: Product/Variant GIDs, variant numeric IDs, SKU, price, inventory signals, product URL, media, and optional metafields.

**Example prompt:** `Find live Shopify product truth for CIL250.`

**Tool call:**

```json
{"name":"read_shopify_products","arguments":{"sku":"CIL250","limit":1,"includeMetafields":false}}
```

**Actual output excerpt:**

```json
{
  "schemaVersion": "shopify.live_read.v1",
  "mode": "shopify_admin_graphql_read_only",
  "configured": true,
  "source": { "productTruth": true, "readOnly": true, "writesShopify": false },
  "connector": {
    "status": "ok",
    "messages": ["Exact Shopify SKU search returned no results; retried as safe text search for short part number/MPN metafields."]
  },
  "products": [
    {
      "id": "gid://shopify/Product/7516110946422",
      "handle": "telephoto-25mm-m12-lens-cil250",
      "title": "IR Corrected 25mm M12 Lens",
      "productUrl": "https://commonlands.com/products/telephoto-25mm-m12-lens-cil250",
      "variants": [
        {
          "id": "gid://shopify/ProductVariant/41702699729014",
          "sku": "CIL250-F2.0-M12ANIR",
          "price": "99.00",
          "inventoryQuantity": 0,
          "inventoryTracked": true,
          "storefrontCartPath": "/cart/41702699729014:1"
        }
      ]
    }
  ]
}
```

### `read_shopify_metaobjects` (removed in v0.2.0)

**Removed from the public surface:** Admin metaobject definitions can hold non-public store content, so this tool no longer exists on the public endpoint (Anthropic directory review, 2026-07). Calls return an actionable `-32601` error pointing to `read_shopify_products`, which serves the public product-page data agents actually need.

### `create_cart`

**Use for:** create a Shopify-owned cart from live Shopify ProductVariant GIDs. Current endpoint uses Shopify standard Storefront MCP; Commonlands maps this facade to Shopify's cart create-or-update behavior.

**Example prompt:** `Create a Shopify cart for two units of this live variant ID.`

**Tool call:**

```json
{
  "name": "create_cart",
  "arguments": {
    "cart": {
      "line_items": [
        { "quantity": 2, "item": { "id": "gid://shopify/ProductVariant/41702699729014" } }
      ],
      "context": { "address_country": "US", "address_region": "CA", "postal_code": "92101" }
    }
  }
}
```

**Output contract:** returns `schemaVersion: commonlands.cart_ucp.v1`, `operation: create_cart`, Shopify connector status, Shopify-owned `cart` payload when Shopify returns one, and a safety block showing no checkout/order/customer/inventory/catalog writes by Commonlands.

**Important:** this guide did not execute `create_cart` because it mutates live Shopify cart state. Run only after buyer intent is explicit and the agent has live Variant GIDs from `read_shopify_products`.

### `get_cart`

**Use for:** retrieve/refresh a Shopify-owned cart by cart ID. Read-only from the agent perspective.

**Example prompt:** `Refresh this Shopify cart ID and show the buyer the current state.`

**Tool call:**

```json
{"name":"get_cart","arguments":{"id":"gid://shopify/Cart/example"}}
```

**Actual safe output with a placeholder cart ID:**

```json
{
  "schemaVersion": "commonlands.cart_ucp.v1",
  "mode": "shopify_cart_mcp_proxy",
  "configured": true,
  "operation": "get_cart",
  "persistence": {
    "storedIn": "shopify_cart_mcp",
    "commonlandsWorkerState": "stateless_proxy_no_cart_storage",
    "resumeAcrossAgentSessions": "caller_must_retain_cart_id_or_continue_url"
  },
  "connector": {
    "status": "ok",
    "endpointHost": "commonlands-camera-components.myshopify.com",
    "messages": ["Shopify Cart MCP response did not include structuredContent.cart."]
  },
  "cart": null,
  "safety": { "createsCart": false, "updatesCart": false, "createsCheckout": false, "createsOrder": false }
}
```

### `update_cart`

**Use for:** add variants, update line quantities, or remove line IDs in a Shopify-owned cart.

**Example prompt:** `Change this cart line to quantity 3.`

**Tool call:**

```json
{
  "name": "update_cart",
  "arguments": {
    "id": "gid://shopify/Cart/cart_abc123",
    "cart": {
      "update_items": [
        { "id": "gid://shopify/CartLine/line_abc123", "quantity": 3 }
      ]
    }
  }
}
```

**Output contract:** returns `schemaVersion: commonlands.cart_ucp.v1`, `operation: update_cart`, Shopify connector status, Shopify-owned `cart` payload when Shopify returns one, and safety flags. Quantity `0` removes a line; `remove_line_ids` explicitly removes line IDs.

**Important:** this guide did not execute `update_cart` because it mutates live Shopify cart state.

### `search_catalog`

**Use for:** UCP-style fixture catalog search. Use this when an MCP/UCP shopping agent expects `search_catalog`.

**Example prompt:** `Search the UCP catalog for CIL250.`

**Tool call:**

```json
{"name":"search_catalog","arguments":{"catalog":{"query":"CIL250","limit":1}}}
```

**Actual output excerpt:**

```json
{
  "schemaVersion": "ucp.catalog.v1",
  "ucp": { "version": "2026-04-08", "capability": "search_catalog", "transport": "mcp" },
  "catalog": {
    "products": [
      {
        "id": "gid://commonlands/Product/CIL250",
        "handle": "cil250",
        "title": "CIL250 M12 lens",
        "url": "https://commonlands.com/products/cil250",
        "price_range": { "min": { "amount": 3400, "currency": "USD" } },
        "variants": [ { "id": "gid://commonlands/ProductVariant/CIL250", "sku": "CIL250" } ]
      }
    ]
  },
  "sourceWarning": { "code": "fixture_not_product_truth" }
}
```

### `lookup_catalog`

**Use for:** UCP-style fixture lookup by product, variant, SKU, handle, or URL identifiers.

**Example prompt:** `Look up CIL250 in the UCP catalog.`

**Tool call:**

```json
{"name":"lookup_catalog","arguments":{"catalog":{"ids":["CIL250"]}}}
```

**Actual output excerpt:** same product shape as `search_catalog`, with `ucp.capability` set to `lookup_catalog` and one fixture product for `CIL250`.

### `get_product`

**Use for:** UCP-style fixture product detail by ID.

**Example prompt:** `Get the UCP product record for CIL250.`

**Tool call:**

```json
{"name":"get_product","arguments":{"catalog":{"id":"CIL250"}}}
```

**Actual output excerpt:** same product shape as `search_catalog`, with `ucp.capability` set to `get_product` and one fixture product for `CIL250`.

### `prepare_shopify_purchase_handoff`

**Use for:** non-mutating handoff planning for a SKU and quantity. It does not create a cart or checkout.

**Example prompt:** `Prepare a safe purchase handoff for two CIL250 lenses.`

**Tool call:**

```json
{"name":"prepare_shopify_purchase_handoff","arguments":{"sku":"CIL250","quantity":2,"sensorPartNumber":"IMX477"}}
```

**Actual output excerpt:**

```json
{
  "schemaVersion": "shopify.purchase_handoff.v1",
  "correctionStatus": "fixture_transaction_seam_no_mutation",
  "quantity": 2,
  "product": {
    "sku": "CIL250",
    "title": "CIL250 M12 lens",
    "productUrl": "https://commonlands.com/products/cil250",
    "variantId": "gid://commonlands/ProductVariant/CIL250",
    "selectedVariantIdSource": "fixture_commonlands_gid_non_authoritative"
  },
  "transaction": {
    "mode": "read_only_handoff",
    "cartCheckout": "not_created",
    "createsCart": false,
    "createsCheckout": false,
    "writesShopify": false
  }
}
```

### `get_purchase_route_options`

**Use for:** explain safe purchase paths without mutating commerce state.

**Example prompt:** `What are the safe purchase route options for two CIL250 lenses for prototype evaluation?`

**Tool call:**

```json
{"name":"get_purchase_route_options","arguments":{"sku":"CIL250","quantity":2,"sensorPartNumber":"IMX477","buyerIntent":"prototype evaluation","agentType":"engineering assistant"}}
```

**Actual output excerpt:**

```json
{
  "schemaVersion": "commerce.purchase_routes.v1",
  "correctionStatus": "fixture_dual_channel_transaction_plan_no_mutation",
  "product": { "sku": "CIL250", "productUrl": "https://commonlands.com/products/cil250" },
  "routes": [
    { "channel": "commonlands_mcp_dedicated_purchase", "status": "planned_requires_approval_and_live_connectors" },
    { "channel": "shopify_native_checkout", "status": "planned_requires_shopify_storefront_cart" },
    { "channel": "engineering_review_request", "status": "available_now_non_transactional" }
  ]
}
```

### `recommend_lenses_for_application`

**Use for:** fixture-backed application-specific shortlist. This may later be consolidated into `match_lens_to_sensor`; for now it is still live in `tools/list`.

**Example prompt:** `Recommend M12 lenses for robotics navigation on IMX477 near 50° horizontal FoV.`

**Tool call:**

```json
{"name":"recommend_lenses_for_application","arguments":{"sensorPartNumber":"IMX477","application":"robotics navigation","desiredHorizontalFovDeg":50,"maxResults":2}}
```

**Actual output excerpt:**

```json
{
  "schemaVersion": "recommendations.v1",
  "correctionStatus": "fixture_recommendation_scaffold",
  "recommendations": [
    {
      "lens": { "sku": "CIL250", "title": "CIL250 M12 lens" },
      "score": 100,
      "rank": 1,
      "fit": "excellent",
      "fov": { "horizontalDeg": 51.3, "verticalDeg": 39.6, "diagonalDeg": 61.9 }
    },
    {
      "lens": { "sku": "CIL350", "title": "CIL350 M12 telephoto lens" },
      "score": 98.9,
      "rank": 2,
      "fit": "excellent",
      "fov": { "horizontalDeg": 29.4, "verticalDeg": 22.2, "diagonalDeg": 36.3 }
    }
  ],
  "sourceWarning": { "code": "fixture_not_product_truth" }
}
```

## Hidden or unavailable tools

These are intentionally not part of the current live tool surface:

- `cancel_cart` — hidden because the current confirmed Shopify standard Storefront MCP endpoint does not expose cart cancel. Actual call result: `{ "code": -32601, "message": "Tool not found: cancel_cart" }`.
- `create_checkout`, `get_checkout`, `update_checkout`, `complete_checkout`, `cancel_checkout` — hidden because Checkout MCP is not configured/validated. Actual `create_checkout` call result: `{ "code": -32601, "message": "Tool not found: create_checkout" }`.

## Copy-paste smoke tests

Health check:

```bash
curl -s 'https://mcp.commonlands.com/healthz' | python3 -m json.tool
```

List tools:

```bash
curl -s -X POST 'https://mcp.commonlands.com/mcp' \
  -H 'content-type: application/json' \
  -H 'accept: application/json' \
  -H 'user-agent: Mozilla/5.0 commonlands-mcp-smoke' \
  --data-binary '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | python3 -m json.tool
```

Read live Shopify product truth:

```bash
curl -s -X POST 'https://mcp.commonlands.com/mcp' \
  -H 'content-type: application/json' \
  -H 'accept: application/json' \
  -H 'user-agent: Mozilla/5.0 commonlands-mcp-smoke' \
  --data-binary '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"read_shopify_products","arguments":{"sku":"CIL250","limit":1,"includeMetafields":false}}}' | python3 -m json.tool
```

Compute live FoV for a known Lambda/DynamoDB lens:

```bash
curl -s -X POST 'https://mcp.commonlands.com/mcp' \
  -H 'content-type: application/json' \
  -H 'accept: application/json' \
  -H 'user-agent: Mozilla/5.0 commonlands-mcp-smoke' \
  --data-binary '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"calculate_field_of_view","arguments":{"lensSku":"CIL160","sensorPartNumber":"IMX477"}}}' | python3 -m json.tool
```

Check that checkout is hidden:

```bash
curl -s -X POST 'https://mcp.commonlands.com/mcp' \
  -H 'content-type: application/json' \
  -H 'accept: application/json' \
  -H 'user-agent: Mozilla/5.0 commonlands-mcp-smoke' \
  --data-binary '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"create_checkout","arguments":{"cart_id":"gid://shopify/Cart/example"}}}' | python3 -m json.tool
```

## Safety rules for agents

- Do not invent live price, stock, product URL, Shopify ID, or variant ID from fixture tools. Use `read_shopify_products`.
- Do not call `create_cart` or `update_cart` until the buyer has explicitly selected line items and quantities.
- Do not claim checkout MCP is live. Use Shopify cart/continue URLs for buyer handoff when available.
- Do not ask users for, store, or transmit raw card numbers, CVV/CVC, passwords, payment tokens, or customer-account credentials.
- Do not attempt Shopify product, variant, collection, tag, metafield, inventory, order, customer, discount, RFQ, Acumatica, or database writes.
- Do not expose direct gated datasheet URLs.
- For live FoV, agents call Commonlands MCP only. Agents must not call the AWS Lambda/API Gateway endpoint directly.

## Public endpoint

Use the custom-domain endpoint in public docs and client configs:

`https://mcp.commonlands.com/mcp`

Discovery and health are available at `https://mcp.commonlands.com/.well-known/ucp` and `https://mcp.commonlands.com/healthz`.
