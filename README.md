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
Connect to https://mcp.commonlands.com/mcp and discover its current tools.
Start with the image sensor: model, active area, resolution and pixel pitch.
Establish the required horizontal field of view and working distance.
Use match_lens_to_sensor to find candidates. Use calculate_field_of_view for
final lens/sensor FoV and distortion; preserve its method and status.
If available in tools/list, use assess_lens_requirements to check explicit limits.
Report satisfied, failed and unknown checks separately.
Resolve the chosen family with resolve_lens_product and select a full SKU.
Use get_purchase_options for current price, stock and the requested quantity.
Confirm variants, quantities and totals with the buyer before cart or RFQ actions.
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
9. For an agent-authorized purchase, use the cart response `agent_checkout` route in the buyer's separate [Shop MCP connection](https://shop.dev/docs/connect), before converting the cart through Commonlands. Shop handles sign-in and payment approval. Otherwise send the buyer to Shopify's returned checkout URL.

## FoV rule

Catalog EFL, image circle, max FoV/FOV@image-circle, and distortion display fields are insufficient to compute field of view on a specific sensor. Agents must not interpolate interior-sensor FoV or substitute their own calculations. Use `calculate_field_of_view`, then preserve returned `hfov_deg`, `vfov_deg`, `dfov_deg`, `method`, `distortion_model`, `coverage_ok`, `image_circle_mm`, `sensor_diagonal_mm`, `rectilinear_comparison`, and provenance/source metadata in the answer.

## Truth hierarchy

1. `read_shopify_products` = live Shopify product truth.
2. `calculate_field_of_view` / `match_lens_to_sensor` = **live FoV backend** (AWS Lambda + DynamoDB lens catalog) when configured. Sensor inputs resolve through the live DynamoDB sensor catalog with fixture fallback. These are the routed public optics tools.
3. Compatibility aliases (`compute_fov`, `compute_fov_catalog`, `match_lenses_to_sensor`) still dispatch where practical, but new clients should route through the intent-named tools above.
4. Ranking tools (`match_lens_to_sensor`, `recommend_lenses_for_application`, `compare_lenses`) rank against **live FoV-backend specs and field of view** when the live backend is enabled, so they use real per-SKU specs (EFL, mount, image circle, FoV). They still exclude live Shopify stock/price/variant IDs; use `read_shopify_products` for purchasable truth. In production, a missing or failed backend returns an explicit error.
5. Production legacy product aliases use live Shopify resolution and are omitted from discovery. Fixture handoff tools are retired. Offline development fixtures remain labeled and cannot replace failed production reads. Sensor lookups retain their separately labeled reference fallback.

If fixture data conflicts with `read_shopify_products` or the live FoV/sensor backends, use the live truth.

### Data sources

- **Sensors** (`commonlands://sensors/{part}` and the sensor used by `calculate_field_of_view` / `match_lens_to_sensor`): read from the Commonlands DynamoDB sensor table by part number when configured, with fixture fallback. Pixel pitch and pixel counts come straight from that table; active-area mm is derived as `pixels x pitch`.
- **Lenses** (`commonlands://lenses/{sku}`, `calculate_field_of_view`, `match_lens_to_sensor`, `search_lens_catalog`): the FoV Lambda reads lens optical parameters from its DynamoDB lens table when configured. Catalog-wide matching covers the full lens table when backend scanning is enabled.
- **Distortion coefficients** are computed server-side inside the Lambda and are never returned to clients. If the live backend only returns a display distortion string, MCP returns an honest `distortion_model` / `distortion_status` and does not claim measured polynomial correction.

## Current live surface

The production tool list depends on enabled features. This branch adds live product resolution and quantity purchase options and removes fixture aliases from discovery. It retains `create_cart`, `get_cart`, `update_cart`, `cancel_cart`, `create_checkout`, and `get_checkout`. Commerce uses Shopify UCP at `https://commonlands.com/api/ucp/mcp`. `complete_checkout` is disabled on Commonlands. Cart responses include an `agent_checkout` route to the buyer's separate Shop MCP connection, where authorized agents can complete eligible purchases. Customers can also review and pay on Shopify. Always trust live `tools/list`. See [cart and checkout integration](docs/commerce.md).

Key tools:

