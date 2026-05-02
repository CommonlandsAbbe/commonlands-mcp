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

### Shopify

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_STOREFRONT_TOKEN`
- `SHOPIFY_ADMIN_READ_TOKEN` if Admin read access is approved

Rules:

- Read-only access only.
- No product, variant, inventory, metafield, collection, cart, checkout, or customer writes.
- Admin read token must be scoped narrowly and stored only in secret storage.

### Cloudflare

Cloudflare account ID, zone ID, routes, and deploy tokens should be stored in GitHub/Cloudflare secrets, not source control.

## Rotation and audit

- Rotate any credential accidentally exposed during setup.
- Keep a short access log in the PR or deployment notes: credential name, owner, scope, environment, and date added.
- Do not include secret values in PR descriptions, screenshots, fixtures, tests, logs, or docs.
