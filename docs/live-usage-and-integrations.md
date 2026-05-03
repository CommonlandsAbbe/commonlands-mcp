# Live MCP end-user usage guide

This guide is for agents and humans using the live public Commonlands MCP endpoint.

The current production service is public and read-mostly. Its catalog, optics, recommendation, and legacy purchase-handoff flows are fixture-backed scaffold data by default and are not authoritative for final SKU recommendations, price, availability, Shopify IDs, variant IDs, exact product specs, or cart/checkout preparation. Use `read_shopify_products` as the live read-only Shopify product truth source for purchasable facts. Cart UCP and Checkout MCP support are hidden by default behind explicit environment gates pending approval, Cloudflare protections, endpoint bindings, and merchant-side availability. They must not create RFQs, create/read customer records, apply discounts, reserve inventory, mutate inventory, write Shopify catalog data, or touch inventory sync.

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

Agents should treat this MCP server primarily as an engineering/catalog intelligence endpoint. Use fixture-backed tools for broad discovery and optical scaffold context only; before final SKU recommendation, price/availability claims, variant IDs, product URLs, metafields, or cart/checkout preparation, call `read_shopify_products`. Cart and checkout tools are the only approved commerce mutation proxy surfaces, are limited to Shopify-owned state, and safe-fail until their endpoints are configured.

Recommended tool flow:

1. Call `tools/list` to discover available tools.
2. Use `search_catalog` for broad lens discovery.
3. Use `get_product` or `lookup_catalog` for fixture SKU/product scaffold context only.
4. Use `compute_fov`, `match_lenses_to_sensor`, `compare_lenses`, or `recommend_lenses_for_application` for optical fit and tradeoff analysis, while preserving their fixture warnings.
5. Use `read_shopify_products` for live product URLs, Shopify Product/Variant GIDs, SKUs, prices, inventory signals, and metafields.
6. Use `prepare_shopify_purchase_handoff` or `get_purchase_route_options` only as non-authoritative handoff scaffolds unless live variant IDs came from `read_shopify_products`.
7. Commerce mutation tools are not part of the default public surface. Use them only if an approved environment explicitly exposes them and the buyer explicitly asks for commerce handoff.
8. Send the buyer to the returned Commonlands product URL or engineering review path for human-visible next steps.

## Current safe boundaries

The live Worker must remain read-only by default. Shopify Cart UCP and Checkout MCP proxy tools are hidden pending explicit approval and configuration.

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
- Catalog-only UCP discovery by default; commerce mutation proxy tools only after explicit approval and enablement.

Not allowed:

- Cart creation or cart updates unless explicitly enabled through the approved Cart UCP gate.
- Checkout creation unless explicitly enabled through the approved Checkout MCP gate.
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
- Fixture catalog product/variant IDs, price, availability, exact product specs, Shopify IDs, variant IDs, and catalog completeness are not guaranteed to match production Shopify and must not be used for final purchasable product truth.
- `read_shopify_products` is the single obvious live product truth path for purchasable product URLs, Shopify Product/Variant GIDs, SKUs, prices, inventory signals, and metafields. `get_shopify_readonly_config_status` and `read_shopify_metaobjects` remain supporting read-only diagnostics.
- Cart UCP tools require `ENABLE_COMMERCE_MUTATION_TOOLS=true` plus `SHOPIFY_CART_MCP_ENDPOINT`; without approval they are hidden from `tools/list` and blocked in `tools/call`.
- Diagnostic Shopify reads require approved client credentials/scopes and may return `not_configured`, `missing_scope`, or sanitized Shopify errors if the production app/store cannot exchange a token.
- No live DynamoDB/AppSync optical reads.
- No cart mutations unless explicitly enabled and routed through approved Cart UCP tools; no checkout mutations unless explicitly enabled and routed through approved Checkout MCP tools. `complete_checkout` requires the extra checkout gate and is allowed only after Shopify checkout authentication verifies buyer name, email, phone, address, and card/payment authorization. No raw payment handling, RFQs, customer records, discounts, inventory reservations, inventory sync changes, or Shopify catalog writes.
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
- `read_shopify_products` reads live product, variant, selected public metafield/media URL, price, inventory summary fields, normalized `id`/`numericId`, `productUrl`, and variant `storefrontCartPath` through Shopify Admin GraphQL. SKU search is the safest path; handle-only lookup uses Shopify `productByHandle`.
- `read_shopify_metaobjects` reads metaobjects by type and optional handle, returning redacted field previews only.

All diagnostic results include read-only safety flags and redact tokens/client credentials. Use them to validate connector readiness, not to make final public stock/price claims until the joined catalog snapshot is audited.

## Shopify Cart UCP ordering path

Cart UCP is the approved first ordering step for agents. It lets an agent build and revise a Shopify cart before the buyer commits to checkout. It does not complete payments, create orders, create customer records, reserve inventory, or mutate product/catalog/inventory data.

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

Agents may build carts only after the buyer has selected specific line items and quantities. Agents should always show the final cart summary and `continue_url` to the buyer before checkout. Payment completion, order creation, customer account access, discounts, inventory reservations, and inventory writes remain out of scope.

## Shopify Checkout MCP handoff path

Checkout MCP is the approved checkout step after a buyer has confirmed cart or line-item intent. It lets an agent create, refresh, revise, complete, or cancel Shopify-owned checkout state. `complete_checkout` is allowed only through Shopify Checkout MCP after the Shopify checkout phase has authenticated/verified buyer name, email, phone, address, and card/payment authorization. Commonlands never accepts raw card numbers, CVV/CVC, payment tokens, customer records, discounts, inventory reservation/mutation, inventory sync, or catalog writes.

