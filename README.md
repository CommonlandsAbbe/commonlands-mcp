# Commonlands MCP

Public MCP server for Commonlands precision optics. Use it to choose M12/C-mount lenses, calculate field of view, verify live Shopify product truth, and hand buyers to Shopify-owned carts safely.

## Connect

- MCP endpoint: `https://mcp.commonlands.com/mcp`
- UCP discovery: `https://mcp.commonlands.com/.well-known/ucp`
- Health check: `https://mcp.commonlands.com/healthz`
- Client setup details: [`docs/client-connections.md`](docs/client-connections.md)
- Agent instruction guide: [`docs/agent-instructions.md`](docs/agent-instructions.md)
- Full live guide: [`docs/live-usage-and-integrations.md`](docs/live-usage-and-integrations.md)

## Copy-paste agent instruction

```text
Use Commonlands MCP at https://mcp.commonlands.com/mcp for lens selection. Start with tools/list. Catalog EFL, image circle, max FoV/FOV@image-circle, and distortion display fields are insufficient to compute FoV on a specific sensor; do not interpolate or estimate sensor FoV from those fields. Use calculate_field_of_view for one lens/sensor pair, match_lens_to_sensor for sensor/target-FoV selection, search_lens_catalog for broad catalog discovery, and get_lens_distortion_profile for distortion status. Preserve the returned method, distortion_model, coverage_ok, image_circle_mm, sensor_diagonal_mm, and rectilinear_comparison. Call read_shopify_products before stating live price, availability, Product/Variant GIDs, URL, SKU, media, metafields, inventory, or cart payload. Only call create_cart/update_cart after the buyer confirms exact live Variant GIDs and quantities. Checkout tools are not live unless they appear in tools/list. Never ask for card data or perform Shopify catalog/inventory/order/customer writes.
```

## Agent workflow

1. Call `tools/list` and trust the live list over docs.
2. For sensor-specific lens finding, call `match_lens_to_sensor` first, then call `calculate_field_of_view` for final candidate lens/sensor FoV claims.
3. Use `search_lens_catalog` only for broad SKU/title/mount/lens-type discovery. It does not replace per-sensor FoV calculation.
4. Get per-object grounding with `resources/read` for `commonlands://sensors/{part}` or `commonlands://lenses/{sku}` when needed.
5. Use `get_lens_distortion_profile` for distortion/model/status questions. Do not invent polynomial coefficients or claim measured correction when the response says source-display-only.
6. Use `prompts/list` / `prompts/get` with `select_lens_for_sensor_fov_working_distance` when a client surfaces MCP prompts.
7. Verify purchasable truth with `read_shopify_products` before quoting final SKU, URL, price, availability, Shopify IDs, or cart payloads.
8. Create/update a Shopify cart only after explicit buyer confirmation of line items and quantities.
9. Send the buyer to Shopify's returned cart/checkout URL. Do not claim Checkout MCP is live until checkout tools appear in `tools/list`.

## FoV rule

Catalog EFL, image circle, max FoV/FOV@image-circle, and distortion display fields are insufficient to compute field of view on a specific sensor. Agents must not interpolate interior-sensor FoV or substitute their own calculations. Use `calculate_field_of_view`, then preserve returned `hfov_deg`, `vfov_deg`, `dfov_deg`, `method`, `distortion_model`, `coverage_ok`, `image_circle_mm`, `sensor_diagonal_mm`, `rectilinear_comparison`, and provenance/source metadata in the answer.

## Truth hierarchy

1. `read_shopify_products` = live Shopify product truth.
2. `calculate_field_of_view` / `match_lens_to_sensor` = **live FoV backend** (AWS Lambda + DynamoDB lens catalog) when configured. Sensor inputs resolve through the live DynamoDB sensor catalog with fixture fallback. These are the routed public optics tools.
3. Compatibility aliases (`compute_fov`, `compute_fov_catalog`, `match_lenses_to_sensor`) still dispatch where practical, but new clients should route through the intent-named tools above.
4. Ranking tools (`match_lens_to_sensor`, `recommend_lenses_for_application`, `compare_lenses`) rank against **live FoV-backend specs and field of view** when the live backend is enabled, so they use real per-SKU specs (EFL, mount, image circle, FoV). They still exclude live Shopify stock/price/variant IDs; use `read_shopify_products` for purchasable truth. If the live backend is unconfigured they fall back to fixture scaffold.
5. The remaining fixture catalog/product-page tools = useful engineering context, not final commerce truth. If the live backend is ever unconfigured, FoV tools fail closed and sensor lookups fall back to a small reference fixture.

If fixture data conflicts with `read_shopify_products` or the live FoV/sensor backends, use the live truth.

### Data sources

