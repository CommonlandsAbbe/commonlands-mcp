# Commonlands MCP

Public read-mostly Commonlands MCP server on Cloudflare Workers for lens discovery, optics workflows, safe commerce handoff, explicitly scoped Shopify Cart UCP, and explicitly scoped Shopify Checkout MCP handoff.

## Live endpoint

- MCP endpoint: `https://commonlands-mcp.erp-14c.workers.dev/mcp`
- UCP discovery: `https://commonlands-mcp.erp-14c.workers.dev/.well-known/ucp`
- Health check: `https://commonlands-mcp.erp-14c.workers.dev/healthz`

See [`docs/live-usage-and-integrations.md`](docs/live-usage-and-integrations.md) for recommended end-user/agent usage and smoke tests.

## Current scope

- `GET /healthz` returns deploy metadata.
- `GET /.well-known/ucp` returns catalog + cart/checkout discovery metadata.
- `POST /mcp` supports MCP JSON-RPC tools/resources for fixture-backed lens discovery, optics calculations, product details, recommendations, and safe purchase handoff planning.
- Two credential-gated diagnostic tools can read Shopify Admin product/variant/metaobject summary data when approved read-only Shopify config is present: `read_shopify_products` and `read_shopify_metaobjects`.
- Four explicitly scoped Cart UCP tools proxy Shopify-owned cart state when `SHOPIFY_CART_MCP_ENDPOINT` is configured: `create_cart`, `get_cart`, `update_cart`, and `cancel_cart`.
- Five explicitly scoped Checkout MCP tools proxy Shopify-owned checkout state when `SHOPIFY_CHECKOUT_MCP_ENDPOINT` is configured: `create_checkout`, `get_checkout`, `update_checkout`, `complete_checkout`, and `cancel_checkout`; `complete_checkout` requires Shopify checkout authentication plus verified name, email, phone, address, and card/payment authorization.
- Fixture-backed catalog and purchase-handoff flows remain the default user-facing behavior until live catalog joins are validated.
- No Acumatica writes, database writes, direct payment handling, raw card data, customer-account access, inventory mutations, inventory sync changes, Shopify catalog writes, or secret exposure. Checkout completion is only via Shopify Checkout MCP after Shopify-authenticated payment/identity verification.

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
