# Commonlands MCP

Phase 0 foundation for a read-only Commonlands MCP server on Cloudflare Workers.

## Phase 0 scope

- `GET /healthz` returns deploy metadata.
- `POST /mcp` supports an initialize-only JSON-RPC smoke test.
- No optics/business tools, Shopify writes, Acumatica writes, database writes, or production credentials.

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