- **Sensors** (`commonlands://sensors/{part}` and the sensor used by `calculate_field_of_view` / `match_lens_to_sensor`): read from the Commonlands DynamoDB sensor table by part number when configured, with fixture fallback. Pixel pitch and pixel counts come straight from that table; active-area mm is derived as `pixels x pitch`.
- **Lenses** (`commonlands://lenses/{sku}`, `calculate_field_of_view`, `match_lens_to_sensor`, `search_lens_catalog`): the FoV Lambda reads lens optical parameters from its DynamoDB lens table when configured. Catalog-wide matching covers the full lens table when backend scanning is enabled.
- **Distortion coefficients** are computed server-side inside the Lambda and are never returned to clients. If the live backend only returns a display distortion string, MCP returns an honest `distortion_model` / `distortion_status` and does not claim measured polynomial correction.

## Current live surface

The production surface currently exposes catalog/search, FoV, Shopify read-only, cart, UCP catalog, and purchase-handoff tools. Checkout tools and `cancel_cart` are intentionally hidden unless they appear in live `tools/list`.

Key tools:

- Public optics routing: `calculate_field_of_view`, `match_lens_to_sensor`, `search_lens_catalog`, `get_lens_distortion_profile`.
- Compatibility/context: `search_lenses`, `search_catalog`, `get_lens_details`, `get_product_page_details`, `get_product`, `lookup_catalog`, `match_lenses_to_sensor`, `compare_lenses`, `recommend_lenses_for_application`.
- Resources/prompts: `commonlands://sensors/{part}`, `commonlands://lenses/{sku}`, `commonlands://catalog/sensors`, `commonlands://catalog/lenses`, and prompt `select_lens_for_sensor_fov_working_distance`.
- Live Shopify read-only truth: `read_shopify_products`, `read_shopify_metaobjects`, `get_shopify_readonly_config_status`.
- Buyer-confirmed Shopify cart handoff: `create_cart`, `get_cart`, `update_cart` when visible in `tools/list`.
- Diagnostics/readiness: `get_catalog_snapshot_status`, `get_shopify_ucp_readiness`, `prepare_shopify_purchase_handoff`, `get_purchase_route_options`.

## Safety boundaries

- Do not use fixture prices, availability, product URLs, SKU variants, or IDs as final commerce truth.
- Do not create or update carts unless the buyer has confirmed live Variant GIDs and quantities.
- Do not use Checkout MCP yet; checkout endpoints will be enabled later after validation and approval.
- Do not ask for or transmit card numbers, CVV/CVC, payment tokens, passwords, or customer account credentials.
- Do not perform Shopify product, variant, collection, tag, metafield, inventory, order, customer, discount, RFQ, Acumatica, or database writes.
- Do not expose gated datasheet URLs or backend secrets.
- For live FoV, call Commonlands MCP only. Do not call the AWS Lambda/API Gateway backend directly.

## Good prompts

- `Find M12 lenses for IMX477 around 50° horizontal FoV. Use match_lens_to_sensor, calculate_field_of_view, then verify the final purchasable SKU with read_shopify_products.`
- `Compare CIL078 and CIL250 on IMX477. Preserve rectilinear_comparison and label fixture-backed context separately from live Shopify truth.`
- `Find the live Shopify Product and Variant GID for CIL250. Return URL, SKU, price, inventory signal, and cart path, but do not create a cart.`
- `Create a Shopify cart for two units of this live Variant GID: <gid>. The buyer has confirmed quantity 2.`
- `List Commonlands MCP tools and classify each as fixture context, live FoV, live Shopify read-only, or Shopify cart.`

## Observability

The Worker can write privacy-safe request/tool telemetry when a Cloudflare Analytics Engine binding named `MCP_ANALYTICS` is configured. Telemetry records only method, path, MCP method, tool name, status, client label, environment/version, HTTP status, and duration. It does **not** record request arguments, Shopify payloads, customer data, product IDs, cart IDs, secrets, or response bodies.

Example binding:

```toml
[[analytics_engine_datasets]]
binding = "MCP_ANALYTICS"
dataset = "commonlands_mcp_events"
```

After deploy, verify that telemetry is live:

```bash
curl https://mcp.commonlands.com/healthz
curl -X POST https://mcp.commonlands.com/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'mcp-client-name: telemetry-smoke' \
  -d '{"jsonrpc":"2.0","id":"telemetry-smoke","method":"tools/list","params":{}}'
```

`/healthz` should report `"telemetry":{"analyticsEngine":"configured"}`. Then query the `commonlands_mcp_events` Analytics Engine dataset. Column order is `blob1=request method`, `blob2=path`, `blob3=MCP method`, `blob4=tool`, `blob5=status`, `blob6=client`, `blob7=environment`, `blob8=version`, `double1=HTTP status`, and `double2=duration ms`.