- Public optics routing: `calculate_field_of_view`, `match_lens_to_sensor`, `search_lens_catalog`, `get_lens_distortion_profile`.
- Optical comparison: `compare_lenses`, `recommend_lenses_for_application`. Current product selection: `resolve_lens_product`, `get_purchase_options`.
- Engineering checks (phase 4 PR): `assess_lens_requirements` uses the live FoV path and reports satisfied, failed and unknown requirements. See [supported checks and missing evidence](docs/engineering-requirements.md); trust the connected server's `tools/list` for availability.
- Legacy hidden aliases (still dispatch for old clients, not listed in `tools/list`): `compute_fov`, `compute_fov_catalog`, `match_lenses_to_sensor`, `search_lenses`, `get_lens_details`.
- Resources/prompts: `commonlands://sensors/{part}`, `commonlands://lenses/{sku}`, `commonlands://catalog/sensors`, `commonlands://catalog/lenses`, and prompt `select_lens_for_sensor_fov_working_distance`.
- Live Shopify read-only truth: `read_shopify_products`, `get_shopify_readonly_config_status`.
- Buyer-confirmed Shopify cart handoff: `create_cart`, `get_cart`, `update_cart`, `cancel_cart`, followed by `create_checkout` and `get_checkout` when visible in `tools/list`.
- RFQ / question handoff: `submit_rfq` forwards a buyer quote request or question to the fixed Commonlands engineering inbox (SendGrid). The agent cannot choose the recipient; it sends an inquiry only (no order, payment, or Shopify write) and stays inert (routes to the contact page) until `SENDGRID_API_KEY` + `RFQ_TO_EMAIL` + `RFQ_FROM_EMAIL` are configured.
- Diagnostics/readiness: `get_catalog_snapshot_status`, `get_shopify_ucp_readiness`. Legacy fixture purchase handoffs are retired in production.

## Public-data scope (Shopify reads)

The endpoint is public and unauthenticated, so `read_shopify_products` returns
**only data that is already public on commonlands.com** (enforced server-side
in `src/shopify-read-adapter.ts`, see `PUBLIC_DATA_POLICY`):

- **Published active products only.** Products must be ACTIVE and have a
  Shopify-provided Online Store URL on commonlands.com. An ACTIVE product
  with no publication is filtered out; the adapter never invents its URL.
- **Current per-variant inventory.** Shopify supplies website and online sellable
  quantities on each request. Untracked or missing quantities are null. The old
  `availability` category remains for compatibility; inventory item/location IDs
  remain private. Counts do not reserve inventory or guarantee fulfillment.
- **Metafields are opt-in and allowlisted.** `includeMetafields` defaults to
  `false`; when enabled, only the `custom.*` display fields rendered on public
  product pages are returned. App/private namespaces and non-allowlisted keys
  (including `custom.docsend_page`) are always dropped.
- **`read_shopify_metaobjects` was removed** from the public surface
  (2026-07): Admin metaobject definitions can hold non-public store content.
  Calls return an actionable error pointing to `read_shopify_products`.
- The requested Admin scopes were narrowed to the read scopes the surface
  actually needs (no metaobject, marketing, payment-terms, or shipping
  scopes).

## Abuse controls (cart and endpoint)

Cart tools are deliberately reachable without authentication — the same trust
model as Shopify's own public Storefront cart — but they are bounded:

- **Per-IP rate limits** (Workers Rate Limiting API, `wrangler.toml`):
  120 requests/min per IP across `/mcp`, and 10 cart mutations/min per IP for
  cart mutations, checkout creation, and RFQ submissions. Exceeding either returns HTTP 429 with
  `retry-after: 60`.
- **Strict payloads:** 1–25 line items per cart, quantity 1–999 per line, and
  item IDs must be live Shopify ProductVariant GIDs — fixture IDs, SKUs, and
  numeric IDs are rejected before any Shopify call.
- **Carts are Shopify-owned and expire.** The Worker is a stateless proxy;
  cart state, TTL, and expiry (`expiryAuthority: shopify_cart_ttl_expires_at`)
  belong to Shopify, which prunes abandoned carts automatically. No cart,
  session, customer, or payment state is ever stored in the Worker.
- **Checkout handoff:** the agent prepares a checkout and returns Shopify’s `continue_url`. Cart conversion requires the cart owner token; checkout reads require a separate checkout owner token. The Commonlands server cannot complete payment or place an order. For buyer-authorized agent purchases, cart responses provide the exact handoff to Shop MCP; the buyer's client sends its credentials and approved payment directly to Shop.

## Safety boundaries

- Do not use fixture prices, availability, product URLs, SKU variants, or IDs as final commerce truth.
- Do not create or update carts unless the buyer has confirmed live Variant GIDs and quantities.
- Call `create_checkout` after buyer confirmation, preserve `checkout_access_token`, and return `checkout.continue_url`. The buyer reviews and pays on Shopify.
- Do not ask for or transmit card numbers, CVV/CVC, payment tokens, passwords, or customer account credentials through Commonlands. In the separate Shop connection, the buyer client sends only Shop-offered payment instruments back to Shop after buyer approval.
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

Version 0.4.2 also withholds fixture prices, availability, and product URLs from
legacy tool responses (including nested UCP variants and purchase routes) and
catalog resources. Use `read_shopify_products` for current commerce values;
fixture responses provide a `commerceLookup` instruction instead of a stale quote.
When a horizontal FoV target is supplied, ranking prioritizes full sensor coverage,
then absolute target error, then heuristic score and SKU. Capped scores no longer
cause an exact target match to lose to an alphabetically earlier lens.

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

