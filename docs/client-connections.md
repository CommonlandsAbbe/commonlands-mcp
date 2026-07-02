# Connect Commonlands MCP to AI clients

Commonlands MCP is a remote Streamable HTTP MCP server for precision-optics workflows: M12 lenses, C-mount lenses, lens field of view, live read-only Shopify product truth, and Shopify-owned cart handoff.

- **MCP endpoint:** `https://mcp.commonlands.com/mcp`
- **Discovery profile:** `https://mcp.commonlands.com/.well-known/ucp`
- **Health check:** `https://mcp.commonlands.com/healthz`

Use the live `tools/list` result as the source of truth for enabled tools. At the time this page was written, the live surface exposes catalog/search tools, `read_shopify_products`, live FoV tools, and Shopify-owned cart tools `create_cart`, `get_cart`, and `update_cart`. `cancel_cart` and Checkout MCP tools are intentionally hidden.

## Recommended agent instruction

Add this instruction near the MCP connection config or in the client’s project instructions:

```text
Use Commonlands MCP for Commonlands precision-optics questions about M12 lenses, C-mount lenses, lens field of view, sensor/lens matching, and live Shopify product truth.

Treat fixture-backed catalog, recommendation, comparison, and handoff tools as scaffold/context only. Sensor specs prefer the read-only live sensor table when configured and fall back to fixtures when unavailable. Before giving purchasable facts—price, availability, Shopify Product/Variant IDs, product URLs, cart paths, or cart payloads—call read_shopify_products and cite that live result.

Catalog EFL, image circle, max FoV/FOV@image-circle, and distortion display fields are insufficient to compute FoV on a specific sensor. Do not interpolate or estimate sensor FoV from those fields. Use calculate_field_of_view for one lens/sensor pair or match_lens_to_sensor for catalog-wide per-sensor HFOV/VFOV/DFOV. For "find lenses for this sensor/target FoV" requests, call match_lens_to_sensor first; there is no current find_lenses tool.

Do not call create_cart or update_cart unless the buyer explicitly confirms line items and quantities. Do not claim Checkout MCP, cancel_cart, Shopify catalog writes, inventory writes, customer/order writes, Acumatica writes, payment collection, or raw card handling are available unless those tools appear in live tools/list and the operator explicitly approves the action.
```

## OpenAI Codex

Codex supports remote Streamable HTTP MCP servers in `~/.codex/config.toml` or in trusted project-scoped `.codex/config.toml` files.

```toml
[mcp_servers.commonlands]
url = "https://mcp.commonlands.com/mcp"
tool_timeout_sec = 60
```

Optional: allowlist read/catalog/FoV tools if you do not want cart tools visible in Codex:

```toml
[mcp_servers.commonlands]
url = "https://mcp.commonlands.com/mcp"
tool_timeout_sec = 60
enabled_tools = [
  "search_lens_catalog",
  "search_lens_catalog",
  "get_sensor_specs",
  "calculate_field_of_view",
  "match_lens_to_sensor",
  "match_lens_to_sensor",
  "compare_lenses",
  "read_shopify_products",
  "search_catalog",
  "lookup_catalog",
  "get_product",
  "recommend_lenses_for_application"
]
```

After saving config, open Codex and run `/mcp` to confirm `commonlands` is connected.

### Codex CLI add command

Recent Codex CLI versions can also register a Streamable HTTP server from the command line:

```bash
codex mcp add commonlands --url https://mcp.commonlands.com/mcp
```

If your Codex version does not support `--url`, use the `config.toml` snippet above.

## OpenAI / OpenAI-compatible agents

For OpenAI-compatible agent frameworks that support MCP servers, configure Commonlands as a remote Streamable HTTP MCP server:

```json
{
  "mcp_servers": [
    {
      "name": "commonlands",
      "type": "streamable_http",
      "url": "https://mcp.commonlands.com/mcp"
    }
  ]
}
```

