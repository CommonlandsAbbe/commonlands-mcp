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

type NormalizedCartLineUpdate = {
  id: string;
  quantity: number;
};

type NormalizedCart = {
  line_items?: NormalizedLineItem[];
  update_items?: NormalizedCartLineUpdate[];
  remove_line_ids?: string[];
  context?: Record<string, string>;
  signals?: Record<string, unknown>;
};

const DEFAULT_AGENT_PROFILE = 'https://commonlands-mcp.erp-14c.workers.dev/.well-known/ucp';
const JSON_RPC_ID = 'commonlands-cart-ucp';
const COMMONLANDS_SHOPIFY_HOSTS = new Set(['commonlands.com', 'commonlands-camera-components.myshopify.com']);
const SHOPIFY_STOREFRONT_MCP_PATH = '/api/mcp';
const SHOPIFY_UCP_MCP_PATH = '/api/ucp/mcp';

export async function callShopifyCartUcp(
  env: ShopifyCartUcpEnv,
  operation: CartOperation,
  args: CartArgs,
): Promise<ShopifyCartUcpResult> {
  const endpoint = parseEndpoint(env.SHOPIFY_CART_MCP_ENDPOINT);
  if ('error' in endpoint) return withConnector(baseResult(operation), 'not_configured', 'not_connected', [endpoint.error]);

  const normalized = normalizeArgs(endpoint.kind, operation, args, env.SHOPIFY_UCP_AGENT_PROFILE);
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
        params: { name: upstreamOperation(endpoint.kind, operation), arguments: upstreamArgs(endpoint.kind, operation, normalized.args) },
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

  const cart = extractCart(body.data.result);
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

function upstreamOperation(kind: EndpointKind, operation: CartOperation): string {
  if (kind === 'shopify_storefront_mcp' && operation === 'create_cart') return 'update_cart';
  return operation;
}

function upstreamArgs(kind: EndpointKind, operation: CartOperation, args: CartArgs): CartArgs {
  if (kind !== 'shopify_storefront_mcp') return args;
  if (operation === 'get_cart') return { cart_id: args.id };
  if (operation === 'create_cart') return storefrontUpdateArgs(undefined, args.cart);
  if (operation === 'update_cart') return storefrontUpdateArgs(args.id, args.cart);
  return args;
}

function storefrontUpdateArgs(cartId: unknown, cart: unknown): CartArgs {
  const normalizedCart = isRecord(cart) ? cart : {};
  const lineItems = Array.isArray(normalizedCart.line_items) ? normalizedCart.line_items : [];
  const addItems = lineItems
    .filter(isRecord)
    .map((lineItem) => ({
      product_variant_id: isRecord(lineItem.item) ? lineItem.item.id : undefined,
      quantity: lineItem.quantity,
    }));
  return {
    ...(typeof cartId === 'string' ? { cart_id: cartId } : {}),
    ...(addItems.length > 0 ? { add_items: addItems } : {}),
    ...(Array.isArray(normalizedCart.update_items) && normalizedCart.update_items.length > 0 ? { update_items: normalizedCart.update_items } : {}),
    ...(Array.isArray(normalizedCart.remove_line_ids) && normalizedCart.remove_line_ids.length > 0 ? { remove_line_ids: normalizedCart.remove_line_ids } : {}),
  };
}

function normalizeArgs(kind: EndpointKind, operation: CartOperation, args: CartArgs, agentProfile: string | undefined): { args: CartArgs } | { error: string } {
  if (!isRecord(args)) return { error: 'Invalid params: arguments must be an object' };
  const meta = normalizeMeta(args.meta, agentProfile);
  if ('error' in meta) return meta;
  if (kind === 'shopify_storefront_mcp' && operation === 'cancel_cart') {
    return { error: 'Invalid params: cancel_cart requires the Shopify UCP endpoint; the live standard Storefront MCP endpoint exposes get_cart and update_cart only' };
  }

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
  if ('buyer' in value || 'buyer_identity' in value) return { error: 'Invalid params: buyer/customer fields are not enabled for Commonlands Cart MCP' };

  const cart: NormalizedCart = {};
  const lineItems = value.line_items;
  if (lineItems !== undefined) {
    if (!Array.isArray(lineItems) || lineItems.length < 1 || lineItems.length > 25) {
      return { error: 'Invalid params: cart.line_items must include 1-25 items when provided' };
    }
    const normalizedItems: NormalizedLineItem[] = [];
    for (const [index, lineItem] of lineItems.entries()) {
      const normalized = normalizeLineItem(lineItem, index);
      if ('error' in normalized) return normalized;
      normalizedItems.push(normalized.value);
    }
    cart.line_items = normalizedItems;
  }

  const updateItems = normalizeCartLineUpdates(value.update_items);
  if ('error' in updateItems) return updateItems;
  if (updateItems.value) cart.update_items = updateItems.value;

  const removeLineIds = normalizeRemoveLineIds(value.remove_line_ids);
  if ('error' in removeLineIds) return removeLineIds;
  if (removeLineIds.value) cart.remove_line_ids = removeLineIds.value;

  if (!cart.line_items && !cart.update_items && !cart.remove_line_ids) {
    return { error: 'Invalid params: cart must include line_items, update_items, or remove_line_ids' };
  }

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

function normalizeCartLineUpdates(value: unknown): { value?: NormalizedCartLineUpdate[] } | { error: string } {
  if (value === undefined) return {};
  if (!Array.isArray(value) || value.length < 1 || value.length > 25) {
    return { error: 'Invalid params: cart.update_items must include 1-25 items when provided' };
  }
  const normalized: NormalizedCartLineUpdate[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) return { error: `Invalid params: cart.update_items[${index}] must be an object` };
    const id = normalizeCartLineId(item.id, `cart.update_items[${index}].id`);
    if ('error' in id) return id;
    const quantity = item.quantity;
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0 || quantity > 999) {
      return { error: `Invalid params: cart.update_items[${index}].quantity must be between 0 and 999` };
    }
    normalized.push({ id: id.value, quantity: Math.trunc(quantity) });
  }
  return { value: normalized };
}

