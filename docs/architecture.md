# Commonlands MCP Architecture

## Current scope

The Worker is being built in PR-sized phases:

- Phase 0 proved deployment and MCP connectivity with `GET /healthz` and initialize-only `POST /mcp`.
- Phase 1 adds fixture-backed read-only catalog tools/resources while real DynamoDB and Shopify credentials/schema are still unconfirmed.
- Phase 2 adds fixture-backed FoV calculation scaffolding with explicit parity warnings while real projection coefficients remain unconfirmed.
- Phase 3 adds fixture-backed engineering recommendation tools for deterministic lens shortlists and tradeoff explanations.
- Phase 4 adds fixture-backed product-page handoff details, including DynamoDB-sourced resolution metadata and gated datasheet policy.
- Phase 5 adds fixture-backed joined snapshot status/validation contracts for future cache and connector work.
- Phase 6 adds fixture-backed Shopify Storefront MCP / UCP Catalog compatibility readiness so Commonlands can interoperate with commerce agents without enabling write flows.
- Phase 7 adds fixture-backed UCP catalog aliases, `/.well-known/ucp`, and a read-only Shopify purchase handoff seam so clients can discover products in Shopify-native shapes without creating transaction state.
- Later phases replace fixtures with a scheduled joined catalog snapshot and connector-backed enrichment behind tests.

No live Shopify, Acumatica, or database behavior is implemented yet. No checkout, cart, inventory mutation, customer-account, order-management, or write tool is implemented.

## Target endpoint

Production target: `https://mcp.commonlands.com/mcp`.

Cloudflare account, route, zone, and deployment environment are placeholders until confirmed by Max/Abbe.

## Source-of-truth model for later phases

- DynamoDB/AppSync lens data remains the optical source of truth.
- Shopify is enrichment/commerce only: handles, URLs, variants, price, availability, and public mechanical drawing links.
- Datasheets stay gated through product-page/DocSend flow; the MCP must not emit direct DocSend URLs.
- Acumatica is not part of the MCP write path. No direct Acumatica writes are permitted.
- All future tools must stay read-only until an explicit approval and auth model exists.

## Safety boundaries

- No Shopify writes.
- No Acumatica writes.
- No database writes.
- No secrets in source control.
- No direct DocSend URLs in fixtures, responses, logs, or docs.
- No checkout/cart/customer-account/order/write tools in the public MVP.

## Deployment metadata

The Worker reads these non-secret vars:

- `ENVIRONMENT`
- `VERSION`
- `GIT_SHA`

Secrets needed by later phases are documented in `docs/secrets.md` and must be configured through Cloudflare/environment secret storage, not committed.

## Phase 1 MCP surface

Phase 1 exposes these read-only methods from fixture-backed catalog data:

- `tools/list`
- `tools/call` for `search_lenses`, `get_lens_details`, and `get_sensor_specs`
- `resources/list`
- `resources/read` for `commonlands://catalog/lenses` and `commonlands://catalog/sensors`

Responses include MCP-style `structuredContent` plus text content for tool calls. Lens responses intentionally return gated datasheet notes instead of direct DocSend URLs. Mechanical drawing URLs are limited to validated HTTPS Commonlands or Shopify CDN hosts.


## Phase 2 MCP surface

Phase 2 adds `compute_fov` as a fixture-backed optics contract. It accepts `lensSku`, `sensorPartNumber`, and optional `workingDistanceMm`, then returns:

- image-circle clipping status and effective sensor dimensions;
- HFOV, VFOV, DFOV, and optional scene width/height;
- angular resolution in px/degree;
- projection model, coefficient count, assumptions, warnings, and calculation model version.

The calculation is intentionally labeled `fixture_parity_scaffold`. It follows the confirmed legacy pattern at a contract level, but production coefficient convention/sign/units must be connected and tested before launch claims.


## Phase 3 MCP surface

Phase 3 adds deterministic, fixture-backed recommendation tools:

- `match_lenses_to_sensor` ranks catalog lenses for one sensor, optional horizontal FoV target, optional working distance, mount filter, and max result count.
- `compare_lenses` ranks a caller-supplied SKU list on the same sensor using the same scoring model.
- `recommend_lenses_for_application` applies lightweight application preferences such as embedded robotics/M12 preference, machine-vision/C-mount preference, low-distortion preference, and fixture stock preference.

