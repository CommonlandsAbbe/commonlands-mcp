import { fetchWithTimeout, readJsonWithLimit } from './http-safety';
import { UCP_VERSION } from './ucp-catalog';

export interface ShopifyCheckoutMcpEnv {
  SHOPIFY_CHECKOUT_MCP_ENDPOINT?: string;
  SHOPIFY_UCP_AGENT_PROFILE?: string;
}

export type CheckoutOperation = 'create_checkout' | 'get_checkout' | 'update_checkout' | 'complete_checkout' | 'cancel_checkout';

export interface ShopifyCheckoutMcpResult {
  schemaVersion: 'commonlands.checkout_mcp.v1';
  mode: 'shopify_checkout_mcp_proxy';
  generatedAt: string;
  configured: boolean;
  operation: CheckoutOperation;
  ucp: {
    version: typeof UCP_VERSION;
    capability: 'dev.ucp.shopping.checkout';
    transport: 'mcp';
  };
  persistence: {
    storedIn: 'shopify_checkout_mcp';
    mutatedBy: 'shopify_checkout_mcp_tools';
    commonlandsWorkerState: 'stateless_proxy_no_checkout_storage';
    resumeAcrossAgentSessions: 'caller_must_retain_checkout_id_or_checkout_url';
    expiryAuthority: 'shopify_checkout_ttl_expires_at';
  };
  connector: {
    status: 'ok' | 'not_configured' | 'shopify_error' | 'invalid_request';
    source: 'shopify_checkout_mcp' | 'not_connected';
    endpointHost?: string;
    messages: string[];
  };
  checkout: unknown | null;
  safety: {
    createsCheckout: boolean;
    updatesCheckout: boolean;
    cancelsCheckout: boolean;
    completesCheckout: boolean;
    createsOrder: boolean;
    capturesPayment: boolean;
    readsCustomers: false;
    createsCustomer: false;
    mutatesInventory: false;
    touchesInventorySync: false;
    writesCatalog: false;
    exposesSecrets: false;
  };
}

type CheckoutArgs = Record<string, unknown>;

type NormalizedLineItem = {
  quantity: number;
  item: { id: string };
};

type NormalizedCheckout = {
  line_items?: NormalizedLineItem[];
  cart_id?: string;
  context?: Record<string, string>;
};

const DEFAULT_AGENT_PROFILE = 'https://commonlands-mcp.erp-14c.workers.dev/.well-known/ucp';
const JSON_RPC_ID = 'commonlands-checkout-mcp';

export async function callShopifyCheckoutMcp(
  env: ShopifyCheckoutMcpEnv,
  operation: CheckoutOperation,
  args: CheckoutArgs,
): Promise<ShopifyCheckoutMcpResult> {
  const endpoint = parseEndpoint(env.SHOPIFY_CHECKOUT_MCP_ENDPOINT);
  if ('error' in endpoint) return withConnector(baseResult(operation), 'not_configured', 'not_connected', [endpoint.error]);

  const normalized = normalizeArgs(operation, args, env.SHOPIFY_UCP_AGENT_PROFILE);
  if ('error' in normalized) return withConnector(baseResult(operation), 'invalid_request', 'not_connected', [normalized.error]);

  let response: Response;
  try {
    response = await fetchWithTimeout(endpoint.url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: JSON_RPC_ID,
        method: 'tools/call',
        params: { name: operation, arguments: normalized.args },
      }),
    });
  } catch (error) {
    return withConnector(baseResult(operation), 'shopify_error', 'not_connected', [redactSensitiveText(`Shopify Checkout MCP network error: ${errorMessage(error)}`)], endpoint.url.hostname);
  }

  if (!response.ok) {
    return withConnector(baseResult(operation), 'shopify_error', 'not_connected', [`Shopify Checkout MCP failed with HTTP ${response.status}.`], endpoint.url.hostname);
  }

  const body = await readJson<ShopifyCheckoutMcpResponse>(response, 'Shopify Checkout MCP');
  if ('error' in body) return withConnector(baseResult(operation), 'shopify_error', 'not_connected', [body.error], endpoint.url.hostname);

  if (body.data.error) {
    return withConnector(baseResult(operation), 'shopify_error', 'not_connected', [redactSensitiveText(body.data.error.message ?? 'Shopify Checkout MCP returned a JSON-RPC error.')], endpoint.url.hostname);
  }

  const checkout = body.data.result?.structuredContent?.checkout ? redactUnknown(body.data.result.structuredContent.checkout) : null;
  return {
    ...baseResult(operation),
    configured: true,
    connector: {
      status: 'ok',
      source: 'shopify_checkout_mcp',
      endpointHost: endpoint.url.hostname,
      messages: checkout ? [] : ['Shopify Checkout MCP response did not include structuredContent.checkout.'],
    },
    checkout,
  };
}

