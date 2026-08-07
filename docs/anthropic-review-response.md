# Responses to Anthropic Connectors Directory review (2026-07)

This document records both Anthropic review rounds for
`com.commonlands/optics-mcp` and the exact submission reply.

## Status

The runtime controls are on main in v0.4.0. This branch aligns the submission
and reviewer documentation with that implementation; it remains pending exact-
head review and merge before production secret configuration, deployment, and
the Anthropic portal update.

## Problem

Anthropic found that a caller-supplied Shopify cart id could read or mutate an
existing cart without ownership proof, and that `submit_rfq` could send buyer
details without an explicit confirmation parameter. The submission's declared
tool list also omitted the live `submit_rfq` tool.

## Deliverables

- Cart-bound, create-issued bearer credentials for every existing-cart operation.
- Fail-closed rejection of existing-cart calls when owner binding is not configured.
- Required `confirm: true` gate before SendGrid delivery.
- Exact 21-tool Anthropic submission list including `submit_rfq`.

## Verification

`npm run verify` covers ESLint, TypeScript, version parity, and Vitest. Tests
prove missing and cross-cart credentials never call Shopify, and missing RFQ
confirmation never calls SendGrid. Verification does not execute a live cart
mutation or send a live email.

## Risks / Blockers

- Production needs a long random `CART_TOKEN_SECRET` stored as a Cloudflare Worker secret. If absent, `get_cart`/`update_cart` fail closed without calling Shopify.
- The Anthropic portal's declared tool list must be updated by an authorized directory owner after deployment.
- Live Analytics Engine usage counts require Microsoft SSO or an approved read-only Cloudflare credential.

## Reviewer Needed

An authorized Commonlands MCP code reviewer must review the exact PR head.
After merge, an operator with Cloudflare and Anthropic directory access owns
secret configuration, deployment verification, and the listing update.

## Follow-up review — cart ownership and RFQ confirmation

### Finding 1 — existing-cart ownership

`create_cart` remains authless. It now returns an opaque `cart_access_token`
credential signed by Commonlands and bound to the exact Shopify cart id.
`get_cart`, `update_cart`, and future `cancel_cart` require both that id and its
matching token. Missing, modified, or cross-cart tokens are rejected before
any Shopify call. When `CART_TOKEN_SECRET` is absent, existing-cart calls fail
closed; authless creation can still return a storefront continuation URL.
Request arguments and response bodies are not written to telemetry, so the
credential is not logged by the Worker.

### Finding 2 — RFQ confirmation and declared tool list

`submit_rfq` now requires `confirm: true` in its input schema. Without that
exact boolean, the server returns `pending_confirmation` with the proposed
message/reply-to details and sends no email. The Anthropic submission package
in `docs/directory-submissions.md` now declares all 21 live tools explicitly,
including `submit_rfq`.

### Suggested follow-up reply

> Thanks — both follow-up findings are now addressed server-side.
>
> `create_cart` remains available without authentication, but it issues a
> `cart_access_token` bound to the returned Shopify cart id.
> `get_cart` and `update_cart` require both that id and its matching token;
> missing, modified, or cross-cart tokens are rejected before Shopify is
> called. If owner binding is not configured, existing-cart calls fail closed.
>
> `submit_rfq` now requires explicit `confirm: true`. Calls without it return a
> confirmation-required proposal and send nothing. We also updated the
> submission's declared 21-tool list to include `submit_rfq`, matching the live
> server.

## Initial review — Shopify public-data scope and cart abuse controls

Anthropic's initial review raised two earlier findings. Both were addressed
server-side in v0.2.0.

## Finding 1 — Shopify data scope

> "read_shopify_metaobjects reads Admin-scope metaobjects, and
> read_shopify_products defaults to including metafields. This can expose
> non-public store data and contradicts the list's public-data-only privacy
> statement. Please narrow the tools to public product data or update the
> privacy declarations to match what is actually readable."

**We narrowed the tools.** The privacy statement stands; the surface now
enforces it server-side (see `PUBLIC_DATA_POLICY` in
`src/shopify-read-adapter.ts`):