Tool usage rollup:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CLOUDFLARE_ANALYTICS_READ_TOKEN" \
  --data "SELECT blob4 AS tool, blob5 AS status, SUM(_sample_interval) AS calls, SUM(_sample_interval * double2) / SUM(_sample_interval) AS avg_duration_ms FROM commonlands_mcp_events WHERE timestamp >= NOW() - INTERVAL '7' DAY AND blob3 = 'tools/call' GROUP BY tool, status ORDER BY calls DESC LIMIT 50 FORMAT JSON"
```

Client/tool rollup:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CLOUDFLARE_ANALYTICS_READ_TOKEN" \
  --data "SELECT blob6 AS client, blob4 AS tool, SUM(_sample_interval) AS calls, SUM(_sample_interval * double2) / SUM(_sample_interval) AS avg_duration_ms FROM commonlands_mcp_events WHERE timestamp >= NOW() - INTERVAL '7' DAY AND blob3 = 'tools/call' AND blob5 = 'ok' GROUP BY client, tool ORDER BY calls DESC LIMIT 100 FORMAT JSON"
```

Use `blob4` to see which MCP tools agents actually call. High-call/high-success tools are candidates for deeper investment; low-call or repeated-error tools are candidates for better descriptions, consolidation, or deprecation. Keep Cloudflare invocation logs enabled for request/response metadata, but use Analytics Engine for tool-level decisions because it captures the JSON-RPC method and tool name without storing request arguments.

## Quick client setup

### Codex

```toml
[mcp_servers.commonlands]
url = "https://mcp.commonlands.com/mcp"
tool_timeout_sec = 60
```

### Claude Desktop / Claude Code via `mcp-remote`

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

```json
{
  "mcpServers": {
    "commonlands": {
      "url": "https://mcp.commonlands.com/mcp"
    }
  }
}
```

## Configuration

Non-secret config lives in `wrangler.toml` `[vars]`; credentials are Worker secrets set via the Cloudflare dashboard or `wrangler secret put` (never committed).

| Setting | Where | Purpose |
| --- | --- | --- |
| `account_id` | `wrangler.toml` | Pins the Cloudflare account so deploys do not call `/memberships` (which an account-scoped API token cannot access, surfacing as auth error `9106`). |
| `FOV_LIVE_BACKEND_ENABLED` | `[vars]` | `"true"` routes FoV through the live Lambda backend. |
| `FOV_LAMBDA_ENDPOINT` | `[vars]` | Allowlisted FoV Lambda/API Gateway URL. |
| `FOV_BACKEND_SCANS_FULL_CATALOG` | `[vars]` | `"true"` makes `compute_fov_catalog` omit `partNums` so the Lambda scans its full DynamoDB lens table. Requires `ALLOW_LENS_SCAN=true` on the Lambda. When `"false"`, the Worker sends fixture SKUs as a fallback. |
| `SENSOR_DDB_TABLE` | `[vars]` | DynamoDB sensor table name. |
| `SENSOR_DDB_REGION` | `[vars]` | DynamoDB sensor table region. |
| `FOV_API_KEY` | **secret** | Shared key the Worker sends to the FoV Lambda (`x-api-key`); must match the Lambda's `FOV_API_KEY` exactly (byte-for-byte, no trailing newline). |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | **secret** | Read-only IAM user credentials the Worker uses to read the sensor DynamoDB table (SigV4). |
| `CLOUDFLARE_API_TOKEN` | **GitHub Actions secret** | Token with `Workers Scripts: Edit` used by the Deploy workflow. |

### AWS / DynamoDB notes

- The Worker reads the **sensor** table directly with a **read-only** IAM user (only `dynamodb:Scan`/`Query`/`GetItem`/`DescribeTable` on that table ARN). No write actions exist in the code path.
- The **FoV Lambda** reads the **lens** table with its own read-only execution role. For `compute_fov_catalog` full-catalog coverage the Lambda needs `ALLOW_LENS_SCAN=true` and `dynamodb:Scan` on the lens table.
- Sensor table partition key is the part number (`id`); attributes used: `sensormfg`, `sensorhpix`, `sensorvpix`, `sensorpitch`, `sensortype` (shutter type).
- Lens table partition key is the SKU; the Lambda's `LENS_PK` must be set accordingly.

## Local development

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

Run verification first, then deploy through CI so `/healthz` receives production build metadata (`ENVIRONMENT=production`, package `VERSION`, and `GIT_SHA=$GITHUB_SHA`). The source `wrangler.toml` intentionally does not define deployable local metadata placeholders.

```bash
npm run verify
npm run deploy:ci
```

For an approved manual deploy, `npm run deploy` runs `scripts/deploy.mjs`,
which deploys with `--keep-vars` and injects the same production build
metadata. `npm run deploy:raw` is the unwrapped Wrangler deploy command.
