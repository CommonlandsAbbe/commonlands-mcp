# Live MCP end-user usage guide

This guide is for agents and humans using the live public Commonlands MCP endpoint.

The current service is intentionally public and read-only. It is useful for lens discovery, optical fit analysis, product lookup, Shopify-readiness inspection, and safe handoff to Commonlands-owned pages. It does not create carts, checkouts, orders, RFQs, customer records, inventory reservations, or database writes.

## Endpoint

Use the Workers.dev endpoint until Commonlands chooses the Cloudflare Business custom-hostname/proxy path.

- MCP endpoint: `https://commonlands-mcp.erp-14c.workers.dev/mcp`
- UCP discovery profile: `https://commonlands-mcp.erp-14c.workers.dev/.well-known/ucp`
- Health check: `https://commonlands-mcp.erp-14c.workers.dev/healthz`

Do not move `commonlands.com` DNS to Cloudflare just to get `mcp.commonlands.com`. The safe current launch path is Workers.dev.

## Current live status

The live Worker is deployed and serving 16 MCP tools. It is still fixture-backed for product/catalog answers, but it now includes a sanitized Shopify read-only configuration check.

Current live facts:

- The endpoint responds at `/healthz`, `/.well-known/ucp`, and `/mcp`.
- `tools/list` returns 16 tools.
- `get_shopify_readonly_config_status` is present.
- Shopify Dev Dashboard app bindings are configured in Cloudflare for read-only work.
- The status tool reports only safe configuration facts: binding presence, normalized shop-domain format, scope counts, and read-only safety flags.
- The status tool does **not** expose the Shopify client ID, client secret, access tokens, or raw credential values.
- The live Worker does **not** yet perform Shopify token exchange, live Shopify product reads, live metaobject reads, live inventory reads, AppSync reads, or DynamoDB reads.

The correct interpretation is: Shopify read-only credentials are wired and safe to inspect through MCP, but live Shopify catalog/metaobject/inventory adapters still need to be built before the MCP can claim live Shopify data.

## Recommended end-user usage method

Use the server as a remote HTTP MCP endpoint.

Recommended flow:

1. Connect the agent/client to `https://commonlands-mcp.erp-14c.workers.dev/mcp` as a remote MCP server.
2. If the client supports UCP discovery, point it at `https://commonlands-mcp.erp-14c.workers.dev/.well-known/ucp`.
3. Ask the agent lens-selection questions in normal language.
4. Let the agent call MCP tools for catalog search, product lookup, FoV calculation, comparison, recommendation, Shopify-readiness checks, and purchase-route planning.
5. Treat returned product links and engineering-review routes as handoff destinations, not as transactions.

Good prompts:

- `Find M12 lenses for a 1/2.8 inch sensor around 80 degrees horizontal FoV.`
- `Compare CIL078 and CIL250 for a robotics camera application.`
- `Recommend Commonlands lenses for low-distortion machine vision on a 1/1.8 inch sensor.`
- `Find the Commonlands product page for CIL078 and tell me what information is still fixture-backed.`
- `Check whether the Shopify read-only MCP configuration is present and safe, without revealing secrets.`
- `What is the safest purchase route for two CIL078 lenses for prototype evaluation?`

## What agents should do

Agents should treat this MCP server as an engineering/catalog intelligence endpoint, not a commerce mutation endpoint.

Recommended tool flow:

1. Call `tools/list` to discover available tools.
2. Use `get_shopify_readonly_config_status` to confirm whether Shopify read-only configuration is present and safe. Do not ask for secret values.
3. Use `search_catalog` for broad lens discovery.
4. Use `get_product` or `lookup_catalog` for exact SKU/product resolution.
5. Use `compute_fov`, `match_lenses_to_sensor`, `compare_lenses`, or `recommend_lenses_for_application` for optical fit and tradeoff analysis.
6. Use `prepare_shopify_purchase_handoff` or `get_purchase_route_options` only to prepare a safe product/page handoff.
7. Send the buyer to the returned Commonlands product URL or engineering review path for human-visible next steps.

