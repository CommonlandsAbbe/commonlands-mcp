# Live MCP usage and integration guide

## Recommended live usage today

Use the public Workers.dev endpoint until Commonlands is ready to pay for the Cloudflare Business custom-hostname/proxy path.

- MCP endpoint: `https://commonlands-mcp.erp-14c.workers.dev/mcp`
- UCP discovery profile: `https://commonlands-mcp.erp-14c.workers.dev/.well-known/ucp`
- Health check: `https://commonlands-mcp.erp-14c.workers.dev/healthz`
- Current mode: public, read-only, fixture-backed.

Do not move `commonlands.com` DNS to Cloudflare just to get `mcp.commonlands.com`. The safe current launch path is Workers.dev. The future clean custom-domain path is a Cloudflare Business plan custom hostname/proxy setup.

## What agents should do

Agents should treat this MCP server as an engineering/catalog intelligence endpoint, not a commerce mutation endpoint.

Recommended flow:

1. Call `tools/list` to discover the available tools.
2. Use `search_catalog` for broad lens discovery.
3. Use `get_product` or `lookup_catalog` for exact SKU/product resolution.
4. Use `compute_fov`, `match_lenses_to_sensor`, `compare_lenses`, or `recommend_lenses_for_application` for optical fit and tradeoff analysis.
5. Use `prepare_shopify_purchase_handoff` or `get_purchase_route_options` only to prepare a safe product/page handoff. These tools do not create a cart, checkout, order, RFQ, customer record, or inventory reservation.
6. Send the buyer to the returned Commonlands product URL or engineering review path for human-visible next steps.

## Copy-paste smoke tests

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

The current live Worker intentionally does not use live Shopify, DynamoDB, AppSync, Acumatica, or customer/account systems. It is useful for validating the agent interface, endpoint discovery, response contracts, catalog shape, optical workflow, and safe commerce handoff design.

Current limitations:

- Fixture data only.
- Fixture product/variant IDs, not verified production Shopify IDs.
- Fixture price and availability, not live Shopify price/availability.
- No live DynamoDB/AppSync optical reads.
- No carts, checkouts, orders, RFQs, customer records, inventory reservations, or Shopify writes.
- Datasheets remain gated; responses must not expose direct gated-document URLs.

## Shopify integration path

Goal: replace fixture commerce enrichment with live, read-only Shopify data while keeping Commonlands optical data as the source of truth.

### Required Shopify decisions and access

Max or the Shopify admin owner must create/approve a read-only access path. Do not use broad write-capable credentials.

Required decisions:

- Store domain: currently expected to be `commonlands.myshopify.com`.
- Product identifier strategy: SKU, handle, Shopify product ID, Shopify variant ID, or a maintained mapping table.
- Variant mapping rule for lens SKUs.
- Approved metafield namespaces/keys for mechanical drawings and any public lens metadata mirrored into Shopify.
- Price and availability freshness rule.
- Whether Storefront API alone is enough, or whether Admin API read scopes are needed for product/variant/metafield coverage.

### Preferred credentials

