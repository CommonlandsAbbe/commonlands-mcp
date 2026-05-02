# Implementation Plan

Source reference: `/Users/maxbot1/agents202602/clawd-zernike/references/mcp/commonlands-mcp-phased-implementation-plan.md`.

The repo is being built in PR-sized phases. Each phase must preserve the public read-only boundary, pass lint/typecheck/tests, and avoid secrets or live production writes.

## Completed phases

1. **Phase 0 — Worker foundation**
   - Cloudflare Worker scaffold.
   - TypeScript strict mode.
   - Lint, typecheck, tests, and CI.
   - `GET /healthz` deploy smoke endpoint.
   - `POST /mcp` initialize JSON-RPC smoke endpoint.
   - Architecture, data audit, and secrets documentation.

2. **Phase 1 — Fixture-backed catalog baseline**
   - `tools/list`, `tools/call`, `resources/list`, and `resources/read`.
   - Tools: `search_lenses`, `get_lens_details`, `get_sensor_specs`.
   - Resources: `commonlands://catalog/lenses`, `commonlands://catalog/sensors`.
   - Safe public URL validation and DocSend leak guardrails.

3. **Phase 2 — Fixture-backed FoV parity scaffold**
   - Tool: `compute_fov`.
   - Uses fixture catalog records only.
   - Clips sensor active area by image circle, computes FoV from EFL, caps by max FoV, and reports angular resolution as pixels/degree.
   - Results are explicitly labeled `fixture_parity_scaffold` until real coefficient conventions and production parity fixtures are confirmed.

4. **Phase 3 — Fixture-backed recommendation engine**
   - Tools: `match_lenses_to_sensor`, `compare_lenses`, `recommend_lenses_for_application`.
   - Uses deterministic scoring over fixture catalog + FoV outputs.
   - Explains image-circle coverage, FoV target fit, mount/application preferences, availability uncertainty, and wide-angle/distortion tradeoffs.
   - Results are explicitly labeled `fixture_recommendation_scaffold` until production ranking inputs are audited.

5. **Phase 4 — Fixture-backed product page detail contract**
   - Tool: `get_product_page_details`.
   - Returns public product URL, handle, fixture price/availability, validated drawing URL, gated datasheet policy, and optical specs.
   - Treats lens `resolution` as a DynamoDB/AppSync optical catalog field, not Shopify enrichment.
   - Results are explicitly labeled `fixture_commerce_handoff` until live read-only connectors are approved and configured.

6. **Phase 5 — Fixture-backed joined snapshot status contract**
   - Tool: `get_catalog_snapshot_status`.
   - Resource: `commonlands://catalog/snapshot-status`.
   - Reports snapshot counts, validation status, source provenance, and connector/cache readiness.
   - Keeps future AppSync/DynamoDB, Shopify, and cache adapters behind a tested read-only contract.

7. **Phase 6 — Fixture-backed Shopify/UCP compatibility readiness**
   - Tool: `get_shopify_ucp_readiness`.
   - Resource: `commonlands://compatibility/shopify-ucp`.
   - Maps existing Commonlands catalog/product-detail surfaces toward safe read-only Shopify Storefront MCP and UCP Catalog concepts.
   - Documents why cart, checkout, customer-account, order, and write flows remain absent from the public MVP.
   - Provides UCP-shaped fixture product/variant samples with USD minor-unit prices and optical metadata, without live Shopify calls.

8. **Phase 7 — Fixture-backed UCP catalog aliases and Shopify handoff seam**
   - Tools: `search_catalog`, `lookup_catalog`, `get_product`, `prepare_shopify_purchase_handoff`.
   - Endpoint: `GET /.well-known/ucp` advertises read-only catalog search/lookup capabilities and points clients at `/mcp`.
   - Exposes UCP-shaped product/variant responses with Commonlands optical metadata, minor-unit USD fixture prices, public product URLs, and gated datasheet policy.
   - Unknown UCP identifiers return successful `not_found` messages instead of leaking internals.
   - Purchase handoff returns selected SKU, fixture variant ID, product URL, quantity, and explicit no-mutation transaction status; it does not create carts, checkout, orders, RFQs, or Shopify writes.
   - This establishes a connector-free Commonlands catalog/search/handoff contract while keeping the implementation fully Commonlands-owned and pointed toward Shopify-native commerce.

## Still out of scope

- Live AppSync/DynamoDB reads or scans.
- Shopify API calls or writes. Fixture UCP aliases and purchase handoff are static contracts only.
- Acumatica reads/writes.
- Inventory, cart, checkout, RFQ, customer-account, or order mutation.
- Direct DocSend URLs.
- Production secrets in source control.
