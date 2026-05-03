import { fetchWithTimeout, readJsonWithLimit } from './http-safety';
import { UCP_VERSION } from './ucp-catalog';

export interface ShopifyCartUcpEnv {
  SHOPIFY_CART_MCP_ENDPOINT?: string;
  SHOPIFY_UCP_AGENT_PROFILE?: string;
}

export type CartOperation = 'create_cart' | 'get_cart' | 'update_cart' | 'cancel_cart';

export interface ShopifyCartUcpResult {
  schemaVersion: 'commonlands.cart_ucp.v1';
  mode: 'shopify_cart_mcp_proxy';
  generatedAt: string;
  configured: boolean;
  operation: CartOperation;
  ucp: {
    version: typeof UCP_VERSION;
    capability: 'dev.ucp.shopping.cart';
    transport: 'mcp';
  };
  persistence: {
    storedIn: 'shopify_cart_mcp';
    mutatedBy: 'shopify_cart_mcp_tools';
    commonlandsWorkerState: 'stateless_proxy_no_cart_storage';
    resumeAcrossAgentSessions: 'caller_must_retain_cart_id_or_continue_url';
    expiryAuthority: 'shopify_cart_ttl_expires_at';
  };
  connector: {
    status: 'ok' | 'not_configured' | 'shopify_error' | 'invalid_request';
    source: 'shopify_cart_mcp' | 'not_connected';
    endpointHost?: string;
    messages: string[];
  };
  cart: unknown | null;
  safety: {
    createsCart: boolean;
    updatesCart: boolean;
    cancelsCart: boolean;
    createsCheckout: false;
    completesCheckout: false;
    createsOrder: false;
    readsCustomers: false;
    createsCustomer: false;
    mutatesInventory: false;
    touchesInventorySync: false;
    writesCatalog: false;
    exposesSecrets: false;
  };
}

type CartArgs = Record<string, unknown>;

type NormalizedLineItem = {
  quantity: number;
  item: { id: string };
};

type NormalizedCart = {
  line_items: NormalizedLineItem[];
  context?: Record<string, string>;
  signals?: Record<string, unknown>;
};

const DEFAULT_AGENT_PROFILE = 'https://commonlands-mcp.erp-14c.workers.dev/.well-known/ucp';
const JSON_RPC_ID = 'commonlands-cart-ucp';

export async function callShopifyCartUcp(
  env: ShopifyCartUcpEnv,
  operation: CartOperation,
  args: CartArgs,
): Promise<ShopifyCartUcpResult> {
  const endpoint = parseEndpoint(env.SHOPIFY_CART_MCP_ENDPOINT);
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
    return withConnector(baseResult(operation), 'shopify_error', 'not_connected', [redactSensitiveText(`Shopify Cart MCP network error: ${errorMessage(error)}`)], endpoint.url.hostname);
  }

  if (!response.ok) {
    return withConnector(baseResult(operation), 'shopify_error', 'not_connected', [`Shopify Cart MCP failed with HTTP ${response.status}.`], endpoint.url.hostname);
  }

  const body = await readJson<ShopifyCartMcpResponse>(response, 'Shopify Cart MCP');
  if ('error' in body) return withConnector(baseResult(operation), 'shopify_error', 'not_connected', [body.error], endpoint.url.hostname);

  if (body.data.error) {
    return withConnector(baseResult(operation), 'shopify_error', 'not_connected', [redactSensitiveText(body.data.error.message ?? 'Shopify Cart MCP returned a JSON-RPC error.')], endpoint.url.hostname);
  }

  const cart = body.data.result?.structuredContent?.cart ?? null;
  return {
    ...baseResult(operation),
    configured: true,
    connector: {
      status: 'ok',
      source: 'shopify_cart_mcp',
      endpointHost: endpoint.url.hostname,
      messages: cart ? [] : ['Shopify Cart MCP response did not include structuredContent.cart.'],
    },
    cart,
  };
}