Start with read-only Shopify access only:

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_STOREFRONT_TOKEN` if Storefront API is enough.
- `SHOPIFY_ADMIN_READ_TOKEN` only if Admin API read access is approved and required for product/variant/metafield data.

Store credentials in Cloudflare Worker secrets or 1Password references for deployment automation. Never commit values to source control, PR text, screenshots, logs, fixtures, or tests.

### Safe implementation sequence

1. Build a Shopify read adapter that supports only product/variant/metafield reads.
2. Add tests proving there are no mutation operations, no cart/checkout creation, no inventory writes, and no customer/order access.
3. Map Shopify records into the existing commerce fixture contract: handle, product URL, variant ID, price, availability, public drawing URL.
4. Validate URLs so only approved `commonlands.com` and Shopify CDN hosts appear in responses.
5. Keep live Shopify calls out of request-time MCP tools at first. Prefer a scheduled snapshot refresh that writes a joined static/cache artifact for the Worker to read.
6. Run dry-run/parity checks comparing fixture output to live Shopify-mapped output.
7. Open a PR with verification output and an access-scope note.
8. Deploy after review.

### Shopify non-goals until explicit approval

Do not add these without explicit approval and a separate design:

- Cart creation or cart updates.
- Checkout creation.
- Orders.
- Customer accounts or protected customer data.
- Inventory mutations.
- Product, variant, collection, tag, or metafield writes.
- RFQ/customer-record creation.

## DynamoDB/AppSync integration path

Goal: replace fixture optical data with live Commonlands optical/spec truth from the legacy lens calculator data source while preserving the same public MCP response contracts.

### Required AWS decisions and access

Required inputs:

- AWS account/region.
- Whether the approved path is AppSync GraphQL or direct DynamoDB read.
- AppSync endpoint and schema/query names, or DynamoDB table/index names and key shapes.
- Field mapping for SKU, mount, EFL, F-number, image circle, max FoV, projection model, distortion coefficients, resolution, sensor dimensions, and source provenance.
- Staging vs production read source.
- Snapshot refresh cadence and owner.

Known legacy context to preserve during mapping:

- Legacy calculator stack used Vue2 + Amplify/AppSync.
- Lens data source was DynamoDB table `dynamoLensList`.
- FoV logic depended on alpha/beta/EFL/image circle/max FoV and distortion/projection coefficients.

### Preferred credentials

Use least-privilege read-only access only:

- `AWS_REGION`
- `APPSYNC_GRAPHQL_ENDPOINT` plus approved read token or SigV4 credential path, or
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` restricted to the exact DynamoDB read actions and resources required.

The IAM policy must not include writes such as `PutItem`, `UpdateItem`, `DeleteItem`, `BatchWriteItem`, or broad table scans unless explicitly approved for a bounded offline audit.

### Safe implementation sequence

1. Document the exact schema/table and field mappings before coding.
2. Build an optical read adapter behind the current fixture contract.
3. Add parity fixtures from production exports, not live scans.
4. Test FoV and recommendation outputs against known legacy calculator examples.
5. Validate response safety: no secrets, no internal-only fields, no direct gated-document URLs.
6. Prefer scheduled snapshot generation over request-time DynamoDB/AppSync reads for the public Worker.
7. Join optical snapshot + Shopify commerce snapshot by SKU/handle/variant mapping.
8. Expose snapshot freshness and source provenance through `get_catalog_snapshot_status`.
9. Open a PR with parity proof and verification output.

## Recommended production architecture

Use a two-stage read-only architecture:

1. Scheduled refresh job reads approved sources:
   - DynamoDB/AppSync for optical/spec truth.
   - Shopify read-only APIs for commerce enrichment.
2. Refresh job validates and writes a static joined catalog snapshot.
3. Public MCP Worker reads only the validated snapshot at request time.

This is safer than making the public MCP Worker call Shopify and DynamoDB live for every agent request. It reduces secret exposure, avoids rate-limit surprises, gives deterministic responses, and makes validation failures visible before data reaches agents.

## Minimum launch checklist for useful live data

Before calling the data useful beyond fixtures:

- Shopify read-only credentials approved and stored outside source control.
- Shopify product/variant/metafield mapping confirmed for lens SKUs.
- DynamoDB/AppSync read source approved and field mapping documented.
- Production optics export or parity examples available.
- Snapshot join validates SKUs, URLs, prices, availability, optical specs, and provenance.
- Tests prove no write/mutation paths exist.
- `npm run verify` passes.
- Worker deploy smoke tests pass on Workers.dev.
- `get_catalog_snapshot_status` reports live/snapshot provenance and freshness.

## Future custom domain note

Current approved public endpoint remains Workers.dev:

`https://commonlands-mcp.erp-14c.workers.dev/mcp`

Do not move `commonlands.com` DNS to Cloudflare for this. The future clean custom-domain path requires Cloudflare Business custom hostname/proxy setup, currently estimated around `$200/month`.
