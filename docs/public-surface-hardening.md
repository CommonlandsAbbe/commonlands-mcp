# Public MCP surface hardening — 2026-05-03

Commonlands MCP is public/read-mostly for catalog and product truth, with a narrow approved Shopify-owned cart proxy when commerce mutation gates and endpoint bindings are configured. Commerce mutation tools exist in code for proxy coverage, but visibility is fail-closed: tools are hidden from `tools/list` and blocked in `tools/call` unless explicit environment gates and endpoint capability checks pass.

## Public surface

The current live `tools/list` is authoritative. As of 2026-05-03 PDT, the deployed public surface exposes 21 tools, including Shopify standard Storefront MCP cart tools `create_cart`, `get_cart`, and `update_cart`. `cancel_cart` is hidden because the current standard `/api/mcp` endpoint does not expose cancel. Checkout MCP tools remain hidden. The default UCP discovery profile advertises catalog capabilities only. `get_shopify_ucp_readiness` is conservative scaffold/readiness metadata, not the live exposure authority.

## Commerce gates

- `ENABLE_COMMERCE_MUTATION_TOOLS=true` may expose cart tools only when `SHOPIFY_CART_MCP_ENDPOINT` is approved/configured. For Shopify standard Storefront MCP `/api/mcp`, expose `create_cart`, `get_cart`, and `update_cart` only.
- `cancel_cart` is exposed only when the configured cart endpoint supports UCP Cart MCP cancel semantics; it must stay hidden for the current standard Storefront MCP endpoint.
- `ENABLE_CHECKOUT_MUTATION_TOOLS=true` exposes approved basic Checkout MCP tools: `create_checkout`, `get_checkout`.
- `ENABLE_EXTRA_CHECKOUT_MUTATION_TOOLS=true` exposes extra checkout operations (`update_checkout`, `complete_checkout`, `cancel_checkout`) and should require official review before use.

Endpoint allowlist is intentionally narrow: cart and checkout proxy endpoints must be HTTPS on approved Commonlands merchant hosts (`commonlands.com` or `commonlands-camera-components.myshopify.com`) and must use expected Shopify MCP paths (`/api/mcp`, `/api/ucp/mcp`, or `/api/checkout/mcp` as appropriate).

## Request and downstream caps

- `/mcp` rejects request bodies over 64 KiB before JSON-RPC parsing.
- Shopify read/cart/checkout outbound calls use an AbortController timeout.
- Downstream JSON responses are read as text and capped at 256 KiB before parsing.

## Lambda/FoV backend gate

`compute_fov` is fixture-local unless `FOV_LIVE_BACKEND_ENABLED=true`. When enabled, the Worker calls only the allowlisted HTTPS API Gateway endpoint `https://ia97wrz7ag.execute-api.us-west-2.amazonaws.com/default/fov`, sends `FOV_API_KEY` server-side as `x-api-key`, and applies outbound timeout/response caps. The Worker still has no AWS credentials.

Worker-side `compute_fov` rejects unsafe identifiers and unbounded working distances before lookup. Lambda must repeat validation independently, require authentication, and use exact-resource read-only DynamoDB IAM.
