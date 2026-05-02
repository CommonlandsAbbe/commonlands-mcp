# Commonlands MCP

Public read-only Commonlands MCP server on Cloudflare Workers for lens discovery, optics workflows, and safe commerce handoff.

## Live endpoint

- MCP endpoint: `https://commonlands-mcp.erp-14c.workers.dev/mcp`
- UCP discovery: `https://commonlands-mcp.erp-14c.workers.dev/.well-known/ucp`
- Health check: `https://commonlands-mcp.erp-14c.workers.dev/healthz`

See [`docs/live-usage-and-integrations.md`](docs/live-usage-and-integrations.md) for recommended end-user/agent usage and smoke tests.

## Current scope

- `GET /healthz` returns deploy metadata.
- `GET /.well-known/ucp` returns catalog discovery metadata.
- `POST /mcp` supports MCP JSON-RPC tools/resources for fixture-backed lens discovery, optics calculations, product details, recommendations, and safe purchase handoff planning.
- No live Shopify writes, Acumatica writes, database writes, cart/checkout/order/customer/inventory mutations, or production credentials.

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