Starting with **0.4.2**, failed connector operations also set MCP `isError: true`
and record `tool_error_not_configured`, `tool_error_invalid_request`,
`tool_error_shopify_error`, or `tool_error_delivery_failed` in `blob5`.
Successful RFQ previews still count as successful calls; they do not mean an
email was delivered. Client labels describe software, not unique people.

Earlier versions recorded these application failures as `ok`, so historical
success rates can be overstated. Their true outcomes cannot be reconstructed
from this dataset, because it deliberately excludes request/response payloads.
Filter by `blob8` (deployed version) when comparing corrected success rates.

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

Production deployment is manual from a trusted computer using Wrangler's browser
OAuth login. GitHub runs checks only; no Cloudflare deployment token is required
in GitHub Actions. Merge the reviewed release branch and pull it before deploying.
The source `wrangler.toml` intentionally does not define local build metadata.

```powershell
npm ci
npm run verify
# Clear token overrides in this terminal so Wrangler uses browser OAuth.
Remove-Item Env:CLOUDFLARE_API_TOKEN, Env:CF_API_TOKEN, Env:CLOUDFLARE_API_KEY, Env:CF_API_KEY -ErrorAction SilentlyContinue
npx wrangler login
npx wrangler whoami
npm run deploy
Invoke-RestMethod https://mcp.commonlands.com/healthz
```

Stop if any command fails. Confirm `whoami` has access to the account in
`wrangler.toml`. After deployment, confirm `/healthz` reports the expected version
and Git commit, then run the client smoke tests in
[`docs/client-connections.md`](docs/client-connections.md).

`npm run deploy` runs `scripts/deploy.mjs`,
which deploys with `--keep-vars` and injects the same production build
metadata. `npm run deploy:raw` is the unwrapped Wrangler deploy command.

Wrangler stores OAuth credentials locally outside the repository. Never commit
credentials. The retired GitHub `CLOUDFLARE_API_TOKEN` secret can be removed in
repository Settings > Secrets and variables > Actions; deleting the workflow
does not delete stored secrets. The separate analytics token is not a deployment
credential. See [Wrangler authentication](https://developers.cloudflare.com/workers/wrangler/commands/general/).

## License and private backend

Apache-2.0 covers the Commonlands-owned source code distributed in this repository.
The separately hosted Commonlands Lambda implementation and private optical
datasets are not distributed or licensed under this repository's license.
Applicable third-party licenses and notices remain in effect.

The public MCP endpoint provides access to the hosted service without requiring
its backend source code. Users connect to `https://mcp.commonlands.com/mcp`;
the service calls the private Lambda backend using server-side credentials.
Independently hosting this adapter requires an authorized compatible backend;
the source-code license does not grant backend credentials or access to private
code or datasets.

## Live product identity

Start with the image sensor model or active dimensions and pixel pitch. Set your
required horizontal field of view, then use `match_lens_to_sensor` and
`calculate_field_of_view` to obtain Commonlands' sensor-specific FoV and distortion.
Use `resolve_lens_product` with the chosen optical part number to find its current
published Shopify variants. Select the **full SKU** explicitly before purchasing.
A family such as CIL250 is not a unique configuration.

Production legacy product lookup aliases now resolve through Shopify; legacy
fixture handoffs are retired and omitted from discovery. Optical backend failures
return errors, not fixture replacements. Shopify remains the source for price,
availability, variant IDs and product-page specifications. Lambda/DynamoDB owns
optical calculations; differences between family and variant records are not
silently reconciled. See [the phased PR plan](docs/phased-improvements.md).

### Current stock and technical records

`read_shopify_products` reads the Shopify backend on every call. Match the full
variant SKU and GID. `availableQuantity` is online sellable stock;
`websiteStockQuantity` corresponds to the theme's aggregate stock field. Unknown
quantities are null. Neither count reserves inventory or promises a delivery date.

Use complete typed metafield `value` instead of `valuePreview`. Check `valueStatus`,
`pageInfo` and `metafieldsComplete` before treating a record as complete. See
[inventory and specification semantics](docs/inventory-availability.md).

### Quantity options and web access

See [quantity purchase options](docs/purchase-options.md) for exact-SKU requests,
current stock, base-price estimates, RFQ routing and owner-authorized Shopify
shipping/tax estimates. Unverified volume pricing and delivery dates stay unknown.

Web-only agents can read `/catalog` with cursor pagination or `/products/{full-SKU}`
on the MCP host. Add `?format=markdown` for a readable specification record. These
routes use the same live Shopify adapter and return `Cache-Control: no-store`.
They become available only after manual deployment of this branch.
