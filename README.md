# Commonlands MCP

Public read-mostly Commonlands MCP server on Cloudflare Workers for lens discovery, optics workflows, safe commerce handoff planning, and gated Shopify commerce proxy experiments.

## Live endpoint

- MCP endpoint: `https://commonlands-mcp.erp-14c.workers.dev/mcp`
- UCP discovery: `https://commonlands-mcp.erp-14c.workers.dev/.well-known/ucp`
- Health check: `https://commonlands-mcp.erp-14c.workers.dev/healthz`

See [`docs/live-usage-and-integrations.md`](docs/live-usage-and-integrations.md) for recommended end-user/agent usage and smoke tests.

## Current scope

- `GET /healthz` returns deploy metadata.
- `GET /.well-known/ucp` returns catalog-only discovery metadata by default.
- `POST /mcp` supports MCP JSON-RPC tools/resources for fixture-backed lens discovery, optics calculations, product details, recommendations, and safe purchase handoff planning.
- `read_shopify_products` is the live read-only Shopify product truth source for purchasable product URLs, Product/Variant GIDs, SKUs, prices, inventory signals, and metafields; `read_shopify_metaobjects` remains a supporting read-only diagnostic.
- Cart UCP tools (`create_cart`, `get_cart`, `update_cart`, `cancel_cart`) are hidden unless `ENABLE_COMMERCE_MUTATION_TOOLS=true` and the endpoint is approved/configured.
- Basic Checkout MCP tools (`create_checkout`, `get_checkout`) are hidden unless `ENABLE_CHECKOUT_MUTATION_TOOLS=true`; extra checkout operations (`update_checkout`, `complete_checkout`, `cancel_checkout`) require `ENABLE_EXTRA_CHECKOUT_MUTATION_TOOLS=true` and official review before use.
- Fixture-backed catalog, recommendation, and legacy purchase-handoff flows are scaffold/status helpers only; do not use them as final truth for SKU recommendations, price, availability, Shopify IDs, variant IDs, exact product specs, or cart/checkout preparation without `read_shopify_products`.
- No Acumatica writes, database writes, direct payment handling, raw card data, customer-account access, inventory mutations, inventory sync changes, Shopify catalog writes, or secret exposure. Commerce mutation tools are hidden by default pending approval.

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