function normalizeArgs(operation: CheckoutOperation, args: CheckoutArgs, agentProfile: string | undefined): { args: CheckoutArgs } | { error: string } {
  if (!isRecord(args)) return { error: 'Invalid params: arguments must be an object' };
  const meta = normalizeMeta(args.meta, agentProfile);
  if ('error' in meta) return meta;

  if (operation === 'create_checkout') {
    const checkout = normalizeCheckout(args.checkout);
    if ('error' in checkout) return checkout;
    return { args: { meta: meta.value, checkout: checkout.value } };
  }

  const id = requiredCheckoutId(args.id);
  if ('error' in id) return id;

  if (operation === 'get_checkout') return { args: { meta: meta.value, id: id.value } };

  if (operation === 'update_checkout') {
    const checkout = normalizeCheckout(args.checkout);
    if ('error' in checkout) return checkout;
    return { args: { meta: meta.value, id: id.value, checkout: checkout.value } };
  }

  if (operation === 'complete_checkout') {
    const idempotencyKey = readIdempotencyKey(meta.value);
    if (!idempotencyKey) {
      return { error: 'Invalid params: complete_checkout requires meta["idempotency-key"] for retry safety' };
    }
    const authentication = normalizeCompletionAuthentication(args.authentication);
    if ('error' in authentication) return authentication;
    return { args: { meta: meta.value, id: id.value, authentication: authentication.value } };
  }

  const idempotencyKey = readIdempotencyKey(meta.value);
  if (!idempotencyKey) {
    return { error: 'Invalid params: cancel_checkout requires meta["idempotency-key"] for retry safety' };
  }
  return { args: { meta: meta.value, id: id.value } };
}


function normalizeMeta(value: unknown, agentProfile: string | undefined): { value: Record<string, unknown> } | { error: string } {
  const meta = isRecord(value) ? { ...value } : {};
  const ucpAgent = isRecord(meta['ucp-agent']) ? { ...meta['ucp-agent'] } : {};
  const profile = typeof ucpAgent.profile === 'string' && isSafeHttpsUrl(ucpAgent.profile)
    ? ucpAgent.profile
    : safeAgentProfile(agentProfile);
  meta['ucp-agent'] = { ...ucpAgent, profile };
  return { value: meta };
}


type CompletionAuthentication = {
  method: 'shopify_checkout_authenticated';
  buyerVerified: true;
  paymentAuthorized: true;
  nameVerified: true;
  emailVerified: true;
  phoneVerified: true;
  addressVerified: true;
  cardAuthorized: true;
  authenticatedAt: string;
};

function normalizeCompletionAuthentication(value: unknown): { value: CompletionAuthentication } | { error: string } {
  if (!isRecord(value)) return { error: 'Invalid params: complete_checkout.authentication is required' };
  const method = value.method;
  if (method !== 'shopify_checkout_authenticated') {
    return { error: 'Invalid params: complete_checkout.authentication.method must be shopify_checkout_authenticated' };
  }
  const requiredBooleans = ['buyerVerified', 'paymentAuthorized', 'nameVerified', 'emailVerified', 'phoneVerified', 'addressVerified', 'cardAuthorized'] as const;
  for (const key of requiredBooleans) {
    if (value[key] !== true) return { error: `Invalid params: complete_checkout.authentication.${key} must be true` };
  }
  const authenticatedAt = value.authenticatedAt;
  if (typeof authenticatedAt !== 'string' || Number.isNaN(Date.parse(authenticatedAt))) {
    return { error: 'Invalid params: complete_checkout.authentication.authenticatedAt must be an ISO timestamp' };
  }
  const allowedKeys = new Set<string>(['method', ...requiredBooleans, 'authenticatedAt']);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) return { error: 'Invalid params: complete_checkout.authentication only accepts Shopify verification flags, not payment or buyer data' };
  }
  return {
    value: {
      method,
      buyerVerified: true,
      paymentAuthorized: true,
      nameVerified: true,
      emailVerified: true,
      phoneVerified: true,
      addressVerified: true,
      cardAuthorized: true,
      authenticatedAt,
    },
  };
}

