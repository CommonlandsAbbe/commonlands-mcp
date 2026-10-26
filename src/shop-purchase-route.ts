// Shop authenticates the buyer directly. Never proxy its OAuth token or a
// payment instrument through the public Commonlands endpoint.
export const SHOP_MCP_ENDPOINT = 'https://mcp.shop.com/';
export const COMMONLANDS_SHOP_DOMAIN = 'commonlands-camera-components.myshopify.com';

/** Enrich a successful, owner-bound UCP cart response with an external route.
 * This only describes the next call; it never creates or completes a checkout.
 */
export function withShopPurchaseRoute(result: Record<string, unknown>): Record<string, unknown> {
  const connector = result.connector;
  const cart = result.cart;
  if (!isRecord(connector) || connector.status !== 'ok' || !isRecord(cart)
      || typeof cart.id !== 'string' || !/^gid:\/\/shopify\/Cart\/[A-Za-z0-9_?=&:-]+$/.test(cart.id)
      || result.operation === 'cancel_cart'
      || ['canceled', 'cancelled', 'completed', 'converted', 'expired'].includes(String(cart.status))
      || !Array.isArray(cart.line_items) || cart.line_items.length === 0) return result;

  return {
    ...result,
    agent_checkout: {
      mode: 'external_shop_mcp',
      status: 'buyer_connection_and_purchase_approval_required',
      endpoint: SHOP_MCP_ENDPOINT,
      protocol_version: '2026-07-28',
      connection_guide: 'https://shop.dev/docs/connect',
      checkout_guide: 'https://shop.dev/docs/checkout',
      authentication: {
        handled_by: 'buyer_mcp_client_directly_with_shop',
        resource: 'https://mcp.shop.com',
        scope: 'personal_agent',
        token_destination: SHOP_MCP_ENDPOINT,
      },
      next_call: {
        tool: 'create_checkout',
        arguments: {
          shop: COMMONLANDS_SHOP_DOMAIN,
          checkout: { cart_id: cart.id, line_items: [] },
        },
      },
      instructions: [
        'Use this route only when the buyer wants their agent to purchase. Connect Shop MCP in the buyer\'s client and sign in to Shop for saved addresses and Shop Pay.',
        'Call next_call on Shop MCP, not Commonlands. Conversion consumes this cart: choose this route before Commonlands create_checkout. Add one UUID meta["idempotency-key"] and retain it for this conversion.',
        'Keep the full cart/checkout IDs private. Do not send cart_access_token to Shop. Shop OAuth tokens and offered payment instruments must go directly to Shop MCP, never Commonlands or chat/logs.',
        'After creation, use Shop get_checkout and update_checkout with the same shop and exact checkout ID. Updates replace the full document; retain all other fields.',
        'Show the buyer current items, quantities, delivery, totals, warnings, legal links, and continue_url. Require their approval of the purchase and their choice of an offered payment method.',
        'Only when the latest checkout is ready_for_complete and offers a payment instrument, call Shop complete_checkout once with that exact buyer-selected instrument, all its fields, and selected:true.',
        'If payment instruments are empty or status is requires_escalation, return continue_url for the buyer to finish.',
        'Only status completed together with an order confirms purchase. After an uncertain completion, use get_checkout; never repeat completion or create a replacement purchase.',
      ],
      order_created: false,
      payment_attempted: false,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