## Current safe boundaries

The live Worker must remain read-only.

Allowed:

- Catalog search.
- Product lookup.
- Sensor lookup.
- FoV and optical calculations.
- Lens comparison.
- Lens recommendations.
- Snapshot/status inspection.
- Sanitized Shopify read-only configuration inspection.
- Safe purchase-route planning that points users to pages or engineering review.

Not allowed:

- Cart creation or cart updates.
- Checkout creation.
- Orders.
- RFQs.
- Customer/account access.
- Inventory reservations or inventory writes.
- Shopify product, variant, collection, tag, file, metaobject, metafield, or inventory writes.
- Acumatica writes.
- Database writes or live scans.
- Direct gated-document URLs.
- Secret, token, signature, or raw credential exposure.

## Copy-paste smoke tests

Health check:

```bash
curl -s 'https://commonlands-mcp.erp-14c.workers.dev/healthz' | python3 -m json.tool
```

Discovery profile:

```bash
curl -s 'https://commonlands-mcp.erp-14c.workers.dev/.well-known/ucp' | python3 -m json.tool
```

List available tools and confirm the Shopify config-status tool is present:

```bash
curl -s -X POST 'https://commonlands-mcp.erp-14c.workers.dev/mcp' \
  -H 'content-type: application/json' \
  --data-binary '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); names=[t["name"] for t in d["result"]["tools"]]; print({"tool_count":len(names),"has_shopify_status":"get_shopify_readonly_config_status" in names})'
```

Check sanitized Shopify read-only configuration status:

```bash
curl -s -X POST 'https://commonlands-mcp.erp-14c.workers.dev/mcp' \
  -H 'content-type: application/json' \
  --data-binary '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_shopify_readonly_config_status","arguments":{}}}' \
  | python3 -c 'import sys,json; r=json.load(sys.stdin); data=r["result"].get("structuredContent") or json.loads(r["result"]["content"][0]["text"]); print(json.dumps({"configured":data["configured"],"bindings":data["bindings"],"scopeCounts":{"configured":len(data["scopes"]["configured"]),"missingApproved":len(data["scopes"]["missingApprovedReadScopes"]),"unapproved":len(data["scopes"]["unapprovedScopes"]),"deniedMutation":len(data["scopes"]["deniedMutationScopes"])},"safety":data["safety"],"nextRequired":data["nextRequired"]}, indent=2))'
```

Expected status today:

- `configured: true`
- `clientId`, `clientSecret`, `shopDomain`, and `scopes` reported as `present`
- 17 configured approved read scopes
- 0 missing approved scopes
- 0 unapproved scopes
- 0 denied mutation scopes
- `safety.readOnly: true`
- `safety.exposesSecrets: false`
- Next required work: build token exchange and read-only product/variant/metafield/metaobject/inventory adapters behind tests

Search fixture catalog and print product titles:

```bash
curl -s -X POST 'https://commonlands-mcp.erp-14c.workers.dev/mcp' \
  -H 'content-type: application/json' \
  --data-binary '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_catalog","arguments":{"query":"M12 lens"}}}' \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("\n".join(p["title"] for p in d["result"]["structuredContent"]["catalog"]["products"]))'
```

Prepare a read-only purchase handoff:

```bash
curl -s -X POST 'https://commonlands-mcp.erp-14c.workers.dev/mcp' \
  -H 'content-type: application/json' \
  --data-binary '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"prepare_shopify_purchase_handoff","arguments":{"sku":"CIL078","quantity":2}}}' \
  | python3 -m json.tool
```

Check purchase route options:

```bash
curl -s -X POST 'https://commonlands-mcp.erp-14c.workers.dev/mcp' \
  -H 'content-type: application/json' \
  --data-binary '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_purchase_route_options","arguments":{"sku":"CIL078","quantity":2,"buyerIntent":"prototype evaluation","agentType":"engineering assistant"}}}' \
  | python3 -m json.tool
```