function normalizeCheckout(value: unknown): { value: NormalizedCheckout } | { error: string } {
  if (!isRecord(value)) return { error: 'Invalid params: checkout is required' };
  if ('buyer' in value || 'customer' in value || 'email' in value || 'phone' in value || 'payment' in value || 'shipping_address' in value || 'billing_address' in value) {
    return { error: 'Invalid params: buyer/customer/payment/address fields are not enabled for Commonlands Checkout MCP' };
  }
  if ('discount' in value || 'discounts' in value || 'discount_codes' in value || 'gift_card' in value || 'gift_cards' in value) {
    return { error: 'Invalid params: discount and gift-card fields are not enabled for Commonlands Checkout MCP' };
  }

  const checkout: NormalizedCheckout = {};
  const cartId = value.cart_id;
  if (cartId !== undefined) {
    const normalizedCartId = requiredCartId(cartId);
    if ('error' in normalizedCartId) return normalizedCartId;
    checkout.cart_id = normalizedCartId.value;
  }

  if (value.line_items !== undefined) {
    const lineItems = normalizeLineItems(value.line_items);
    if ('error' in lineItems) return lineItems;
    checkout.line_items = lineItems.value;
  }

  if (!checkout.cart_id && !checkout.line_items) {
    return { error: 'Invalid params: checkout.cart_id or checkout.line_items is required' };
  }

  const context = normalizeContext(value.context);
  if ('error' in context) return context;
  if (context.value) checkout.context = context.value;
  return { value: checkout };
}

function normalizeLineItems(value: unknown): { value: NormalizedLineItem[] } | { error: string } {
  if (!Array.isArray(value) || value.length < 1 || value.length > 25) {
    return { error: 'Invalid params: checkout.line_items must include 1-25 items' };
  }
  const normalizedItems: NormalizedLineItem[] = [];
  for (const [index, lineItem] of value.entries()) {
    const normalized = normalizeLineItem(lineItem, index);
    if ('error' in normalized) return normalized;
    normalizedItems.push(normalized.value);
  }
  return { value: normalizedItems };
}

function normalizeLineItem(value: unknown, index: number): { value: NormalizedLineItem } | { error: string } {
  if (!isRecord(value)) return { error: `Invalid params: checkout.line_items[${index}] must be an object` };
  const quantity = value.quantity;
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 1 || quantity > 999) {
    return { error: `Invalid params: checkout.line_items[${index}].quantity must be between 1 and 999` };
  }
  const item = value.item;
  if (!isRecord(item) || typeof item.id !== 'string' || !/^gid:\/\/shopify\/ProductVariant\/[0-9]+$/.test(item.id)) {
    return { error: `Invalid params: checkout.line_items[${index}].item.id must be a Shopify ProductVariant gid` };
  }
  return { value: { quantity: Math.trunc(quantity), item: { id: item.id } } };
}

function normalizeContext(value: unknown): { value?: Record<string, string> } | { error: string } {
  if (value === undefined) return {};
  if (!isRecord(value)) return { error: 'Invalid params: checkout.context must be an object when provided' };
  const allowed = ['address_country', 'address_region', 'postal_code'] as const;
  const context: Record<string, string> = {};
  for (const key of allowed) {
    const raw = value[key];
    if (raw === undefined) continue;
    if (typeof raw !== 'string' || raw.trim() === '' || raw.length > 40) {
      return { error: `Invalid params: checkout.context.${key} must be a short string when provided` };
    }
    context[key] = raw.trim();
  }
  return Object.keys(context).length > 0 ? { value: context } : {};
}

function requiredCartId(value: unknown): { value: string } | { error: string } {
  if (typeof value !== 'string' || value.trim() === '') return { error: 'Invalid params: checkout.cart_id is required' };
  const trimmed = value.trim();
  if (!/^gid:\/\/shopify\/Cart\/[A-Za-z0-9_?=&:-]+$/.test(trimmed)) {
    return { error: 'Invalid params: checkout.cart_id must be a Shopify Cart gid' };
  }
  return { value: trimmed };
}

function requiredCheckoutId(value: unknown): { value: string } | { error: string } {
  if (typeof value !== 'string' || value.trim() === '') return { error: 'Invalid params: id is required' };
  const trimmed = value.trim();
  if (!/^gid:\/\/shopify\/Checkout\/[A-Za-z0-9_?=&:-]+$/.test(trimmed)) {
    return { error: 'Invalid params: id must be a Shopify Checkout gid' };
  }
  return { value: trimmed };
}

function readIdempotencyKey(meta: Record<string, unknown>): string | undefined {
  const value = meta['idempotency-key'];
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
}

