// Anonymous integration test only. Never signs in, supplies payment, or orders.
// Resource IDs, owner tokens, and URLs remain in memory.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

if (!process.argv.includes('--live')) throw new Error('Pass --live to create and cancel a disposable production checkout.');
const commonlands = 'https://mcp.commonlands.com/mcp';
const shop = 'https://mcp.shop.com/';
const merchant = 'https://commonlands.com/api/ucp/mcp';
const profile = 'https://mcp.commonlands.com/.well-known/ucp';
const allowedTools = new Set(['read_shopify_products', 'create_cart', 'get_cart', 'create_checkout', 'get_checkout', 'cancel_cart', 'cancel_checkout']);
async function call(target, name, args) {
  assert(allowedTools.has(name), 'This smoke test must not attempt payment.');
  const headers = { 'content-type': 'application/json', Accept: 'application/json, text/event-stream' };
  const params = { name, arguments: args };
  if (target === shop) {
    headers['MCP-Protocol-Version'] = '2026-07-28';
    headers['Mcp-Method'] = 'tools/call';
    headers['Mcp-Name'] = name;
    params._meta = {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientInfo': { name: 'commonlands-commerce-verification', version: '0.4.4' },
      'io.modelcontextprotocol/clientCapabilities': {},
    };
  }
  const response = await globalThis.fetch(target, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params }),
    signal: globalThis.AbortSignal.timeout(20000),
  });
  const payload = await response.json();
  if (!response.ok || payload.error || payload.result?.isError) {
    throw new Error(`${name}: HTTP ${response.status}; RPC code ${payload.error?.code ?? 'tool_error'}`);
  }
  return payload.result.structuredContent ?? JSON.parse(payload.result.content.find(item => item.type === 'text').text);
}

const products = await call(commonlands, 'read_shopify_products', { sku: 'CIL250', limit: 5 });
const variant = products.products?.flatMap(product => product.variants ?? [])
  .find(item => item.variantId && ['in_stock', 'low_stock'].includes(item.availability));
assert(variant, 'No live in-stock CIL250 variant; no cart created.');
let cart, checkout;
try {
  cart = await call(commonlands, 'create_cart', { cart: { line_items: [{ quantity: 1, item: { id: variant.variantId } }] } });
  assert(cart.cart?.id && cart.cart_access_token, 'Missing cart or owner token.');
  const route = cart.agent_checkout;
  assert.equal(route?.endpoint, shop);
  assert.equal(route.next_call.tool, 'create_checkout');
  assert.equal(route.next_call.arguments.checkout.cart_id, cart.cart.id);
  assert.equal(route.next_call.arguments.shop, 'commonlands-camera-components.myshopify.com');
  assert.equal(route.order_created, false);
  assert.equal(route.payment_attempted, false);
  const imported = await call(shop, 'get_cart', { shop: route.next_call.arguments.shop, id: cart.cart.id });
  assert.equal(imported.id, cart.cart.id);
  checkout = await call(shop, route.next_call.tool, {
    ...route.next_call.arguments, meta: { 'idempotency-key': randomUUID() },
  });
  assert(checkout.id && checkout.continue_url, 'Shop did not return a checkout handoff.');
  const checked = await call(shop, 'get_checkout', { shop: route.next_call.arguments.shop, id: checkout.id });
  assert.equal(checked.id, checkout.id);
  assert.notEqual(checked.status, 'completed');
  console.log(JSON.stringify({ ok: true, cartTransfer: true, shopCheckoutCreate: true, shopCheckoutRead: true, status: checked.status, paymentAttempted: false }));
} finally {
  if (checkout?.id) {
    try {
      await call(merchant, 'cancel_checkout', { id: checkout.id, meta: { 'ucp-agent': { profile }, 'idempotency-key': randomUUID() } });
      console.log('Disposable checkout canceled.');
    } catch (error) { console.log(`Checkout cleanup: ${error.message}`); }
  } else if (cart?.cart?.id) {
    try {
      await call(commonlands, 'cancel_cart', { id: cart.cart.id, cart_access_token: cart.cart_access_token, meta: { 'idempotency-key': randomUUID() } });
      console.log('Disposable cart canceled.');
    } catch (error) { console.log(`Cart cleanup: ${error.message}`); }
  }
}
