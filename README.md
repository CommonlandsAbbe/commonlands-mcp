# Commonlands MCP

Public Commonlands MCP server on Cloudflare Workers for lens discovery, optics workflows, live read-only Shopify product truth, live FoV calculation, and Shopify-owned cart handoff.

## Live endpoint

- MCP endpoint: `https://commonlands-mcp.erp-14c.workers.dev/mcp`
- UCP discovery: `https://commonlands-mcp.erp-14c.workers.dev/.well-known/ucp`
- Health check: `https://commonlands-mcp.erp-14c.workers.dev/healthz`

See [`docs/live-usage-and-integrations.md`](docs/live-usage-and-integrations.md) for the human-first live guide, recommended agent workflow, tool reference, and smoke tests.

## Current scope

- `GET /healthz` returns deploy metadata.
- `GET /.well-known/ucp` returns catalog-only discovery metadata by default.
- `POST /mcp` supports MCP JSON-RPC tools/resources. Current live `tools/list` shows 21 tools.
- `read_shopify_products` is the live read-only Shopify product truth source for purchasable product URLs, Product/Variant GIDs, SKUs, prices, inventory signals, and metafields; `read_shopify_metaobjects` remains a supporting read-only diagnostic.
- `compute_fov` and `compute_fov_catalog` use the authenticated AWS Lambda/DynamoDB backend when configured, with the API key kept server-side in the Worker. Agent-facing FoV responses are allowlisted and never return raw distortion coefficients. Fixture math is used only when the live backend is disabled.
- Cart tools exposed in the current live surface: `create_cart`, `get_cart`, and `update_cart`. Cart state is owned by Shopify; the Worker is a stateless proxy.
- `cancel_cart` and Checkout MCP tools (`create_checkout`, `get_checkout`, `update_checkout`, `complete_checkout`, `cancel_checkout`) are hidden on the current live surface.
- Fixture-backed catalog, sensor, recommendation, comparison, and legacy purchase-handoff flows are scaffold/status helpers only; do not use them as final truth for SKU recommendations, price, availability, Shopify IDs, variant IDs, exact product specs, or cart/checkout preparation without `read_shopify_products`.
- No Acumatica writes, database writes, direct payment handling, raw card data, customer-account access, inventory mutations, inventory sync changes, Shopify catalog writes, or secret exposure.

## Local commands

```bash
npm install
npm run verify
npm run dev
```

## Endpoints

```bash
curl http://localhost:8787/healthz
curl -X POST http://localhost:8787/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}'
```