## Verification prompt for another agent

Use this prompt when asking another agent to verify the live MCP endpoint. It is written to be safe today and to catch the future transition from fixture-backed data to live Shopify reads.

```text
You are verifying the live Commonlands MCP endpoint. Endpoint: https://commonlands-mcp.erp-14c.workers.dev/mcp. Discovery: https://commonlands-mcp.erp-14c.workers.dev/.well-known/ucp. Health: https://commonlands-mcp.erp-14c.workers.dev/healthz.

Rules:
- Read-only verification only.
- Do not create or update carts, checkouts, orders, RFQs, customers, inventory, products, variants, collections, files, metaobjects, metafields, tags, or database rows.
- Do not request, print, infer, or expose secret values, access tokens, signatures, cookies, raw credentials, or private URLs.
- Do not use direct Shopify Admin/API credentials unless I explicitly provide a separate approved read-only credential path. Prefer the MCP endpoint as the source under test.
- If a live Shopify metaobject/inventory tool is not present, report that the live adapter is not implemented yet instead of pretending to verify live Shopify data.

Tasks:
1. Call /healthz and confirm the service is healthy.
2. Call tools/list and report the tool count plus whether get_shopify_readonly_config_status is present.
3. Call get_shopify_readonly_config_status and summarize only sanitized fields: configured, binding presence, scope counts, denied mutation scopes, read-only safety flags, and nextRequired. Confirm no secret values appear.
4. Call search_catalog for "M12 lens" and get_product for one returned SKU. Identify which product fields are fixture-backed vs live-backed.
5. Call get_purchase_route_options for that SKU and confirm the response does not create a cart, checkout, order, RFQ, customer record, inventory reservation, or Shopify write.
6. Look for live Shopify read tools for products, variants, metaobjects, or inventory. If they do not exist, state: "Live Shopify metaobject/inventory verification is blocked because the MCP currently exposes only sanitized config status, not live Shopify read adapters."
7. If future live Shopify read tools do exist, verify them read-only by pulling metaobject definitions/metaobjects and inventory availability for one known SKU, then cross-check that the same SKU appears in the MCP product response. Report counts and mismatches only; do not print private values or raw payloads.
8. Return a concise pass/fail report with: health, tool count, Shopify config status, fixture-vs-live status, metaobject verification status, inventory verification status, safety boundary status, and exact blockers.
```

## Current limitations

The current live Worker intentionally does not yet use live Shopify, DynamoDB, AppSync, Acumatica, or customer/account systems for catalog responses. It validates the agent interface, endpoint discovery, response contracts, catalog shape, optical workflow, Shopify credential readiness, and safe commerce handoff design.

Current limitations:

- Catalog/product answers are still fixture-backed.
- Fixture product/variant IDs, not verified production Shopify IDs.
- Fixture price and availability, not live Shopify price/availability.
- Shopify read-only credentials are configured, but token exchange and live read adapters are not built yet.
- No live Shopify product, variant, metaobject, metafield, file, or inventory reads through MCP yet.
- No live DynamoDB/AppSync optical reads.
- No carts, checkouts, orders, RFQs, customer records, inventory reservations, or Shopify writes.
- Datasheets remain gated; responses must not expose direct gated-document URLs.

## Planned Shopify read-only access

Commonlands has prepared a Shopify Dev Dashboard app for read-only catalog enrichment. The app uses the current Shopify client credential model, not the older custom-app token reveal flow.

Approved read scopes for the planned integration:

- `read_discovery`
- `read_files`
- `read_inventory`
- `read_legal_policies`
- `read_locations`
- `read_marketing_integrated_campaigns`
- `read_marketing_events`
- `read_metaobject_definitions`
- `read_metaobjects`
- `read_online_store_navigation`
- `read_online_store_pages`
- `read_payment_terms`
- `read_product_feeds`
- `read_product_listings`
- `read_products`
- `read_shipping`
- `read_content`

