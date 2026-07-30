const TOKEN_VERSION = 'cc1';
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const MIN_SECRET_LENGTH = 32;
const NONCE_BYTES = 16;

export interface CartCapability {
  token: string;
  expiresAt: string;
  credentialType: 'bearer_cart_capability';
  requiredFor: ['get_cart', 'update_cart', 'cancel_cart'];
}

type VerificationResult = { ok: true } | { ok: false; error: string };

export function isCartCapabilityConfigured(secret: string | undefined): boolean {
  return typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH;
}

export async function issueCartCapability(
  secret: string,
  cartId: string,
  nowMs = Date.now(),
): Promise<CartCapability> {
  if (!isCartCapabilityConfigured(secret)) {
    throw new Error(`CART_CAPABILITY_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  const expiresAtSeconds = Math.floor(nowMs / 1000) + DEFAULT_TTL_SECONDS;
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const payload = `${TOKEN_VERSION}.${expiresAtSeconds}.${base64UrlEncode(nonce)}`;
  const signature = await sign(secret, cartId, payload);

  return {
    token: `${payload}.${base64UrlEncode(signature)}`,
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    credentialType: 'bearer_cart_capability',
    requiredFor: ['get_cart', 'update_cart', 'cancel_cart'],
  };
}

export async function verifyCartCapability(
  secret: string | undefined,
  cartId: unknown,
  token: unknown,
  nowMs = Date.now(),
): Promise<VerificationResult> {
  if (!isCartCapabilityConfigured(secret)) {
    return { ok: false, error: 'Cart resume is unavailable because CART_CAPABILITY_SECRET is not configured.' };
  }
  if (typeof cartId !== 'string' || cartId.trim() === '') {
    return { ok: false, error: 'Invalid params: id is required' };
  }
  if (typeof token !== 'string' || token.trim() === '') {
    return {
      ok: false,
      error: 'Invalid params: cart_token from create_cart is required to read or update this cart.',
    };
  }

  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return invalidToken();
  const expiresAtSeconds = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds <= Math.floor(nowMs / 1000)) {
    return invalidToken();
  }
  if (!/^[A-Za-z0-9_-]{20,24}$/.test(parts[2] ?? '')) return invalidToken();

  let signature: Uint8Array;
  try {
    signature = base64UrlDecode(parts[3] ?? '');
  } catch {
    return invalidToken();
  }
  if (signature.byteLength !== 32) return invalidToken();

  const payload = `${parts[0]}.${parts[1]}.${parts[2]}`;
  const key = await importKey(secret as string);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    new TextEncoder().encode(capabilityMessage(cartId.trim(), payload)),
  );
  return valid ? { ok: true } : invalidToken();
}

function invalidToken(): VerificationResult {
  return {
    ok: false,
    error: 'Invalid params: cart_token is invalid, expired, or does not match this cart.',
  };
}

async function sign(secret: string, cartId: string, payload: string): Promise<Uint8Array> {
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(capabilityMessage(cartId, payload)),
  );
  return new Uint8Array(signature);
}

function capabilityMessage(cartId: string, payload: string): string {
  return `commonlands-cart-capability\n${cartId}\n${payload}`;
}

function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid base64url');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
