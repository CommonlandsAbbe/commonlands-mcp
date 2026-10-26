# Cart and checkout for agents

The production configuration in v0.4.3 enables Shopify UCP cart create/read/update/cancel and checkout create/read at `https://mcp.commonlands.com/mcp`. Customers review and pay on the Shopify-hosted `continue_url`. The server does not place orders or accept payment credentials.

## Agent flow

1. Discover the current tools with `tools/list`.
2. Resolve live variants, prices, and availability with `read_shopify_products`.
3. After the buyer confirms exact variants and quantities, call `create_cart` with `cart.line_items` containing `item.id` (full Shopify ProductVariant GID) and integer `quantity`.
4. Retain the full returned `cart.id`, including its query string, and `cart_access_token`. Use both for `get_cart`, `update_cart`, and `cancel_cart`.
5. `update_cart` replaces the **entire** cart. Read it first, include every line to retain, preserve existing line `id` values, and send `[]` to empty it. Legacy `update_items` and `remove_line_ids` are rejected on UCP endpoints rather than silently ignored.
6. When the buyer is ready, call `create_checkout` with `checkout.cart_id` and the top-level `cart_access_token`. The adapter supplies the required empty `checkout.line_items` array for cart conversion. Alternatively, pass explicit `checkout.line_items` to create a checkout directly.
7. Retain `checkout.id` and the separate `checkout_access_token`. `get_checkout` requires both. Show the returned `checkout.continue_url` so the customer can review shipping, taxes, and payment on Shopify. A prepared checkout is not an order or a payment.

Cancellation of a cart also requires a UUID in `meta["idempotency-key"]`. Reuse that UUID on retries of the same cancellation. Owner tokens are bearer credentials: keep them with the buyer's conversation; do not publish or log them. Commonlands cannot recover lost tokens.

## Runtime configuration

`wrangler.toml` records the enabled flags and merchant endpoints. Both adapters use `https://commonlands.com/api/ucp/mcp`; the retired `/api/mcp` endpoint no longer lists cart tools. `ENABLE_EXTRA_CHECKOUT_MUTATION_TOOLS` stays false. `complete_checkout` is unconditionally disabled because caller-supplied verification flags do not prove payment authorization.

`CART_TOKEN_SECRET` is an existing Cloudflare Worker secret used for HMAC owner binding. Checkout tokens use a separate namespace from cart tokens. No new credentials are required for the initial anonymous Shopify tier. That tier has the lowest rate limits; authenticated or signed traffic is a separate capacity upgrade. The Worker applies its per-IP mutation limit to checkout creation and cart cancellation as well as cart edits, and returns upstream failures without claiming success.

The discovery profile includes nested `ucp.version` and capability descriptors for negotiation, using Shopify's supported commerce version `2026-08-25`. Disabled capabilities are omitted. Existing top-level discovery fields remain for older Commonlands clients. Buyer, payment, fulfillment-address, and order fields are excluded from checkout responses.

## Verification and rollback

Run `npm run verify`. Regression coverage includes full-state updates, empty carts, fractional quantity rejection, cart conversion, flat checkout responses, missing or incorrect owner credentials, private-field filtering, disabled payment completion, discovery flags, and checkout rate limits.

Production verification on October 26, 2026 passed cart create/read/update and checkout create/read using a live in-stock CIL250 variant. Shopify returned an `incomplete` checkout with a human payment URL; no payment was attempted, and the checkout was canceled. Cancellation of a separate unconverted cart also passed. Lint, TypeScript, version parity, and all 151 tests passed. The profile must include its shopping service descriptor and `Cache-Control: public, max-age=60` for Shopify to accept it.

After deployment, verify `tools/list`, create one disposable cart from a live in-stock variant, read it, replace its quantity, convert it into a checkout, and read the checkout using its owner token. Do not call payment completion. Cancel the disposable cart and checkout after the smoke test where Shopify permits it.

To disable checkout handoff, deploy with `ENABLE_CHECKOUT_MUTATION_TOOLS:false`. Keep the UCP cart endpoint and corrected profile: reverting to the retired Storefront MCP endpoint would break carts again.

References: [Cart MCP](https://shopify.dev/docs/agents/carts-and-checkout/cart-mcp), [Checkout MCP](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp), [agent profiles](https://shopify.dev/docs/agents/get-started/profile), and [current authentication tiers](https://shopify.dev/docs/agents/profiles/auth-and-rate-limiting). The authentication tier table and verified merchant behavior govern anonymous handoff availability; some checkout overview text still states that authentication is mandatory.