function parseEndpoint(value: string | undefined): { url: URL } | { error: string } {
  if (!value || value.trim() === '') {
    return { error: 'Add SHOPIFY_CHECKOUT_MCP_ENDPOINT as the Shopify Checkout MCP JSON-RPC endpoint, for example https://commonlands.com/api/checkout/mcp or https://commonlands.com/api/ucp/mcp.' };
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return { error: 'SHOPIFY_CHECKOUT_MCP_ENDPOINT must be an HTTPS URL.' };
    if (!url.pathname.endsWith('/api/checkout/mcp') && !url.pathname.endsWith('/api/ucp/mcp')) {
      return { error: 'SHOPIFY_CHECKOUT_MCP_ENDPOINT must point to /api/checkout/mcp or /api/ucp/mcp.' };
    }
    if (url.hostname !== 'commonlands.com') return { error: 'SHOPIFY_CHECKOUT_MCP_ENDPOINT must be hosted on commonlands.com.' };
    return { url };
  } catch {
    return { error: 'SHOPIFY_CHECKOUT_MCP_ENDPOINT must be a valid HTTPS URL.' };
  }
}

function baseResult(operation: CheckoutOperation): ShopifyCheckoutMcpResult {
  return {
    schemaVersion: 'commonlands.checkout_mcp.v1',
    mode: 'shopify_checkout_mcp_proxy',
    generatedAt: new Date().toISOString(),
    configured: false,
    operation,
    ucp: { version: UCP_VERSION, capability: 'dev.ucp.shopping.checkout', transport: 'mcp' },
    persistence: {
      storedIn: 'shopify_checkout_mcp',
      mutatedBy: 'shopify_checkout_mcp_tools',
      commonlandsWorkerState: 'stateless_proxy_no_checkout_storage',
      resumeAcrossAgentSessions: 'caller_must_retain_checkout_id_or_checkout_url',
      expiryAuthority: 'shopify_checkout_ttl_expires_at',
    },
    connector: { status: 'not_configured', source: 'not_connected', messages: [] },
    checkout: null,
    safety: {
      createsCheckout: operation === 'create_checkout',
      updatesCheckout: operation === 'update_checkout',
      cancelsCheckout: operation === 'cancel_checkout',
      completesCheckout: operation === 'complete_checkout',
      createsOrder: operation === 'complete_checkout',
      capturesPayment: operation === 'complete_checkout',
      readsCustomers: false,
      createsCustomer: false,
      mutatesInventory: false,
      touchesInventorySync: false,
      writesCatalog: false,
      exposesSecrets: false,
    },
  };
}

function withConnector(
  result: ShopifyCheckoutMcpResult,
  status: ShopifyCheckoutMcpResult['connector']['status'],
  source: ShopifyCheckoutMcpResult['connector']['source'],
  messages: string[],
  endpointHost?: string,
): ShopifyCheckoutMcpResult {
  return {
    ...result,
    configured: status !== 'not_configured' && status !== 'invalid_request',
    connector: {
      status,
      source,
      ...(endpointHost ? { endpointHost } : {}),
      messages: messages.map(redactSensitiveText),
    },
  };
}

function safeAgentProfile(value: string | undefined): string {
  return value && isSafeHttpsUrl(value) ? value : DEFAULT_AGENT_PROFILE;
}

function isSafeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

interface ShopifyCheckoutMcpResponse {
  result?: {
    structuredContent?: {
      checkout?: unknown;
    };
  };
  error?: {
    code?: number;
    message?: string;
  };
}

async function readJson<T>(response: Response, context: string): Promise<{ data: T } | { error: string }> {
  try {
    return await readJsonWithLimit<T>(response, context);
  } catch (error) {
    return { error: `${context} returned invalid JSON: ${errorMessage(error)}` };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}


function redactUnknown(value: unknown): unknown {
  if (typeof value === 'string') return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(redactUnknown);
  if (!isRecord(value)) return value;
  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (/token|secret|authorization|password|credential/i.test(key)) {
      continue;
    } else {
      redacted[key] = redactUnknown(nestedValue);
    }
  }
  return redacted;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/shpat_[a-zA-Z0-9_-]+/g, '[redacted]')
    .replace(/shpss_[a-zA-Z0-9_-]+/g, '[redacted]')
    .replace(/access[_-]?token\s*[:=]\s*[^\s,}]+/gi, 'access_token=[redacted]')
    .replace(/authorization\s*[:=]\s*[^\s,}]+/gi, 'authorization=[redacted]')
    .replace(/bearer\s+[a-zA-Z0-9._-]+/gi, 'bearer [redacted]');
}
