# Live MCP end-user usage guide

This guide is for agents and humans using the live public Commonlands MCP endpoint.

The current service is intentionally public, read-only, and fixture-backed. It is useful for lens discovery, optical fit analysis, product lookup, and safe handoff to Commonlands-owned pages. It does not create carts, checkouts, orders, RFQs, customer records, or inventory reservations.

## Endpoint

Use the Workers.dev endpoint until Commonlands chooses the Cloudflare Business custom-hostname/proxy path.

- MCP endpoint: `https://commonlands-mcp.erp-14c.workers.dev/mcp`
- UCP discovery profile: `https://commonlands-mcp.erp-14c.workers.dev/.well-known/ucp`
- Health check: `https://commonlands-mcp.erp-14c.workers.dev/healthz`

Do not move `commonlands.com` DNS to Cloudflare just to get `mcp.commonlands.com`. The safe current launch path is Workers.dev.

## Recommended end-user usage method

Use the server as a remote HTTP MCP endpoint.

Recommended flow:

1. Connect the agent/client to `https://commonlands-mcp.erp-14c.workers.dev/mcp` as a remote MCP server.
2. If the client supports UCP discovery, point it at `https://commonlands-mcp.erp-14c.workers.dev/.well-known/ucp`.
3. Ask the agent lens-selection questions in normal language.
4. Let the agent call MCP tools for catalog search, product lookup, FoV calculation, comparison, recommendation, and purchase-route planning.
5. Treat returned product links and engineering-review routes as handoff destinations, not as transactions.

Good prompts:

- `Find M12 lenses for a 1/2.8 inch sensor around 80 degrees horizontal FoV.`
- `Compare CIL078 and CIL250 for a robotics camera application.`
- `Recommend Commonlands lenses for low-distortion machine vision on a 1/1.8 inch sensor.`
- `Find the Commonlands product page for CIL078 and tell me what information is still fixture-backed.`
- `What is the safest purchase route for two CIL078 lenses for prototype evaluation?`

## What agents should do

Agents should treat this MCP server as an engineering/catalog intelligence endpoint, not a commerce mutation endpoint.

Recommended tool flow:

1. Call `tools/list` to discover available tools.
2. Use `search_catalog` for broad lens discovery.
3. Use `get_product` or `lookup_catalog` for exact SKU/product resolution.
4. Use `compute_fov`, `match_lenses_to_sensor`, `compare_lenses`, or `recommend_lenses_for_application` for optical fit and tradeoff analysis.
5. Use `prepare_shopify_purchase_handoff` or `get_purchase_route_options` only to prepare a safe product/page handoff.
6. Send the buyer to the returned Commonlands product URL or engineering review path for human-visible next steps.

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
- Safe purchase-route planning that points users to pages or engineering review.

Not allowed:

- Cart creation or cart updates.
- Checkout creation.
- Orders.
- RFQs.
- Customer/account access.
- Inventory reservations or inventory writes.
- Shopify product, variant, collection, tag, or metafield writes.
- Acumatica writes.
- Database writes or live scans.
- Direct gated-document URLs.

## Copy-paste smoke tests

Health check:

```bash
curl -s 'https://commonlands-mcp.erp-14c.workers.dev/healthz' | python3 -m json.tool
```

Discovery profile:

```bash
curl -s 'https://commonlands-mcp.erp-14c.workers.dev/.well-known/ucp' | python3 -m json.tool
```

List available tools:

```bash
curl -s -X POST 'https://commonlands-mcp.erp-14c.workers.dev/mcp' -H 'content-type: application/json' --data-binary '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | python3 -m json.tool
```

Search fixture catalog and print product titles:

```bash
curl -s -X POST 'https://commonlands-mcp.erp-14c.workers.dev/mcp' -H 'content-type: application/json' --data-binary '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_catalog","arguments":{"query":"M12 lens"}}}' | python3 -c 'import sys,json; d=json.load(sys.stdin); print("\n".join(p["title"] for p in d["result"]["structuredContent"]["catalog"]["products"]))'
```

Prepare a read-only purchase handoff:

```bash
curl -s -X POST 'https://commonlands-mcp.erp-14c.workers.dev/mcp' -H 'content-type: application/json' --data-binary '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"prepare_shopify_purchase_handoff","arguments":{"sku":"CIL078","quantity":2}}}' | python3 -m json.tool
```

Check purchase route options:

```bash
curl -s -X POST 'https://commonlands-mcp.erp-14c.workers.dev/mcp' -H 'content-type: application/json' --data-binary '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_purchase_route_options","arguments":{"sku":"CIL078","quantity":2,"buyerIntent":"prototype evaluation","agentType":"engineering assistant"}}}' | python3 -m json.tool
```

## Current limitations

The current live Worker intentionally does not use live Shopify, DynamoDB, AppSync, Acumatica, or customer/account systems. It validates the agent interface, endpoint discovery, response contracts, catalog shape, optical workflow, and safe commerce handoff design.

Current limitations:

- Fixture data only.
- Fixture product/variant IDs, not verified production Shopify IDs.
- Fixture price and availability, not live Shopify price/availability.
- No live DynamoDB/AppSync optical reads.
- No carts, checkouts, orders, RFQs, customer records, inventory reservations, or Shopify writes.
- Datasheets remain gated; responses must not expose direct gated-document URLs.

## How to interpret results

Agents and users should label output as fixture-backed when discussing price, availability, Shopify IDs, variant IDs, or catalog completeness.

Good phrasing:

- `The MCP fixture catalog includes CIL078 as a candidate.`
- `Use the returned product URL as the next step; this MCP server did not create a checkout.`
- `Price and availability are not live yet.`

Bad phrasing:

- `This item is definitely in stock.`
- `The live Shopify price is...`
- `I created a checkout/cart/RFQ for you.`

## Future custom domain note

Current approved public endpoint remains Workers.dev:

`https://commonlands-mcp.erp-14c.workers.dev/mcp`

Do not move `commonlands.com` DNS to Cloudflare for this. The future clean custom-domain path requires Cloudflare Business custom hostname/proxy setup, currently estimated around `$200/month`.
