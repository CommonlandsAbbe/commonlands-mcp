// Creates only disposable cart/checkout state. Never calls complete_checkout.
// Credentials, resource IDs, and checkout URLs stay in memory, not logs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

if (!process.argv.includes('--live')) throw new Error('Pass --live to run the disposable production commerce smoke test.');
const endpoint = 'https://mcp.commonlands.com/mcp';
const profile = 'https://mcp.commonlands.com/.well-known/ucp';
const upstream = 'https://commonlands.com/api/ucp/mcp';
async function call(name, args, target = endpoint) {
  const response = await globalThis.fetch(target, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }),
    signal: globalThis.AbortSignal.timeout(20000),
  });
  const payload = await response.json();
  const result = payload.result;
  if (!response.ok || payload.error || result?.isError) {
    // Print only adapter diagnostics, never arbitrary downstream checkout state.
    throw new Error(`${name}: HTTP ${response.status}; ${payload.error?.message ?? result?.structuredContent?.connector?.messages?.join('; ') ?? 'upstream tool error'}`);
  }
  return result.structuredContent ?? JSON.parse(result.content.find(item => item.type === 'text').text);
}

const productRead = await call('read_shopify_products', { sku: 'CIL250', limit: 5 });
const variants = (productRead.products ?? []).flatMap(product => product.variants ?? []);
const variant = variants.find(item => item.variantId && ['in_stock', 'low_stock'].includes(item.availability));
assert(variant, 'No live in-stock CIL250 variant found; no test cart created.');
let cart, checkout;
try {
  cart = await call('create_cart', { cart: { line_items: [{ quantity: 1, item: { id: variant.variantId } }] } });
  assert(cart.cart?.id && cart.cart_access_token, 'Cart creation did not return id and owner token.');
  const cartArgs = { id: cart.cart.id, cart_access_token: cart.cart_access_token };
  const read = await call('get_cart', cartArgs);
  assert.equal(read.cart.id, cart.cart.id);
  const line = read.cart.line_items?.[0];
  assert(line, 'Cart read returned no line item.');
  const updated = await call('update_cart', { ...cartArgs, cart: { line_items: [{ id: line.id, quantity: 2, item: { id: variant.variantId } }] } });
  assert.equal(updated.cart.line_items[0].quantity, 2);
  checkout = await call('create_checkout', { cart_access_token: cart.cart_access_token, checkout: { cart_id: cart.cart.id } });
  assert(checkout.checkout?.id && checkout.checkout_access_token, 'Checkout did not return id and owner token.');
  assert(checkout.checkout.continue_url, 'Checkout did not return a human handoff URL.');
  const checked = await call('get_checkout', { id: checkout.checkout.id, checkout_access_token: checkout.checkout_access_token });
  assert.equal(checked.checkout.id, checkout.checkout.id);
  assert.notEqual(checked.checkout.status, 'completed');
  console.log(JSON.stringify({ ok: true, cartCreate: true, cartRead: true, cartUpdate: true, checkoutCreate: true, checkoutRead: true, checkoutStatus: checked.checkout.status, humanPaymentUrl: true, paymentAttempted: false }));
} finally {
  if (checkout?.checkout?.id) {
    try {
      await call('cancel_checkout', { id: checkout.checkout.id, meta: { 'ucp-agent': { profile }, 'idempotency-key': randomUUID() } }, upstream);
      console.log('Disposable checkout canceled.');
    } catch (error) { console.log(`Checkout cleanup: ${error.message}`); }
  }
  if (cart?.cart?.id) {
    try {
      await call('cancel_cart', { id: cart.cart.id, cart_access_token: cart.cart_access_token, meta: { 'idempotency-key': randomUUID() } });
      console.log('Disposable cart canceled.');
    } catch (error) { console.log(`Cart cleanup: ${error.message}`); }
  }
}
