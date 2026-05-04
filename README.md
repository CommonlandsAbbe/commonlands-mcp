# Commonlands MCP

Public Model Context Protocol (MCP) server for Commonlands precision optics. It helps agents search M12 lenses and C-mount lenses, compute lens field of view, compare optical tradeoffs, verify live Shopify product truth, and hand off to Shopify-owned carts safely.

## Live endpoint

- MCP endpoint: `https://mcp.commonlands.com/mcp`
- UCP discovery: `https://mcp.commonlands.com/.well-known/ucp`
- Health check: `https://mcp.commonlands.com/healthz`
- Client setup guide: [`docs/client-connections.md`](docs/client-connections.md)
- Live usage guide: [`docs/live-usage-and-integrations.md`](docs/live-usage-and-integrations.md)

## What agents can do

- Search fixture-backed Commonlands optical catalog data for M12 lenses, C-mount lenses, focal length, mount, lens type, and application fit.
- Compute lens field of view with `compute_fov` for one lens/sensor pair or `compute_fov_catalog` for catalog-wide FoV on one sensor.
- Compare lenses and rank candidates for machine vision, robotics, and embedded vision applications.
- Verify live purchasable truth with `read_shopify_products`: Shopify Product/Variant GIDs, SKU, product URL, price, media, and inventory signals.
- Create or update Shopify-owned carts only when cart tools are visible in live `tools/list` and the buyer has confirmed line items and quantities.

## Safety boundaries

- Fixture-backed catalog, sensor, recommendation, comparison, and handoff tools are scaffold/context only.
- Use `read_shopify_products` before quoting price, availability, Shopify IDs, Variant GIDs, product URLs, or cart-ready payloads.
- Cart state is owned by Shopify; the Worker is stateless.
- `cancel_cart` and Checkout MCP tools are hidden on the current live surface.
- No Acumatica writes, database writes, direct payment handling, raw card data, customer-account access, inventory mutations, inventory sync changes, Shopify catalog writes, or secret exposure.
- For live FoV, agents call Commonlands MCP only. Do not call the AWS Lambda/API Gateway backend directly.

## Quick connect

### OpenAI Codex

Add this to `~/.codex/config.toml` or a trusted project `.codex/config.toml`:

```toml
[mcp_servers.commonlands]
url = "https://mcp.commonlands.com/mcp"
tool_timeout_sec = 60
```

Then run `/mcp` in Codex and confirm `commonlands` is connected.

### Claude Desktop / Claude Code via `mcp-remote`

Claude Desktop-style local MCP configs can bridge to the remote HTTP server with `mcp-remote`:

```json
{
  "mcpServers": {
    "commonlands": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.commonlands.com/mcp"]
    }
  }
}
```

### Cursor

Add this to `.cursor/mcp.json` in a project or `~/.cursor/mcp.json` globally:

```json
{
  "mcpServers": {
    "commonlands": {
      "url": "https://mcp.commonlands.com/mcp"
    }
  }
}
```

### Windsurf

Add this to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "commonlands": {
      "serverUrl": "https://mcp.commonlands.com/mcp"
    }
  }
}
```

See [`docs/client-connections.md`](docs/client-connections.md) for OpenAI/Codex, Claude API, Claude Desktop, Cursor, and Windsurf examples.

## Good prompts

- `Find M12 lenses for an IMX477 sensor around 50° horizontal FoV. Verify live Shopify product truth before recommending a purchasable SKU.`
- `Compare CIL078 and CIL250 on IMX477. Include image circle coverage, horizontal/vertical/diagonal FoV, and tradeoffs.`
- `Find the live Shopify product and variant ID for CIL250. Do not create a cart.`
- `List available Commonlands MCP tools and explain which are fixture-backed, live read-only Shopify truth, live FoV, or Shopify-owned cart tools.`

## Local development

The canonical public MCP endpoint is always `https://mcp.commonlands.com/mcp`. The `localhost:8787` URLs below are only for a local Wrangler dev server and should not be used in public metadata or client configuration.

Requirements: Node.js 22+.

```bash
npm install
npm run verify
npm run dev
```

Local smoke test:

```bash
curl http://localhost:8787/healthz
curl -X POST http://localhost:8787/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Deploy

Use `--keep-vars` so dashboard-managed Cloudflare vars/secrets are preserved:

```bash
./node_modules/.bin/wrangler deploy --keep-vars
```

Do not deploy unverified changes. Run `npm run verify` first.