Recommendation responses include `schemaVersion: recommendations.v1`, `correctionStatus: fixture_recommendation_scaffold`, ranked lens summaries, FoV/image-circle/angular-resolution outputs, tradeoffs, warnings, and explicit assumptions. The ranking is a deterministic shortlist helper, not final optical design approval. It intentionally excludes live Shopify stock, price breaks, MTF, CRA, and production coefficient parity until the real integrations and audited fields are available.


## Phase 4 MCP surface

Phase 4 adds `get_product_page_details` as a safe commerce-handoff contract. It accepts a Commonlands lens SKU and returns:

- product handle, public product URL, fixture price, availability, and validated mechanical drawing URL when present;
- technical specifications from the optical catalog fixture, including EFL, F-number, image circle, max FoV, projection model, coefficient count, and resolution;
- an explicit `resolution.source` field set to the DynamoDB-backed optical source contract, not Shopify enrichment;
- gated datasheet policy and no direct gated-document URL;
- source provenance for optical and commerce fixture data.

This phase still does not call Shopify, DynamoDB/AppSync, Acumatica, or any live connector at request time. It is the response contract that live adapters must satisfy later.


## Phase 5 MCP surface

Phase 5 adds `get_catalog_snapshot_status` and the resource `commonlands://catalog/snapshot-status`. The response is a connector-free cache-readiness contract with:

- fixture snapshot counts for lenses, sensors, successful joins, missing optical records, missing commerce records, and unsafe URLs;
- validation errors/warnings for duplicate SKUs, missing provenance, invalid sensor dimensions, unsafe product/drawing hosts, and gated-document leakage;
- explicit source provenance for fixture optical and commerce data;
- refresh metadata stating that live connectors are not connected.

This creates the typed seam future AppSync/DynamoDB, Shopify, and cache refresh adapters must satisfy without adding live reads, secrets, or write paths.


## Phase 6 MCP surface

Phase 6 adds `get_shopify_ucp_readiness` and the resource `commonlands://compatibility/shopify-ucp`. The response is a connector-free launch planning contract for Shopify Storefront MCP and UCP Catalog compatibility.

It reports:

- the safe read-only UCP catalog target tools Commonlands can map toward: `search_catalog`, `lookup_catalog`, and `get_product`;
- a UCP-shaped fixture sample with product IDs, variant IDs, URLs, categories, USD minor-unit prices, availability, and optical metadata;
- explicit non-goals for Shopify cart, checkout, customer-account, order, and write flows;
- launch blockers for Shopify read-only IDs/metafields, Cloudflare routing, optional UCP profile metadata, and `/sse` compatibility decisions;
- why Commonlands should be better than generic storefront MCP for lens selection: FoV, angular resolution, sensor matching, engineering recommendations, and DynamoDB/AppSync optical provenance.

## Phase 7 MCP surface

Phase 7 exposes the safe read-only subset of the Shopify/UCP catalog direction as fixture-backed contracts:

- `search_catalog` maps a UCP-style `catalog.query` request to the joined Commonlands fixture catalog.
- `lookup_catalog` resolves up to 10 fixture identifiers, including Commonlands GID-style product IDs, variant IDs, SKUs, handles, and product URLs.
- `get_product` returns one UCP-shaped product with variants, USD minor-unit fixture prices, availability status, product URL, public mechanical drawing metadata, gated datasheet policy, and DynamoDB/AppSync optical provenance.
- `prepare_shopify_purchase_handoff` creates a read-only purchase handoff payload with SKU, quantity, fixture variant ID, product URL, product detail contract, and explicit transaction flags proving that no cart, checkout, order, RFQ, inventory mutation, or Shopify write occurred.
- `GET /.well-known/ucp` returns a catalog-only discovery profile pointing at `/mcp`.

This phase is intentionally more Shopify-native than Sunex's public MCP while staying safer: Sunex exposes useful read-only optics/product tools and order/RFQ links, but no native cart/checkout flow. Commonlands now has the contract seam for future Shopify-native cart/checkout integration without enabling live writes or pretending fixture IDs are production Shopify IDs.

The aliases remain fixture-backed. Live launch still requires Shopify read-only product/variant IDs, price/availability freshness rules, validated public drawing sources, Cloudflare route confirmation, and explicit approval before any transactional tool is implemented.

