/**
 * Stateless owner binding for Shopify carts on an unauthenticated endpoint
 * (Anthropic directory review, round 2).
 *
 * create_cart mints an HMAC-SHA256 credential over the Shopify cart id using a
 * server-side secret (CART_TOKEN_SECRET). Only the caller that created the
 * cart receives the token, and get_cart/update_cart refuse to act without it,
 * so holding or guessing a cart id is no longer enough to read or rewrite
 * someone else's cart. The Worker stays stateless: nothing is stored, the
 * token is recomputed and compared on every call.
 */

const TOKEN_BYTES = 16; // 128-bit truncation of the HMAC output.

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function mintCartToken(secret: string, cartId: string): Promise<string> {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`commonlands-cart-v1:${cartId}`));
  return base64Url(new Uint8Array(signature).slice(0, TOKEN_BYTES));
}

export async function verifyCartToken(secret: string, cartId: string, token: unknown): Promise<boolean> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 128) return false;
  const expected = await mintCartToken(secret, cartId);
  // Constant-time comparison over equal-length strings.
  if (token.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= token.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}
