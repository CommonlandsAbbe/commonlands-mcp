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
- Phase 8 adds fixture-backed purchase-route options for AI agents and robotics engineers, showing the future Commonlands MCP purchase surface, Shopify-native checkout path, and engineering review path without mutating commerce state.
- Phase 9 adds credential-gated Shopify Admin GraphQL reads. `read_shopify_products` is the live read-only product truth path for purchasable product URLs, Product/Variant GIDs, SKUs, prices, inventory signals, and metafields; `read_shopify_metaobjects` remains a supporting diagnostic while fixture-backed catalog and handoff flows stay scaffold-only.
- Phase 10 adds an explicitly scoped Shopify cart proxy for Shopify-owned cart state. With the current standard Storefront MCP `/api/mcp` endpoint, the live surface exposes `create_cart`, `get_cart`, and `update_cart`; `cancel_cart` remains hidden unless a validated UCP Cart MCP endpoint supports cancel semantics. Payment, order, customer, inventory, and catalog writes stay blocked outside Shopify checkout.
- Phase 11 contains an explicitly scoped Shopify Checkout MCP proxy in code, but it is not part of the current live public surface. Checkout requires a validated Shopify Checkout MCP endpoint, Cloudflare protections, operator approval, and `ENABLE_CHECKOUT_MUTATION_TOOLS=true` before `create_checkout`/`get_checkout` may appear. Extra checkout operations (`update_checkout`, `complete_checkout`, `cancel_checkout`) require `ENABLE_EXTRA_CHECKOUT_MUTATION_TOOLS=true` plus official review. `complete_checkout` requires Shopify checkout authentication, verified buyer name/email/phone/address, card/payment authorization, and idempotency; Commonlands never accepts raw payment credentials.
- Later phases replace fixtures with a scheduled joined catalog snapshot and connector-backed enrichment behind tests.

No live Acumatica or database behavior is implemented yet. Shopify behavior is limited to explicit diagnostic read-only tools, the approved Shopify-owned cart proxy surface (`create_cart`, `get_cart`, `update_cart`), and hidden Checkout MCP proxy code that requires endpoint validation plus explicit approval/config before exposure. Checkout completion is only through Shopify Checkout MCP after Shopify-authenticated buyer/payment verification; no direct payment capture, raw card handling, customer-account, RFQ, inventory mutation, inventory sync change, or catalog write tool is implemented.

## Target endpoint

Current live endpoint: `https://mcp.commonlands.com/mcp`. Public docs and client snippets should use the `mcp.commonlands.com` custom domain, with discovery at `https://mcp.commonlands.com/.well-known/ucp` and health at `https://mcp.commonlands.com/healthz`.

## Source-of-truth model for later phases

- DynamoDB/AppSync lens data remains the optical source of truth.
- Shopify is enrichment/commerce only: handles, URLs, variants, price, availability, and public mechanical drawing links.
- Datasheets stay gated through product-page/DocSend flow; the MCP must not emit direct DocSend URLs.
- Acumatica is not part of the MCP write path. No direct Acumatica writes are permitted.
- Future tools must stay read-only unless they have explicit approval, a narrow auth/config model, and tests proving the mutation boundary.

## Safety boundaries

- No Shopify catalog writes.
- No Acumatica writes.
- No database writes.
- No secrets in source control.
- No direct DocSend URLs in fixtures, responses, logs, or docs.
- Cart proxy exposure must stay behind explicit approval/config gates and endpoint capability checks; current live cart exposure is limited to Shopify standard Storefront MCP `create_cart`, `get_cart`, and `update_cart`.
- Checkout MCP proxy code stays hidden until explicit approval/config; no customer-account/order/write tools outside Shopify-managed boundaries.
- Live Shopify reads must remain diagnostic and read-only until audited joined snapshots are ready.
- Public `/mcp` request bodies are capped before JSON parsing, and live connector responses are timeout/size bounded before JSON parsing.

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

Phase 6 adds `get_shopify_ucp_readiness` and the resource `commonlands://compatibility/shopify-ucp`. The response is a conservative launch-planning contract for Shopify Storefront MCP, UCP Catalog compatibility, and a later UCP Cart MCP surface. It is not the live tool-exposure authority; use `tools/list` for the deployed public surface.

It reports:

- the safe UCP catalog target tools Commonlands can map toward: `search_catalog`, `lookup_catalog`, and `get_product`, plus explicit UCP cart tool names when configured;
- a UCP-shaped fixture sample with product IDs, variant IDs, URLs, categories, USD minor-unit prices, availability, and optical metadata;
- explicit non-goals for Shopify checkout, customer-account, order, inventory, and catalog write flows;
- launch blockers for Shopify read-only IDs/metafields, Cloudflare routing, optional UCP profile metadata, and `/sse` compatibility decisions;
- why Commonlands should be better than generic storefront MCP for lens selection: FoV, angular resolution, sensor matching, engineering recommendations, and DynamoDB/AppSync optical provenance.

## Phase 7 MCP surface

Phase 7 exposes the safe read-only subset of the Shopify/UCP catalog direction as fixture-backed contracts:

- `search_catalog` maps a UCP-style `catalog.query` request to the joined Commonlands fixture catalog.
- `lookup_catalog` resolves up to 10 fixture identifiers, including Commonlands GID-style product IDs, variant IDs, SKUs, handles, and product URLs.
- `get_product` returns one UCP-shaped product with variants, USD minor-unit fixture prices, availability status, product URL, public mechanical drawing metadata, gated datasheet policy, and DynamoDB/AppSync optical provenance.
- `prepare_shopify_purchase_handoff` creates a read-only purchase handoff payload with SKU, quantity, fixture variant ID, product URL, product detail contract, and explicit transaction flags proving that no cart, checkout, order, RFQ, inventory mutation, or Shopify write occurred.
- `GET /.well-known/ucp` returns a catalog + cart discovery profile pointing at `/mcp`.

