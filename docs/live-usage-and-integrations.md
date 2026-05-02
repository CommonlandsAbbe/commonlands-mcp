# Live MCP end-user usage guide

This guide is for agents and humans using the live public Commonlands MCP endpoint.

The current production service is public and read-mostly. Its user-facing catalog, optics, product lookup, and purchase-handoff flows remain fixture-backed by default. It also exposes credential-gated diagnostic Shopify Admin read tools for product/metaobject summary checks when approved read-only Shopify configuration is present. Cart UCP support is a separate, explicitly approved commerce-mutation path: when configured, it may create/update/cancel Shopify-owned cart state only. It does not create checkouts, complete purchases, create orders, create RFQs, create customer records, reserve inventory, mutate inventory, write Shopify catalog data, or touch inventory sync.

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

Agents should treat this MCP server primarily as an engineering/catalog intelligence endpoint. Cart tools are the only approved commerce mutation surface, and they are limited to Shopify-owned cart state.

Recommended tool flow:

1. Call `tools/list` to discover available tools.
2. Use `search_catalog` for broad lens discovery.
3. Use `get_product` or `lookup_catalog` for exact SKU/product resolution.
4. Use `compute_fov`, `match_lenses_to_sensor`, `compare_lenses`, or `recommend_lenses_for_application` for optical fit and tradeoff analysis.
5. Use `prepare_shopify_purchase_handoff` or `get_purchase_route_options` to prepare a safe product/page handoff.
6. If Cart UCP is configured and the buyer explicitly asks to build a cart, use `create_cart`, then preserve the returned `cart.id` and `continue_url`.
7. Send the buyer to the returned Commonlands product URL, cart `continue_url`, or engineering review path for human-visible next steps.

## Current safe boundaries

The live Worker must remain read-only except for the explicitly approved Cart UCP tools.

Allowed:

- Catalog search.
- Product lookup.
- Sensor lookup.
- FoV and optical calculations.
- Lens comparison.
- Lens recommendations.
- Snapshot/status inspection.
- Credential-gated diagnostic Shopify Admin reads for product/variant/metaobject summaries.
- Safe purchase-route planning that points users to pages or engineering review.
- Cart UCP creation/update/cancel when Shopify Cart MCP is configured and the buyer has explicitly selected line items.

Not allowed:

- Cart creation or cart updates outside the approved Cart UCP tools.
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

The fixture catalog remains the default user-facing source. The live Worker validates the agent interface, endpoint discovery, response contracts, catalog shape, optical workflow, safe commerce handoff design, and now a narrow live Shopify read-only diagnostic seam.

Current limitations:

- Catalog/search/recommendation/purchase-handoff flows still use fixture data.
- Fixture catalog product/variant IDs, price, and availability are not guaranteed to match production Shopify.
- Diagnostic Shopify reads are separate tools: `get_shopify_readonly_config_status`, `read_shopify_products`, and `read_shopify_metaobjects`.
- Cart UCP tools require `SHOPIFY_CART_MCP_ENDPOINT`; without that binding they return `not_configured` and do not mutate state.
- Diagnostic Shopify reads require approved client credentials/scopes and may return `not_configured`, `missing_scope`, or sanitized Shopify errors if the production app/store cannot exchange a token.
- No live DynamoDB/AppSync optical reads.
- No cart mutations unless routed through the approved Cart UCP tools; no checkouts, orders, RFQs, customer records, inventory reservations, inventory sync changes, or Shopify catalog writes.
- Datasheets remain gated; responses must not expose direct gated-document URLs.

## Shopify read-only diagnostic access

Commonlands has a Shopify Dev Dashboard app path for read-only catalog diagnostics. The app uses the current Shopify client credential model, not the older custom-app token reveal flow. These tools are for controlled verification and future enrichment work; they do not silently replace fixture-backed catalog results.

Approved read scopes for the diagnostic integration:

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

These scopes remain read-only. They do not permit carts, checkouts, orders, customer records, inventory mutations, product writes, variant writes, collection writes, tag writes, or metafield writes.

Diagnostic tools:

- `get_shopify_readonly_config_status` reports sanitized config/scope readiness only; it never returns secret values.
- `read_shopify_products` reads product, variant, selected public metafield/media URL, price, and inventory summary fields through Shopify Admin GraphQL. SKU search is the safest path; handle-only lookup uses Shopify `productByHandle`.
- `read_shopify_metaobjects` reads metaobjects by type and optional handle, returning redacted field previews only.

All diagnostic results include read-only safety flags and redact tokens/client credentials. Use them to validate connector readiness, not to make final public stock/price claims until the joined catalog snapshot is audited.

## Shopify Cart UCP ordering path

Cart UCP is the approved first ordering step for agents. It lets an agent build and revise a Shopify cart before the buyer commits to checkout. It is intentionally narrower than Checkout MCP: it does not create checkouts, complete payments, create orders, create customer records, reserve inventory, or mutate product/catalog/inventory data.

When deployed and configured, Commonlands exposes these MCP tools:

- `create_cart`: create a Shopify-owned cart from selected Shopify `ProductVariant` GIDs and quantities.
- `get_cart`: fetch the latest Shopify-owned cart state by cart ID.
- `update_cart`: replace the full Shopify-owned cart state. Treat this as PUT semantics: send the complete intended `line_items` and context each time.
- `cancel_cart`: cancel a Shopify-owned cart by cart ID. Requires `meta["idempotency-key"]` as a UUID for retry safety.

### Where cart state is stored and mutated

Cart state is stored by Shopify Cart MCP, not by the Commonlands Worker. The Commonlands MCP is a stateless JSON-RPC proxy:

1. The agent calls Commonlands MCP `create_cart`, `get_cart`, `update_cart`, or `cancel_cart`.
2. Commonlands validates the request shape and safety boundaries.
3. Commonlands forwards the request to `SHOPIFY_CART_MCP_ENDPOINT`, normally Shopify's merchant UCP endpoint at `https://commonlands.com/api/ucp/mcp` when available.
4. Shopify Cart MCP owns the cart object, line IDs, totals, messages, expiry, and `continue_url`.
5. Commonlands returns Shopify's structured cart payload plus a persistence contract explaining that the Worker has no durable cart storage.

The Worker does not keep a cart database, KV namespace, Durable Object, session cookie, customer profile, or server-side cart memory. This is deliberate: Shopify remains merchant of record and source of truth for cart totals, availability messages, expiry, and storefront handoff URL.

### How carts persist across agent sessions

Cart persistence is by returned identifier, not by hidden Commonlands session state.

Agents must store or re-ask for one of these values across sessions:

- `cart.id`, for example `gid://shopify/Cart/cart_abc123`.
- `cart.continue_url`, the human storefront handoff URL.

If an agent has the `cart.id`, it can call `get_cart` in a later session to refresh the cart until Shopify expires or cancels it. If an agent only has `continue_url`, it can send the buyer back to Shopify, but it may not be able to mutate the cart through MCP unless it also retained the cart ID. If both are lost, Commonlands MCP cannot reliably recover the cart because it does not store customer/session/cart state.

Shopify's returned `expires_at` is authoritative when present. Agents should warn buyers that carts can expire or change if availability, price, or Shopify validation changes.

### Cart UCP syntax examples

Create a cart from a Shopify variant ID returned by `read_shopify_products`:

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "method": "tools/call",
  "params": {
    "name": "create_cart",
    "arguments": {
      "cart": {
        "line_items": [
          {
            "quantity": 2,
            "item": { "id": "gid://shopify/ProductVariant/12345678901" }
          }
        ],
        "context": {
          "address_country": "US",
          "address_region": "CA",
          "postal_code": "92101"
        }
      }
    }
  }
}
```

Refresh a cart in a later agent session:

```json
{
  "jsonrpc": "2.0",
  "id": 11,
  "method": "tools/call",
  "params": {
    "name": "get_cart",
    "arguments": {
      "id": "gid://shopify/Cart/cart_abc123"
    }
  }
}
```

Replace cart contents:

```json
{
  "jsonrpc": "2.0",
  "id": 12,
  "method": "tools/call",
  "params": {
    "name": "update_cart",
    "arguments": {
      "id": "gid://shopify/Cart/cart_abc123",
      "cart": {
        "line_items": [
          {
            "quantity": 3,
            "item": { "id": "gid://shopify/ProductVariant/12345678901" }
          }
        ]
      }
    }
  }
}
```

Cancel a cart:

```json
{
  "jsonrpc": "2.0",
  "id": 13,
  "method": "tools/call",
  "params": {
    "name": "cancel_cart",
    "arguments": {
      "id": "gid://shopify/Cart/cart_abc123",
      "meta": {
        "idempotency-key": "660e8400-e29b-41d4-a716-446655440001"
      }
    }
  }
}
```

### Agent ordering rules

Agents may build carts only after the buyer has selected specific line items and quantities. Agents should always show the final cart summary and `continue_url` to the buyer before checkout. Checkout MCP, payment completion, order creation, customer account access, discounts, inventory reservations, and inventory writes are out of scope until separately approved and implemented.


## How to interpret results

Agents and users should label default catalog output as fixture-backed when discussing price, availability, Shopify IDs, variant IDs, or catalog completeness. If a diagnostic Shopify read tool was used, say that explicitly and preserve uncertainty until the joined catalog snapshot is audited.

Good phrasing:

- `The MCP fixture catalog includes CIL078 as a candidate.`
- `Use the returned product URL as the next step; this MCP server did not create a checkout.`
- `Price and availability from the default catalog are fixture-backed unless a diagnostic Shopify read result is explicitly cited.`

Bad phrasing:

- `This item is definitely in stock.`
- `The live Shopify price is final/guaranteed...`
- `I created a checkout/cart/RFQ for you.`

## Future custom domain note

Current approved public endpoint remains Workers.dev:

`https://commonlands-mcp.erp-14c.workers.dev/mcp`

Do not move `commonlands.com` DNS to Cloudflare for this. The future clean custom-domain path requires Cloudflare Business custom hostname/proxy setup, currently estimated around `$200/month`.
