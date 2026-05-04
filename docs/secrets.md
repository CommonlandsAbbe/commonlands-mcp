# Secrets and Environment Plan

## Phase 0

Phase 0 requires no production secrets.

Non-secret Worker vars:

- `ENVIRONMENT`
- `VERSION`
- `GIT_SHA`

Local development may copy `.env.example` to `.dev.vars`, but real credentials must not be committed.

## Future secrets

Later phases may need read-only credentials. These names are placeholders until Max/Abbe confirm the actual access model.

### AWS / Lambda / DynamoDB FoV

The Worker must not receive AWS credentials. Live FoV reads go through the fixed API Gateway/Lambda endpoint, and Lambda owns read-only DynamoDB IAM.

Worker variables/secrets:

- `FOV_LIVE_BACKEND_ENABLED` non-secret explicit gate; default/absent keeps `compute_fov` fixture-backed.
- `FOV_LAMBDA_ENDPOINT` non-secret fixed endpoint. Current approved endpoint: `https://ia97wrz7ag.execute-api.us-west-2.amazonaws.com/default/fov`.
- `FOV_API_KEY` secret shared with Lambda. Store only as a Cloudflare secret; never commit, paste, or return it.

Rules:

- Lambda direct calls must reject unauthenticated requests.
- Worker sends `x-api-key` server-side; agents and users never see the key.
- Keep endpoint allowlisted, HTTPS-only, timeout-bound, and response-size-bound.
- DynamoDB IAM belongs only to Lambda, with exact table/index read actions and no writes/admin/wildcards.
- Rotate any FoV API key exposed during setup before enabling the live Worker path.

### Legacy AWS / DynamoDB / AppSync placeholders

- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `APPSYNC_GRAPHQL_ENDPOINT`
- `APPSYNC_READ_TOKEN` or approved SigV4 credential path

Rules:

- Do not add AWS credentials to the Worker.
- Read-only access only.
- No write IAM actions.
- Prefer least-privilege staging credentials first.
- Do not log request signatures, tokens, or raw credential material.

### Shopify Admin diagnostic reads

- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`
- `SHOPIFY_SHOP_DOMAIN`
- `SHOPIFY_SCOPES`
- `SHOPIFY_ADMIN_API_VERSION` optional; defaults in code when omitted

Rules:

- Admin API access remains read-only.
- No product, variant, inventory, metafield, collection, direct payment capture, raw card handling, customer-account, or catalog writes. Checkout completion is only proxied to Shopify Checkout MCP after Shopify authentication/authorization.
- Client secret/token material must be scoped narrowly and stored only in secret storage.

### Shopify Cart MCP

- `ENABLE_COMMERCE_MUTATION_TOOLS` non-secret explicit gate; cart tools are exposed only when this is `true` and the target environment is approved/configured. Live `tools/list` is authoritative.
- `SHOPIFY_CART_MCP_ENDPOINT` non-secret HTTPS merchant Cart MCP endpoint. Current confirmed Commonlands Storefront MCP endpoint is `https://commonlands-camera-components.myshopify.com/api/mcp`; the Worker also permits exact Commonlands merchant hosts only, not arbitrary tool-supplied endpoints.
- `SHOPIFY_UCP_AGENT_PROFILE` optional non-secret profile URL; defaults to the live Commonlands UCP discovery URL.

Rules:

- Cart MCP tools are exposed only when explicitly approved, gated, and endpoint-bound. The current live approved standard Storefront MCP surface exposes `create_cart`, `get_cart`, and `update_cart`; `cancel_cart` remains hidden unless a validated UCP Cart MCP endpoint supports cancel semantics.
- Cart state is stored and mutated by Shopify Cart MCP; Commonlands Worker remains stateless and stores no cart database/session/customer record.
- Do not log returned credentials, signed URLs, or authorization material if Shopify Cart MCP ever adds authenticated transport.

### Shopify Checkout MCP

- `ENABLE_CHECKOUT_MUTATION_TOOLS` non-secret explicit gate; basic checkout tools (`create_checkout`, `get_checkout`) are hidden unless set to `true`.
- `ENABLE_EXTRA_CHECKOUT_MUTATION_TOOLS` non-secret explicit gate; extra checkout operations (`update_checkout`, `complete_checkout`, `cancel_checkout`) are hidden unless set to `true` and should require official review before use.
- `SHOPIFY_CHECKOUT_MCP_ENDPOINT` non-secret HTTPS merchant Checkout MCP endpoint on `commonlands.com`, normally `https://commonlands.com/api/checkout/mcp` when available.
- `SHOPIFY_UCP_AGENT_PROFILE` optional non-secret profile URL; defaults to the live Commonlands UCP discovery URL.

Rules:

- Checkout MCP remains hidden by default pending approval, Cloudflare protections, endpoint binding, and merchant-side availability.
- Checkout state is stored and mutated by Shopify Checkout MCP; Commonlands Worker remains stateless and stores no checkout database/session/customer/payment record.
- `complete_checkout` requires Shopify-authenticated buyer/payment verification and idempotency. No raw payment credentials, customer records, discounts/gift cards, inventory reservation/mutation, inventory sync changes, product writes, metafield writes, or catalog writes are accepted by Commonlands MCP.
- Do not log returned credentials, signed URLs, or authorization material if Shopify Checkout MCP ever adds authenticated transport.

### Cloudflare

Cloudflare account ID, zone ID, routes, and deploy tokens should be stored in GitHub/Cloudflare secrets, not source control.

## Rotation and audit

- Rotate any credential accidentally exposed during setup.
- Keep a short access log in the PR or deployment notes: credential name, owner, scope, environment, and date added.
- Do not include secret values in PR descriptions, screenshots, fixtures, tests, logs, or docs.