function normalizeRemoveLineIds(value: unknown): { value?: string[] } | { error: string } {
  if (value === undefined) return {};
  if (!Array.isArray(value) || value.length < 1 || value.length > 25) {
    return { error: 'Invalid params: cart.remove_line_ids must include 1-25 ids when provided' };
  }
  const normalized: string[] = [];
  for (const [index, id] of value.entries()) {
    const lineId = normalizeCartLineId(id, `cart.remove_line_ids[${index}]`);
    if ('error' in lineId) return lineId;
    normalized.push(lineId.value);
  }
  return { value: normalized };
}

function normalizeCartLineId(value: unknown, field: string): { value: string } | { error: string } {
  if (typeof value !== 'string' || value.trim() === '') return { error: `Invalid params: ${field} is required` };
  const trimmed = value.trim();
  if (!/^gid:\/\/shopify\/CartLine\/[A-Za-z0-9_?=&:-]+$/.test(trimmed)) {
    return { error: `Invalid params: ${field} must be a Shopify CartLine gid` };
  }
  return { value: trimmed };
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

type EndpointKind = 'shopify_storefront_mcp' | 'shopify_ucp_mcp';

function parseEndpoint(value: string | undefined): { url: URL; kind: EndpointKind } | { error: string } {
  if (!value || value.trim() === '') {
    return { error: 'Add SHOPIFY_CART_MCP_ENDPOINT as the Shopify Cart MCP JSON-RPC endpoint, for example https://commonlands.com/api/mcp.' };
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return { error: 'SHOPIFY_CART_MCP_ENDPOINT must be an HTTPS URL.' };
    if (url.pathname !== SHOPIFY_STOREFRONT_MCP_PATH && url.pathname !== SHOPIFY_UCP_MCP_PATH) {
      return { error: 'SHOPIFY_CART_MCP_ENDPOINT must point to /api/mcp or /api/ucp/mcp.' };
    }
    if (!COMMONLANDS_SHOPIFY_HOSTS.has(url.hostname)) {
      return { error: 'SHOPIFY_CART_MCP_ENDPOINT must be hosted on commonlands.com or commonlands-camera-components.myshopify.com.' };
    }
    return { url, kind: url.pathname === SHOPIFY_STOREFRONT_MCP_PATH ? 'shopify_storefront_mcp' : 'shopify_ucp_mcp' };
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
    content?: Array<{ type?: string; text?: string }>;
  };
  error?: {
    code?: number;
    message?: string;
  };
}

function extractCart(result: ShopifyCartMcpResponse['result']): unknown | null {
  if (result?.structuredContent && 'cart' in result.structuredContent) return result.structuredContent.cart ?? null;
  const text = result?.content?.find((item) => item.type === 'text' && typeof item.text === 'string')?.text;
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed) && 'cart' in parsed) return parsed.cart ?? null;
    return parsed;
  } catch {
    return null;
  }
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