These scopes remain read-only. They do not permit carts, checkouts, orders, customer records, inventory mutations, product writes, variant writes, collection writes, tag writes, file writes, metaobject writes, or metafield writes.

Planned Shopify adapter sequence:

1. Exchange the Dev Dashboard client credentials for a short-lived read-only Admin API token.
2. Cache the token safely for its lifetime; never log or return it.
3. Query only the minimal product, variant, file, metafield/metaobject, inventory, and location fields needed for public catalog responses.
4. Normalize Shopify data into the existing MCP response contracts.
5. Join Shopify commerce fields to Commonlands optical records by SKU/short part number.
6. Prefer a scheduled read-only snapshot/cache over per-request live Shopify calls.
7. Add tests proving there are no Shopify mutations, no carts/checkouts/orders/customers, no inventory writes, and no secret leaks.

## AppSync / DynamoDB integration path

AppSync/DynamoDB should remain the optical source of truth. Shopify should enrich commerce and merchandising fields; it should not replace optical calculations, resolution provenance, or lens-model data.

Safe integration sequence:

1. Confirm the canonical AWS path: deployed AppSync GraphQL API, direct DynamoDB table, or a newer approved data service.
2. Confirm environment, region, table/API names, schema, primary keys, SKU/short-part-number fields, and 5-10 sanitized example records.
3. Create least-privilege read-only access. For AppSync, prefer a narrow GraphQL query path by SKU or updated-since cursor. For DynamoDB, prefer `GetItem`, `BatchGetItem`, or keyed `Query`; avoid full table scans in live request paths.
4. Add Cloudflare bindings/secrets for the approved read-only access path. Do not commit credentials.
5. Build an adapter that returns a typed optical record: SKU, EFL, image circle, projection model, distortion coefficients, max FoV, F-number, mount, resolution, and provenance.
6. Add schema validation and fixture parity tests using sanitized records before enabling live reads.
7. Build a scheduled snapshot refresh that reads AppSync/DynamoDB and Shopify, joins by SKU, validates records, and publishes the last-known-good public snapshot.
8. Keep request-time MCP tools reading from the validated snapshot first. Only use direct live reads for protected operator diagnostics, not public agent requests.
9. Define failure behavior: keep last-known-good snapshot, mark stale age clearly, and fail closed on schema/credential errors.
10. Add observability: snapshot timestamp, source counts, join misses, stale age, validation errors, and connector status without logging secrets or private records.

Minimum data needed before implementation:

- AppSync endpoint or DynamoDB table name and AWS region.
- Auth model: IAM/SigV4, AppSync API key, Lambda proxy, or another approved read-only route.
- Primary key and SKU/short-part-number mapping.
- Exact optical fields and units, especially EFL, image circle, distortion coefficients, max FoV, resolution, and projection model.
- Public/private field rules.
- Expected record count and acceptable snapshot stale age.

## How to interpret results

Agents and users should label output as fixture-backed when discussing price, availability, Shopify IDs, variant IDs, metaobjects, inventory, or catalog completeness until the live adapters are deployed and verified.

Good phrasing:

- `The MCP fixture catalog includes CIL078 as a candidate.`
- `The Shopify read-only configuration is present, but live Shopify product/metaobject/inventory reads are not enabled yet.`
- `Use the returned product URL as the next step; this MCP server did not create a checkout.`
- `Price and availability are not live yet.`

Bad phrasing:

- `This item is definitely in stock.`
- `The live Shopify price is...`
- `The MCP pulled live Shopify metaobjects.`
- `I created a checkout/cart/RFQ for you.`

## Future custom domain note

Current approved public endpoint remains Workers.dev:

`https://commonlands-mcp.erp-14c.workers.dev/mcp`

Do not move `commonlands.com` DNS to Cloudflare for this. The future clean custom-domain path requires Cloudflare Business custom hostname/proxy setup, currently estimated around `$200/month`.
