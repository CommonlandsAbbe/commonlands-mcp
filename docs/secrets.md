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

### AWS / DynamoDB / AppSync

- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `APPSYNC_GRAPHQL_ENDPOINT`
- `APPSYNC_READ_TOKEN` or approved SigV4 credential path

Rules:

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
- No product, variant, inventory, metafield, collection, checkout, order, customer, or catalog writes.
- Client secret/token material must be scoped narrowly and stored only in secret storage.

### Shopify Cart UCP

- `SHOPIFY_CART_MCP_ENDPOINT` non-secret HTTPS merchant Cart MCP endpoint, normally `https://commonlands.com/api/ucp/mcp` when available.
- `SHOPIFY_UCP_AGENT_PROFILE` optional non-secret profile URL; defaults to the live Commonlands UCP discovery URL.

Rules:

- Cart UCP is the only approved Shopify mutation surface in this MCP.
- Cart state is stored and mutated by Shopify Cart MCP; Commonlands Worker remains stateless and stores no cart database/session/customer record.
- No Checkout MCP, payment completion, order creation, customer records, discounts, inventory reservation/mutation, inventory sync changes, product writes, metafield writes, or catalog writes.
- Do not log returned credentials, signed URLs, or authorization material if Shopify Cart MCP ever adds authenticated transport.

### Cloudflare

Cloudflare account ID, zone ID, routes, and deploy tokens should be stored in GitHub/Cloudflare secrets, not source control.

## Rotation and audit

- Rotate any credential accidentally exposed during setup.
- Keep a short access log in the PR or deployment notes: credential name, owner, scope, environment, and date added.
- Do not include secret values in PR descriptions, screenshots, fixtures, tests, logs, or docs.