function normalizeArgs(operation: CartOperation, args: CartArgs, agentProfile: string | undefined): { args: CartArgs } | { error: string } {
  if (!isRecord(args)) return { error: 'Invalid params: arguments must be an object' };
  const meta = normalizeMeta(args.meta, agentProfile);
  if ('error' in meta) return meta;

  if (operation === 'create_cart') {
    const cart = normalizeCart(args.cart);
    if ('error' in cart) return cart;
    return { args: { meta: meta.value, cart: cart.value } };
  }

  const id = requiredCartId(args.id);
  if ('error' in id) return id;

  if (operation === 'get_cart') return { args: { meta: meta.value, id: id.value } };

  if (operation === 'update_cart') {
    const cart = normalizeCart(args.cart);
    if ('error' in cart) return cart;
    return { args: { meta: meta.value, id: id.value, cart: cart.value } };
  }

  const idempotencyKey = readIdempotencyKey(meta.value);
  if (!idempotencyKey) {
    return { error: 'Invalid params: cancel_cart requires meta["idempotency-key"] for retry safety' };
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

function normalizeCart(value: unknown): { value: NormalizedCart } | { error: string } {
  if (!isRecord(value)) return { error: 'Invalid params: cart is required' };
  if ('buyer' in value) return { error: 'Invalid params: buyer/customer fields are not enabled for Commonlands Cart UCP' };

  const lineItems = value.line_items;
  if (!Array.isArray(lineItems) || lineItems.length < 1 || lineItems.length > 25) {
    return { error: 'Invalid params: cart.line_items must include 1-25 items' };
  }

  const normalizedItems: NormalizedLineItem[] = [];
  for (const [index, lineItem] of lineItems.entries()) {
    const normalized = normalizeLineItem(lineItem, index);
    if ('error' in normalized) return normalized;
    normalizedItems.push(normalized.value);
  }

  const cart: NormalizedCart = { line_items: normalizedItems };
  const context = normalizeContext(value.context);
  if ('error' in context) return context;
  if (context.value) cart.context = context.value;
  if (isRecord(value.signals)) cart.signals = value.signals;
  return { value: cart };
}

function normalizeLineItem(value: unknown, index: number): { value: NormalizedLineItem } | { error: string } {
  if (!isRecord(value)) return { error: `Invalid params: cart.line_items[${index}] must be an object` };
  const quantity = value.quantity;
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 1 || quantity > 999) {
    return { error: `Invalid params: cart.line_items[${index}].quantity must be between 1 and 999` };
  }
  const item = value.item;
  if (!isRecord(item) || typeof item.id !== 'string' || !/^gid:\/\/shopify\/ProductVariant\/[0-9]+$/.test(item.id)) {
    return { error: `Invalid params: cart.line_items[${index}].item.id must be a Shopify ProductVariant gid` };
  }
  return { value: { quantity: Math.trunc(quantity), item: { id: item.id } } };
}

function normalizeContext(value: unknown): { value?: Record<string, string> } | { error: string } {
  if (value === undefined) return {};
  if (!isRecord(value)) return { error: 'Invalid params: cart.context must be an object when provided' };
  const allowed = ['address_country', 'address_region', 'postal_code'] as const;
  const context: Record<string, string> = {};
  for (const key of allowed) {
    const raw = value[key];
    if (raw === undefined) continue;
    if (typeof raw !== 'string' || raw.trim() === '' || raw.length > 40) {
      return { error: `Invalid params: cart.context.${key} must be a short string when provided` };
    }
    context[key] = raw.trim();
  }
  return Object.keys(context).length > 0 ? { value: context } : {};
}

function requiredCartId(value: unknown): { value: string } | { error: string } {
  if (typeof value !== 'string' || value.trim() === '') return { error: 'Invalid params: id is required' };
  const trimmed = value.trim();
  if (!/^gid:\/\/shopify\/Cart\/[A-Za-z0-9_?=&:-]+$/.test(trimmed)) {
    return { error: 'Invalid params: id must be a Shopify Cart gid' };
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
    return { error: 'Add SHOPIFY_CART_MCP_ENDPOINT as the Shopify Cart MCP JSON-RPC endpoint, for example https://commonlands.com/api/ucp/mcp.' };
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return { error: 'SHOPIFY_CART_MCP_ENDPOINT must be an HTTPS URL.' };
    if (!url.pathname.endsWith('/api/ucp/mcp')) return { error: 'SHOPIFY_CART_MCP_ENDPOINT must point to /api/ucp/mcp.' };
    if (url.hostname !== 'commonlands.com') return { error: 'SHOPIFY_CART_MCP_ENDPOINT must be hosted on commonlands.com.' };
    return { url };
  } catch {
    return { error: 'SHOPIFY_CART_MCP_ENDPOINT must be a valid HTTPS URL.' };
  }
}

function baseResult(operation: CartOperation): ShopifyCartUcpResult {
  return {
    schemaVersion: 'commonlands.cart_ucp.v1',
    mode: 'shopify_cart_mcp_proxy',
    generatedAt: new Date().toISOString(),
    configured: false,
    operation,
    ucp: { version: UCP_VERSION, capability: 'dev.ucp.shopping.cart', transport: 'mcp' },
    persistence: {
      storedIn: 'shopify_cart_mcp',
      mutatedBy: 'shopify_cart_mcp_tools',
      commonlandsWorkerState: 'stateless_proxy_no_cart_storage',
      resumeAcrossAgentSessions: 'caller_must_retain_cart_id_or_continue_url',
      expiryAuthority: 'shopify_cart_ttl_expires_at',
    },
    connector: { status: 'not_configured', source: 'not_connected', messages: [] },
    cart: null,
    safety: {
      createsCart: operation === 'create_cart',
      updatesCart: operation === 'update_cart',
      cancelsCart: operation === 'cancel_cart',
      createsCheckout: false,
      completesCheckout: false,
      createsOrder: false,
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
  result: ShopifyCartUcpResult,
  status: ShopifyCartUcpResult['connector']['status'],
  source: ShopifyCartUcpResult['connector']['source'],
  messages: string[],
  endpointHost?: string,
): ShopifyCartUcpResult {
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

interface ShopifyCartMcpResponse {
  result?: {
    structuredContent?: {
      cart?: unknown;
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

function redactSensitiveText(value: string): string {
  return value
    .replace(/shpat_[a-zA-Z0-9_-]+/g, '[redacted]')
    .replace(/shpss_[a-zA-Z0-9_-]+/g, '[redacted]')
    .replace(/access[_-]?token\s*[:=]\s*[^\s,}]+/gi, 'access_token=[redacted]')
    .replace(/authorization\s*[:=]\s*[^\s,}]+/gi, 'authorization=[redacted]')
    .replace(/bearer\s+[a-zA-Z0-9._-]+/gi, 'bearer [redacted]');
}
