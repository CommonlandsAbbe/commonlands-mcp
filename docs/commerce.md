# Cart and checkout for agents

The production configuration in v0.4.4 enables Shopify UCP cart create/read/update/cancel and checkout create/read at `https://mcp.commonlands.com/mcp`. Agents can use the cart's `agent_checkout` route to continue in the buyer's separate **Shop MCP** connection for an authorized purchase. Customers can also review and pay on the Shopify-hosted `continue_url`. The Commonlands server does not accept payment credentials or execute payment itself.

## Buyer-authorized agent purchases

Connect `https://mcp.shop.com/` in the customer's agent client, alongside Commonlands. Shop currently requires MCP `2026-07-28`; older initialize-only clients need an upgrade or the official Shop CLI. See [Shop connection instructions](https://shop.dev/docs/connect). The customer signs in directly to Shop to use saved addresses and Shop Pay. Their OAuth token belongs only in the Authorization header sent to Shop; it must never be supplied to Commonlands, tool arguments, chat, or logs.

After confirming live variants and quantities, create a Commonlands cart. Successful nonempty UCP cart create/read/update responses include `agent_checkout.next_call`: the exact `create_checkout` arguments for **Shop MCP**, with the fixed Commonlands merchant domain and full cart ID. The field describes a call; returning it does not execute it. Choose this route **before** calling Commonlands `create_checkout`, because conversion consumes the cart. Add one UUID `meta["idempotency-key"]` and retain it for that conversion. Keep the Commonlands owner token private; Shop does not need it.

Continue checkout updates and payment entirely through the customer's Shop connection. Have the buyer approve the current items, quantities, delivery, total, and offered payment method. Copy the selected instrument exactly, and call Shop `complete_checkout` once only when the current checkout is `ready_for_complete`. Show all warnings, legal links, and the unchanged `continue_url`. An empty instrument list or `requires_escalation` requires the buyer to finish at that URL. Only `completed` **and** an `order` confirms success. If completion times out, read the same checkout; do not repeat payment or create a replacement purchase. See [Shop checkout behavior](https://shop.dev/docs/checkout).

The route supports buyer-authorized purchases through Shopify's integration; it does not grant Commonlands its own direct-completion entitlement. Shopify requires an approved client and merchant agent channel for direct Checkout MCP completion. Existing merchant Admin API credentials and caller-supplied verification flags do not satisfy those requirements. Shopify staff describe this gate in their [completion eligibility guidance](https://community.shopify.dev/t/how-can-a-token-tier-ucp-client-obtain-permission-to-call-complete-checkout/36590/9). A future Commonlands-hosted buyer sign-in app would also need its own registered Shop client; do not reuse Shop's personal-agent public client for a distributed app.

## Agent flow

1. Discover the current tools with `tools/list`.
2. Resolve live variants, prices, and availability with `read_shopify_products`.
3. After the buyer confirms exact variants and quantities, call `create_cart` with `cart.line_items` containing `item.id` (full Shopify ProductVariant GID) and integer `quantity`.
4. Retain the full returned `cart.id`, including its query string, and `cart_access_token`. Use both for `get_cart`, `update_cart`, and `cancel_cart`.
5. `update_cart` replaces the **entire** cart. Read it first, include every line to retain, preserve existing line `id` values, and send `[]` to empty it. Legacy `update_items` and `remove_line_ids` are rejected on UCP endpoints rather than silently ignored.
6. When the buyer is ready for customer-paid checkout, call Commonlands `create_checkout` with `checkout.cart_id` and the top-level `cart_access_token`. For agent completion, use the Shop route above instead. The adapter supplies the required empty `checkout.line_items` array for cart conversion. Alternatively, pass explicit `checkout.line_items` to create a checkout directly.
7. Retain `checkout.id` and the separate `checkout_access_token`. `get_checkout` requires both. Show the returned `checkout.continue_url` so the customer can review shipping, taxes, and payment on Shopify. A prepared checkout is not an order or a payment.

Cancellation of a cart also requires a UUID in `meta["idempotency-key"]`. Reuse that UUID on retries of the same cancellation. Owner tokens are bearer credentials: keep them with the buyer's conversation; do not publish or log them. Commonlands cannot recover lost tokens.

## Runtime configuration

`wrangler.toml` records the enabled flags and merchant endpoints. Both adapters use `https://commonlands.com/api/ucp/mcp`; the retired `/api/mcp` endpoint no longer lists cart tools. `ENABLE_EXTRA_CHECKOUT_MUTATION_TOOLS` stays false. `complete_checkout` is unconditionally disabled because caller-supplied verification flags do not prove payment authorization.

`CART_TOKEN_SECRET` is an existing Cloudflare Worker secret used for HMAC owner binding. Checkout tokens use a separate namespace from cart tokens. No new credentials are required for the initial anonymous Shopify tier. That tier has the lowest rate limits; authenticated or signed traffic is a separate capacity upgrade. The Worker applies its per-IP mutation limit to checkout creation and cart cancellation as well as cart edits, and returns upstream failures without claiming success.

The discovery profile includes nested `ucp.version` and capability descriptors for negotiation, using Shopify's supported commerce version `2026-08-25`. Disabled capabilities are omitted. Existing top-level discovery fields remain for older Commonlands clients. Buyer, payment, fulfillment-address, and order fields are excluded from checkout responses.

## Verification and rollback

Run `npm run verify`. Regression coverage includes full-state updates, empty carts, fractional quantity rejection, cart conversion, flat checkout responses, missing or incorrect owner credentials, private-field filtering, disabled payment completion, discovery flags, and checkout rate limits.

Shop route regression coverage checks exact cart handoff arguments, no credential forwarding, and no routes for unowned, empty, consumed, or failed carts. `node scripts/smoke-shop-handoff.mjs --live` verifies production handoff through Shop without attempting payment and cancels the disposable checkout through the merchant endpoint. This checks anonymous cart transfer and checkout creation/read; authenticated payment and order completion require a buyer's Shop session and explicit purchase approval and are not claimed as tested.

Production verification on October 26, 2026 passed cart create/read/update and checkout create/read using a live in-stock CIL250 variant. Shopify returned an `incomplete` checkout with a human payment URL; no payment was attempted, and the checkout was canceled. Cancellation of a separate unconverted cart also passed. Lint, TypeScript, version parity, and all 151 tests passed. The profile must include its shopping service descriptor and `Cache-Control: public, max-age=60` for Shopify to accept it.

After deployment, verify `tools/list`, create one disposable cart from a live in-stock variant, read it, replace its quantity, convert it into a checkout, and read the checkout using its owner token. Do not call payment completion. Cancel the disposable cart and checkout after the smoke test where Shopify permits it.

To disable checkout handoff, deploy with `ENABLE_CHECKOUT_MUTATION_TOOLS:false`. Keep the UCP cart endpoint and corrected profile: reverting to the retired Storefront MCP endpoint would break carts again.

References: [Cart MCP](https://shopify.dev/docs/agents/carts-and-checkout/cart-mcp), [Checkout MCP](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp), [agent profiles](https://shopify.dev/docs/agents/get-started/profile), and [current authentication tiers](https://shopify.dev/docs/agents/profiles/auth-and-rate-limiting). The authentication tier table and verified merchant behavior govern anonymous handoff availability; some checkout overview text still states that authentication is mandatory.
