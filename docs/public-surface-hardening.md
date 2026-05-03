# Public MCP surface hardening — 2026-05-03

Commonlands MCP is public/read-mostly by default. Commerce mutation tools exist in code for proxy coverage, but they are hidden from `tools/list` and blocked in `tools/call` unless explicit environment gates are enabled after approval.

## Default public surface

Default `tools/list` excludes Cart UCP and Checkout MCP mutation tools. The default UCP discovery profile advertises catalog capabilities only. `get_shopify_ucp_readiness` reports commerce mutations as hidden pending approval.

## Commerce gates

- `ENABLE_COMMERCE_MUTATION_TOOLS=true` exposes Cart UCP tools: `create_cart`, `get_cart`, `update_cart`, `cancel_cart`.
- `ENABLE_CHECKOUT_MUTATION_TOOLS=true` exposes approved basic Checkout MCP tools: `create_checkout`, `get_checkout`.
- `ENABLE_EXTRA_CHECKOUT_MUTATION_TOOLS=true` exposes extra checkout operations (`update_checkout`, `complete_checkout`, `cancel_checkout`) and should require official review before use.

Endpoint allowlist is intentionally narrow: cart and checkout proxy endpoints must be HTTPS on `commonlands.com` and must use the expected `/api/ucp/mcp` or `/api/checkout/mcp` path.

## Request and downstream caps

- `/mcp` rejects request bodies over 64 KiB before JSON-RPC parsing.
- Shopify read/cart/checkout outbound calls use an AbortController timeout.
- Downstream JSON responses are read as text and capped at 256 KiB before parsing.

## Lambda/FoV backend gate

`compute_fov` is fixture-local unless `FOV_LIVE_BACKEND_ENABLED=true`. When enabled, the Worker calls only the allowlisted HTTPS API Gateway endpoint `https://ia97wrz7ag.execute-api.us-west-2.amazonaws.com/default/fov`, sends `FOV_API_KEY` server-side as `x-api-key`, and applies outbound timeout/response caps. The Worker still has no AWS credentials.

Worker-side `compute_fov` rejects unsafe identifiers and unbounded working distances before lookup. Lambda must repeat validation independently, require authentication, and use exact-resource read-only DynamoDB IAM.
