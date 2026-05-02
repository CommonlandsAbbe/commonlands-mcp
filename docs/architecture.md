# Commonlands MCP Architecture

## Phase 0 scope

This repository starts with a minimal Cloudflare Worker that proves deployment and MCP connectivity only:

- `GET /healthz` returns service metadata.
- `POST /mcp` accepts JSON-RPC and supports `initialize` only.
- All other MCP methods return `-32601 Method not found` until later phases implement read-only tools/resources.

No optics, product, inventory, checkout, Shopify, Acumatica, or database behavior is implemented in Phase 0.

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
- No checkout/cart/write tools in Phase 0.

## Deployment metadata

The Worker reads these non-secret vars:

- `ENVIRONMENT`
- `VERSION`
- `GIT_SHA`

Secrets needed by later phases are documented in `docs/secrets.md` and must be configured through Cloudflare/environment secret storage, not committed.
