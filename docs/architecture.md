# Commonlands MCP Architecture

## Current scope

The Worker is being built in PR-sized phases:

- Phase 0 proved deployment and MCP connectivity with `GET /healthz` and initialize-only `POST /mcp`.
- Phase 1 adds fixture-backed read-only catalog tools/resources while real DynamoDB and Shopify credentials/schema are still unconfirmed.
- Phase 2 adds fixture-backed FoV calculation scaffolding with explicit parity warnings while real projection coefficients remain unconfirmed.
- Phase 3 adds fixture-backed engineering recommendation tools for deterministic lens shortlists and tradeoff explanations.
- Later phases replace fixtures with a scheduled joined catalog snapshot and add product-detail/inventory enrichment behind tests.

No live Shopify, Acumatica, or database behavior is implemented yet. No checkout, cart, inventory mutation, or write tool is implemented.

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
- No checkout/cart/write tools in the public MVP.

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