When deployed and configured, Commonlands exposes these MCP tools:

- `create_checkout`: create Shopify-owned checkout handoff state from a retained Shopify Cart gid or explicit Shopify `ProductVariant` GIDs and quantities.
- `get_checkout`: fetch latest Shopify-owned checkout state by checkout ID.
- `update_checkout`: replace allowed checkout line item/context state. Buyer, customer, address, payment, discount, and gift-card fields are rejected.
- `complete_checkout`: finalize through Shopify Checkout MCP only after Shopify-hosted checkout authentication verifies buyer name, email, phone, address, and card/payment authorization. Requires `meta["idempotency-key"]` UUID and an `authentication` object with all verification flags true; raw card/payment fields are rejected.
- `cancel_checkout`: cancel Shopify-owned checkout state by checkout ID. Requires `meta["idempotency-key"]` as a UUID for retry safety.

### Where checkout state is stored and mutated

Checkout state is stored by Shopify Checkout MCP, not by the Commonlands Worker. Commonlands validates the request shape and forwards it to `SHOPIFY_CHECKOUT_MCP_ENDPOINT`, normally a merchant endpoint such as `https://commonlands.com/api/checkout/mcp` when available. Shopify Checkout MCP owns checkout IDs, URLs, totals, validation messages, expiry, and the hosted buyer completion flow.

The Worker does not keep a checkout database, KV namespace, Durable Object, session cookie, customer profile, payment record, or server-side checkout memory. Agents must retain `checkout.id` and/or `checkout.checkout_url` across sessions. If both are lost, Commonlands MCP cannot recover the checkout because it stores no customer/session/checkout state.

### Checkout MCP syntax examples

Create checkout handoff state from a cart ID:

```json
{
  "jsonrpc": "2.0",
  "id": 20,
  "method": "tools/call",
  "params": {
    "name": "create_checkout",
    "arguments": {
      "checkout": {
        "cart_id": "gid://shopify/Cart/cart_abc123",
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

Refresh checkout in a later agent session:

```json
{
  "jsonrpc": "2.0",
  "id": 21,
  "method": "tools/call",
  "params": {
    "name": "get_checkout",
    "arguments": {
      "id": "gid://shopify/Checkout/chk_abc123"
    }
  }
}
```

Complete checkout after Shopify authentication/authorization:

```json
{
  "jsonrpc": "2.0",
  "id": 22,
  "method": "tools/call",
  "params": {
    "name": "complete_checkout",
    "arguments": {
      "id": "gid://shopify/Checkout/chk_abc123",
      "meta": {
        "idempotency-key": "660e8400-e29b-41d4-a716-446655440003"
      },
      "authentication": {
        "method": "shopify_checkout_authenticated",
        "buyerVerified": true,
        "paymentAuthorized": true,
        "nameVerified": true,
        "emailVerified": true,
        "phoneVerified": true,
        "addressVerified": true,
        "cardAuthorized": true,
        "authenticatedAt": "2026-05-02T20:15:00.000Z"
      }
    }
  }
}
```

Cancel checkout state:

```json
{
  "jsonrpc": "2.0",
  "id": 22,
  "method": "tools/call",
  "params": {
    "name": "cancel_checkout",
    "arguments": {
      "id": "gid://shopify/Checkout/chk_abc123",
      "meta": {
        "idempotency-key": "660e8400-e29b-41d4-a716-446655440002"
      }
    }
  }
}
```

### Agent checkout rules

Agents may create checkout only after the buyer has confirmed specific line items and quantities. Authentication is not required until the checkout phase. Before calling `complete_checkout`, the agent must have Shopify Checkout MCP authentication evidence that buyer name, email, phone, address, and card/payment authorization were verified; if the checkout status is `requires_escalation` or that evidence is missing, send the buyer to the Shopify-hosted `continue_url` instead. Commonlands MCP must never collect, store, log, or proxy raw card numbers, CVV/CVC, payment tokens, passwords, or customer-account credentials.


## How to interpret results

Agents and users must label default catalog/recommendation/purchase-handoff output as fixture-backed scaffold data when discussing SKU recommendations, price, availability, Shopify IDs, variant IDs, exact product specs, or catalog completeness. Use `read_shopify_products` and cite it explicitly for live purchasable product truth.

Good phrasing:

- `The MCP fixture catalog includes CIL078 as a candidate.`
- `Use the returned product URL, cart continue_url, or checkout URL as the next step; only `complete_checkout` through Shopify Checkout MCP may finalize checkout, and only after Shopify authentication/authorization verification.`
- `Price, availability, Shopify IDs, variant IDs, product URLs, and metafields from fixture tools are non-authoritative unless read_shopify_products is explicitly cited.`

Bad phrasing:

- `This item is definitely in stock.`
- `The live Shopify price is final/guaranteed...`
- `I charged a card directly, handled raw payment credentials, created a customer record, reserved inventory, or created an RFQ for you.`

## Future custom domain note

Current approved public endpoint remains Workers.dev:

`https://commonlands-mcp.erp-14c.workers.dev/mcp`

Do not move `commonlands.com` DNS to Cloudflare for this. The future clean custom-domain path requires Cloudflare Business custom hostname/proxy setup, currently estimated around `$200/month`.