1. **`read_shopify_metaobjects` is removed** from the tool surface (20 tools
   now). Calling it returns an actionable error directing agents to
   `read_shopify_products`. Admin metaobject definitions can hold non-public
   store content, so no public tool reads them at all.
2. **`read_shopify_products` now defaults `includeMetafields` to `false`.**
3. **Metafields are allowlisted.** When `includeMetafields: true`, only the
   `custom.*` display fields rendered on public commonlands.com product pages
   are returned (EFL, f-number, field of view, image circle, compatibility,
   FAQ text, drawing links, etc.). All other namespaces — app-private, SEO,
   channel metafields — and non-allowlisted keys (including the gated
   `custom.docsend_page`) are dropped server-side.
4. **Active products only.** DRAFT/ARCHIVED products are filtered out and the
   internal `status` field is never returned.
5. **No exact inventory.** Raw `inventoryQuantity` and inventory item IDs were
   replaced with a coarse `availability` signal
   (`in_stock` / `low_stock` / `out_of_stock` / `untracked`).
6. **Requested Admin scopes narrowed** to the read scopes this surface uses —
   metaobject, marketing, payment-terms, and shipping scopes removed from the
   approved-scope list. (Operator note: also remove them from the
   `SHOPIFY_SCOPES` dashboard var and untick the corresponding access scopes
   on the Shopify custom app so the exchanged token cannot carry them.)

## Finding 2 — Cart abuse controls

> "the cart tools are reachable without authentication. Please confirm what
> abuse controls exist (rate limits, cart expiry) since any caller can create
> or modify carts."

Cart tools intentionally follow the same trust model as Shopify's own public
Storefront cart API (any storefront visitor can create a cart without
authentication). Controls in place:

- **Per-IP rate limits** (Cloudflare Workers Rate Limiting API, declared in
  `wrangler.toml`): **120 requests/min per IP** across the endpoint and a
  stricter **10 cart mutations/min per IP** for `create_cart`/`update_cart`.
  Exceeding a budget returns HTTP 429 with `retry-after: 60`.
- **Strict payload validation before any Shopify call:** 1–25 line items per
  cart, quantity 1–999 per line, and item IDs must be live Shopify
  `ProductVariant` GIDs (SKUs, numeric IDs, and fixture IDs are rejected).
- **Cart expiry is Shopify-owned.** The Worker is a stateless proxy
  (`expiryAuthority: shopify_cart_ttl_expires_at`): carts live in Shopify,
  carry Shopify's TTL, and are pruned by Shopify automatically. The Worker
  stores no cart, session, customer, or payment state that could accumulate.
- **Bounded blast radius:** checkout and cancel-cart tools are not exposed;
  the server cannot take payment, create orders or customers, apply
  discounts, or write inventory/catalog data — an abusive caller can only
  create transient, unpaid, Shopify-expiring cart state, at most 10 times per
  minute per IP.
- Request bodies are size-capped, outbound calls are host+path allowlisted,
  and privacy-safe telemetry (no arguments, no PII) gives us per-tool
  visibility to spot abuse patterns.

## Suggested reply text (paste into the review thread)

> Thanks for the review — both findings are addressed in v0.2.0, live now.
>
> **Data scope:** we narrowed the tools rather than the declarations.
> `read_shopify_metaobjects` has been removed from the surface entirely.
> `read_shopify_products` now defaults to no metafields and, when requested,
> returns only an allowlist of the `custom.*` display fields already rendered
> on our public product pages; it also filters to ACTIVE products and returns
> a coarse availability signal instead of exact inventory counts. The
> requested Admin scopes were narrowed to match. The public-data-only privacy
> statement is now enforced server-side.
>
> **Cart abuse:** cart tools follow the same unauthenticated trust model as
> Shopify's public Storefront cart, with these controls: per-IP rate limits
> (120 req/min endpoint-wide, 10 cart mutations/min), strict payload caps
> (1–25 lines, quantity ≤999, live ProductVariant GIDs only), and
> Shopify-owned cart expiry — the Worker is a stateless proxy and stores no
> cart/session/customer state. Checkout, payment, order, customer, discount,
> and inventory surfaces are not exposed, so abusive callers can only create
> transient, unpaid carts that Shopify expires.
>
> The listed tool count is now 20 (was 21) after removing the metaobjects
> tool.