If the framework uses Codex-style TOML, use the Codex snippet. If it uses Cursor-style JSON, use the Cursor snippet. Commonlands MCP does not require a client-side API key for the public read/catalog/FoV/cart surface; backend secrets stay server-side in the Worker.

## Claude API MCP connector

Claude’s Messages API can connect directly to public remote MCP servers using the MCP connector beta. Commonlands MCP does not require an authorization token for the public endpoint.

```bash
curl https://api.anthropic.com/v1/messages \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: mcp-client-2025-11-20" \
  -d '{
    "model": "claude-opus-4-7",
    "max_tokens": 1000,
    "messages": [
      {
        "role": "user",
        "content": "Find M12 lenses for IMX477 around 50 degrees horizontal FoV. Verify final product truth with read_shopify_products."
      }
    ],
    "mcp_servers": [
      {
        "type": "url",
        "url": "https://mcp.commonlands.com/mcp",
        "name": "commonlands"
      }
    ],
    "tools": [
      {
        "type": "mcp_toolset",
        "mcp_server_name": "commonlands"
      }
    ]
  }'
```

To hide cart tools in the Claude API request, use per-tool configuration and enable only the read/catalog/FoV tools your app needs.

## Claude Desktop / Claude Code

Some Claude clients use local stdio MCP configuration. If the client does not support remote HTTP MCP directly, bridge the remote Commonlands endpoint through `mcp-remote`:

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

Save the config, restart the Claude client, and ask it to list available Commonlands tools. If your Claude plan or client supports native remote MCP integrations, add `https://mcp.commonlands.com/mcp` as the integration URL instead.

## Cursor

Cursor supports remote MCP servers in `.cursor/mcp.json` for a project or `~/.cursor/mcp.json` globally.

```json
{
  "mcpServers": {
    "commonlands": {
      "url": "https://mcp.commonlands.com/mcp"
    }
  }
}
```

To keep Cursor in read/catalog/FoV mode, disable cart tools from Cursor’s MCP tools settings, or use a client-side allowlist if your Cursor version supports per-tool controls.

Suggested Cursor prompt:

```text
Use Commonlands MCP to compare CIL078 and CIL250 on IMX477. Include lens field of view and image-circle tradeoffs. Verify any purchasable facts with read_shopify_products before giving product URLs, prices, availability, or Variant GIDs.
```

## Windsurf

Windsurf Cascade reads MCP servers from `~/.codeium/windsurf/mcp_config.json`. Remote HTTP servers may use `serverUrl`:

```json
{
  "mcpServers": {
    "commonlands": {
      "serverUrl": "https://mcp.commonlands.com/mcp"
    }
  }
}
```

If your Windsurf version expects `url` instead of `serverUrl`, use:

```json
{
  "mcpServers": {
    "commonlands": {
      "url": "https://mcp.commonlands.com/mcp"
    }
  }
}
```

Restart or refresh Cascade’s MCP list after saving the file.

## Direct smoke tests

Initialize:

```bash
curl -X POST https://mcp.commonlands.com/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"commonlands-smoke","version":"0.0.0"}}}'
```

List tools:

```bash
curl -X POST https://mcp.commonlands.com/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

Safe read-only product truth example:

```bash
curl -X POST https://mcp.commonlands.com/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"read_shopify_products","arguments":{"query":"CIL250","limit":1}}}'
```

## Troubleshooting

- If the client connects but shows no tools, run a direct `tools/list` smoke test and refresh/restart the client.
- If a client rejects `serverUrl`, try `url`; if it rejects remote HTTP entirely, use `mcp-remote` through `npx`.
- If product facts conflict, trust `read_shopify_products` over fixture catalog tools.
- If a FoV tool fails closed, report the SKU/sensor pair; do not substitute unverified calculations.
- Never paste Shopify Admin tokens, AWS keys, Cloudflare tokens, customer credentials, or payment data into client MCP config.