This phase is Commonlands-native and independent: the implementation source of truth is Commonlands optical catalog data plus Shopify-native commerce identifiers. Commonlands now has the contract seam for future Shopify cart/checkout integration without enabling live writes or pretending fixture IDs are production Shopify IDs.

The aliases remain fixture-backed. Live launch still requires Shopify read-only product/variant IDs, price/availability freshness rules, validated public drawing sources, Cloudflare route confirmation, and explicit approval before any transactional tool is implemented. The target is full Shopify integration for commerce handoff and transaction flow, while preserving Commonlands as the optical/spec source of truth.



## Phase 8 MCP surface

Phase 8 adds `get_purchase_route_options` as a fixture-backed transaction-readiness contract for AI agents and robotics engineers. Given a selected SKU, optional quantity, sensor, buyer intent, and agent type, it returns:

- product URL, fixture variant ID, fixture price/availability, and product detail context;
- three route options: future Commonlands MCP dedicated purchase, future Shopify-native checkout, and engineering review request;
- route-specific current safe actions and future tool names;
- hard safety flags proving no cart, checkout, order, RFQ, customer record, inventory reservation, Shopify write, or Commonlands order write occurred;
- launch prerequisites for configured Shopify Cart/Checkout MCP endpoints, live ProductVariant GIDs resolved through `read_shopify_products`, price/availability revalidation, idempotency/audit/rate-limit design, and customer-data policy review.

The tool is not a checkout. It is the typed plan that lets agents preserve optical context and choose the right future purchase path while the public MVP stays read-only and fixture-backed.

## Phase 9 MCP surface

Phase 9 adds live Shopify Admin GraphQL reads behind the existing sanitized Shopify read-only config checks:

- `read_shopify_products` is the live read-only product truth path for product and variant IDs, normalized `id`/`numericId`, product URLs, variant `storefrontCartPath`, SKUs, prices, inventory signals, and selected public metafield/media URL fields by SKU/search or handle-only lookup. SKU/search uses `productVariants`; handle-only lookup uses Shopify `productByHandle` instead of an undocumented `product_handle` variant filter.
- `read_shopify_metaobjects` reads metaobjects by type and optional handle, returning redacted field previews only.

These tools do not mutate commerce state. Fixture-backed catalog, recommendation, UCP, or purchase-handoff flows remain scaffold-only and must not be treated as final SKU, price, availability, Shopify ID, variant ID, exact product spec, cart, or checkout truth without `read_shopify_products`. They return `schemaVersion: shopify.live_read.v1`, sanitized connector/token state, explicit read-only safety flags, and empty results on missing config/scope/token/API errors. Tokens, client secrets, client IDs, authorization headers, carts, checkouts, customers, orders, RFQs, inventory mutations, product writes, metafield writes, metaobject writes, file writes, Acumatica writes, database writes, and inventory sync changes remain out of scope.


## Phase 10 MCP surface

Phase 10 adds a narrow Shopify-owned cart proxy:

- `create_cart` forwards validated line items to Shopify Cart MCP and returns the Shopify-owned cart payload, including `cart.id`, totals/messages, `continue_url`, and `expires_at` when Shopify provides them. For the current standard Storefront MCP endpoint, this is a facade over Shopify `update_cart` create-or-update behavior.
- `get_cart` refreshes a Shopify-owned cart by `cart.id`.
- `update_cart` adds line items, changes line quantities, or removes line IDs in a Shopify-owned cart.
- `cancel_cart` is available only for validated UCP Cart MCP endpoints that support cancel semantics and require `meta["idempotency-key"]` UUID for retry safety. It is hidden for the current standard Storefront MCP endpoint.

Commonlands MCP does not store cart state in a database, KV namespace, Durable Object, cookie, or session memory. Shopify Cart MCP owns cart persistence and mutation. Agents must retain `cart.id` and/or `continue_url` across sessions; if both are lost, Commonlands MCP cannot reliably recover the prior cart.

The cart proxy validates request shape and safety boundaries before forwarding. It rejects customer/buyer fields, non-ProductVariant IDs, invalid cart IDs, and unsupported cancel requests before upstream calls. Checkout completion, payment, order creation, customer records, discounts, inventory reservation/mutation, product writes, metafield writes, Acumatica writes, database writes, and inventory sync changes remain out of scope.

Phase 11 contains a narrow Shopify Checkout MCP proxy in code, but it is not live until the endpoint is validated/configured and explicitly approved:

- When enabled after approval, `create_checkout` would forward a retained Shopify Cart gid or explicit ProductVariant line items to Shopify Checkout MCP and return Shopify-owned checkout handoff state, including checkout ID/URL/totals/messages/expiry when Shopify provides them.
- When enabled after approval, `get_checkout` would refresh Shopify-owned checkout state by checkout ID.
- Extra checkout operations (`update_checkout`, `complete_checkout`, `cancel_checkout`) remain official-review-only; buyer, customer, address, payment, discount, and gift-card fields are rejected by the Worker before forwarding.

Commonlands MCP does not store checkout state in a database, KV namespace, Durable Object, cookie, session memory, customer profile, or payment record. Shopify Checkout MCP owns checkout persistence and mutation. Agents must retain `checkout.id` and/or `checkout.checkout_url` across sessions; if both are lost, Commonlands MCP cannot recover the prior checkout.

The Checkout MCP proxy dispatches `complete_checkout` only when Shopify checkout authentication has already verified name, email, phone, address, and card/payment authorization, and the request includes an idempotency key. Commonlands has no raw payment credential, customer-account, inventory, or catalog write path.
