# Response to Anthropic Connectors Directory review (2026-07)

Anthropic's review of `com.commonlands/optics-mcp` raised two findings. Both
are addressed server-side in v0.2.0 (this repo), deployed at
`https://mcp.commonlands.com/mcp`. This document is the draft reply plus the
engineering record of what changed.

## Finding 1 — Shopify data scope

> "read_shopify_metaobjects reads Admin-scope metaobjects, and
> read_shopify_products defaults to including metafields. This can expose
> non-public store data and contradicts the list's public-data-only privacy
> statement. Please narrow the tools to public product data or update the
> privacy declarations to match what is actually readable."

**We narrowed the tools.** The privacy statement stands; the surface now
enforces it server-side (see `PUBLIC_DATA_POLICY` in
`src/shopify-read-adapter.ts`):

1. **`read_shopify_metaobjects` is removed** from the tool surface (21 tools
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
