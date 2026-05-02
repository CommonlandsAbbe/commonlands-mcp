import { getShopifyReadonlyStatus, normalizeShopDomain, parseScopes, type ShopifyReadonlyEnv } from './shopify-readonly-status';

export interface ShopifyReadAdapterEnv extends ShopifyReadonlyEnv {
  SHOPIFY_ADMIN_API_VERSION?: string;
}

export interface ShopifyProductReadArgs {
  sku?: unknown;
  handle?: unknown;
  query?: unknown;
  limit?: unknown;
  includeMetafields?: unknown;
}

export interface ShopifyMetaobjectReadArgs {
  type?: unknown;
  handle?: unknown;
  limit?: unknown;
}

export interface ShopifyLiveReadResult {
  schemaVersion: 'shopify.live_read.v1';
  mode: 'shopify_admin_graphql_read_only';
  generatedAt: string;
  configured: boolean;
  query: {
    kind: 'product_variants' | 'metaobjects';
    sku?: string;
    handle?: string;
    search?: string;
    type?: string;
    limit: number;
  };
  shopify: {
    shopDomainFormat: 'myshopify_domain' | 'shop_subdomain' | 'invalid_or_missing';
    apiVersion: string;
    token: 'exchanged_and_redacted' | 'not_requested' | 'unavailable';
  };
  connector: {
    status: 'ok' | 'not_configured' | 'shopify_error' | 'invalid_request';
    source: 'live_shopify_admin_graphql' | 'not_connected';
    messages: string[];
  };
  products: ShopifyReadonlyProduct[];
  metaobjects: ShopifyReadonlyMetaobject[];
  safety: {
    readOnly: true;
    writesShopify: false;
    createsCart: false;
    createsCheckout: false;
    readsCustomers: false;
    readsOrders: false;
    mutatesInventory: false;
    touchesInventorySync: false;
    exposesSecrets: false;
  };
}

export interface ShopifyReadonlyProduct {
  productId: string;
  handle: string;
  title: string;
  status?: string;
  productType?: string;
  vendor?: string;
  tags: string[];
  productUrl?: string;
  variants: ShopifyReadonlyVariant[];
  metafields: ShopifyReadonlyMetafield[];
  media: ShopifyReadonlyMedia[];
}

export interface ShopifyReadonlyVariant {
  variantId: string;
  sku: string;
  title: string;
  price?: string;
  inventoryQuantity?: number;
  inventoryTracked?: boolean;
  inventoryItemId?: string;
  metafields: ShopifyReadonlyMetafield[];
}

export interface ShopifyReadonlyMetafield {
  namespace: string;
  key: string;
  type: string;
  valuePreview?: string;
  reference?: {
    kind: 'file' | 'image' | 'metaobject' | 'other';
    url?: string;
    altText?: string;
    type?: string;
    handle?: string;
  };
}

export interface ShopifyReadonlyMedia {
  kind: string;
  altText?: string;
  previewImageUrl?: string;
}

export interface ShopifyReadonlyMetaobject {
  id: string;
  type: string;
  handle?: string;
  fields: Array<{ key: string; type?: string; valuePreview?: string }>;
}

interface TokenCacheEntry {
  token: string;
  expiresAtMs: number;
}

interface TokenResponse {
  access_token?: unknown;
  scope?: unknown;
  expires_in?: unknown;
}

interface GraphQlResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface ProductVariantsGraphQlData {
  productVariants?: {
    nodes?: ProductVariantNode[];
  };
}

interface ProductByHandleGraphQlData {
  productByHandle?: ProductNode | null;
}

interface MetaobjectsGraphQlData {
  metaobjects?: {
    nodes?: MetaobjectNode[];
  };
}

interface ProductVariantNode {
  id?: unknown;
  sku?: unknown;
  title?: unknown;
  price?: unknown;
  inventoryQuantity?: unknown;
  inventoryItem?: { id?: unknown; tracked?: unknown } | null;
  metafields?: { nodes?: MetafieldNode[] };
  product?: ProductNode | null;
}

interface ProductNode {
  id?: unknown;
  handle?: unknown;
  title?: unknown;
  status?: unknown;
  productType?: unknown;
  vendor?: unknown;
  tags?: unknown;
  onlineStoreUrl?: unknown;
  metafields?: { nodes?: MetafieldNode[] };
  media?: { nodes?: MediaNode[] };
  variants?: { nodes?: ProductVariantNode[] };
}

interface MetafieldNode {
  namespace?: unknown;
  key?: unknown;
  type?: unknown;
  value?: unknown;
  reference?: MetafieldReference | null;
}

interface MetafieldReference {
  __typename?: unknown;
  url?: unknown;
  image?: { url?: unknown; altText?: unknown } | null;
  type?: unknown;
  handle?: unknown;
}

interface MediaNode {
  mediaContentType?: unknown;
  alt?: unknown;
  preview?: { image?: { url?: unknown; altText?: unknown } | null } | null;
}

interface MetaobjectNode {
  id?: unknown;
  type?: unknown;
  handle?: unknown;
  fields?: Array<{ key?: unknown; type?: unknown; value?: unknown }>;
}

const DEFAULT_ADMIN_API_VERSION = '2026-04';
const TOKEN_SAFETY_WINDOW_MS = 60_000;
const tokenCache = new Map<string, TokenCacheEntry>();

export async function readShopifyProducts(env: ShopifyReadAdapterEnv, args: ShopifyProductReadArgs): Promise<ShopifyLiveReadResult> {
  const parsed = parseProductArgs(args);
  if ('error' in parsed) return invalidRequestResult('product_variants', parsed.error, { limit: 1 });

  const base = baseResult(env, {
    kind: 'product_variants',
    limit: parsed.limit,
    ...(parsed.sku ? { sku: parsed.sku } : {}),
    ...(parsed.handle ? { handle: parsed.handle } : {}),
    ...(parsed.query ? { search: parsed.query } : {}),
  });

  const client = await buildClient(env);
  if ('error' in client) return withConnectorError(base, client.error.status, client.error.message, client.error.tokenState);

  const productsResponse = await readProductNodes(client, parsed);
  if ('error' in productsResponse) return withConnectorError(base, 'shopify_error', productsResponse.error, 'unavailable');

  const products = productsResponse.products;

  return {
    ...base,
    connector: { status: 'ok', source: 'live_shopify_admin_graphql', messages: [] },
    shopify: { ...base.shopify, token: 'exchanged_and_redacted' },
    products,
  };
}

export async function readShopifyMetaobjects(env: ShopifyReadAdapterEnv, args: ShopifyMetaobjectReadArgs): Promise<ShopifyLiveReadResult> {
  const parsed = parseMetaobjectArgs(args);
  if ('error' in parsed) return invalidRequestResult('metaobjects', parsed.error, { limit: 1 });

  const base = baseResult(env, {
    kind: 'metaobjects',
    type: parsed.type,
    limit: parsed.limit,
    ...(parsed.handle ? { handle: parsed.handle } : {}),
  });

  const client = await buildClient(env);
  if ('error' in client) return withConnectorError(base, client.error.status, client.error.message, client.error.tokenState);

  const response = await shopifyGraphQl<MetaobjectsGraphQlData>(client, METAOBJECTS_QUERY, {
    type: parsed.type,
    first: parsed.limit,
  });
  if ('error' in response) return withConnectorError(base, 'shopify_error', response.error, 'unavailable');

  const metaobjects = normalizeMetaobjects(response.data.metaobjects?.nodes ?? [])
    .filter((metaobject) => !parsed.handle || metaobject.handle?.toLowerCase() === parsed.handle.toLowerCase());

  return {
    ...base,
    connector: { status: 'ok', source: 'live_shopify_admin_graphql', messages: [] },
    shopify: { ...base.shopify, token: 'exchanged_and_redacted' },
    metaobjects,
  };
}

function parseProductArgs(args: ShopifyProductReadArgs):
  | { sku?: string; handle?: string; query?: string; limit: number; includeMetafields: boolean }
  | { error: string } {
  const sku = optionalSearchValue(args.sku, 'sku');
  if ('error' in sku) return sku;
  const handle = optionalHandle(args.handle);
  if ('error' in handle) return handle;
  const query = optionalSearchValue(args.query, 'query');
  if ('error' in query) return query;
  const limit = parseLimit(args.limit, 10, 1, 25);
  if ('error' in limit) return limit;
  if (!sku.value && !handle.value && !query.value) return { error: 'Invalid params: sku, handle, or query is required' };
  return {
    ...(sku.value ? { sku: sku.value.toUpperCase() } : {}),
    ...(handle.value ? { handle: handle.value.toLowerCase() } : {}),
    ...(query.value ? { query: query.value } : {}),
    limit: limit.value,
    includeMetafields: args.includeMetafields !== false,
  };
}

function parseMetaobjectArgs(args: ShopifyMetaobjectReadArgs):
  | { type: string; handle?: string; limit: number }
  | { error: string } {
  const type = requiredIdentifier(args.type, 'type');
  if ('error' in type) return type;
  const handle = optionalHandle(args.handle);
  if ('error' in handle) return handle;
  const limit = parseLimit(args.limit, 10, 1, 25);
  if ('error' in limit) return limit;
  return {
    type: type.value,
    ...(handle.value ? { handle: handle.value } : {}),
    limit: limit.value,
  };
}

function requiredIdentifier(value: unknown, field: string): { value: string } | { error: string } {
  if (typeof value !== 'string' || value.trim() === '') return { error: `Invalid params: ${field} is required` };
  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(trimmed)) return { error: `Invalid params: ${field} must be a safe identifier` };
  return { value: trimmed };
}

function optionalSearchValue(value: unknown, field: string): { value?: string } | { error: string } {
  if (value === undefined) return {};
  if (typeof value !== 'string' || value.trim() === '') return { error: `Invalid params: ${field} must be a non-empty string when provided` };
  const trimmed = value.trim();
  if (trimmed.length > 120) return { error: `Invalid params: ${field} is too long` };
  if (/[^a-zA-Z0-9 _./:-]/.test(trimmed)) return { error: `Invalid params: ${field} contains unsupported characters` };
  return { value: trimmed };
}

function optionalHandle(value: unknown): { value?: string } | { error: string } {
  if (value === undefined) return {};
  if (typeof value !== 'string' || value.trim() === '') return { error: 'Invalid params: handle must be a non-empty string when provided' };
  const trimmed = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,120}$/.test(trimmed)) return { error: 'Invalid params: handle must be a safe Shopify handle' };
  return { value: trimmed };
}

function parseLimit(value: unknown, defaultValue: number, min: number, max: number): { value: number } | { error: string } {
  if (value === undefined) return { value: defaultValue };
  if (typeof value !== 'number' || !Number.isFinite(value)) return { error: `Invalid params: limit must be a number between ${min} and ${max}` };
  const limit = Math.trunc(value);
  if (limit < min || limit > max) return { error: `Invalid params: limit must be between ${min} and ${max}` };
  return { value: limit };
}

function buildProductVariantSearch(input: { sku?: string; query?: string }): string {
  const filters: string[] = [];
  if (input.sku) filters.push(`sku:${escapeShopifySearchValue(input.sku)}`);
  if (input.query) filters.push(escapeShopifySearchValue(input.query));
  return filters.join(' AND ');
}

function escapeShopifySearchValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function baseResult(env: ShopifyReadAdapterEnv, query: ShopifyLiveReadResult['query']): ShopifyLiveReadResult {
  const status = getShopifyReadonlyStatus(env);
  return {
    schemaVersion: 'shopify.live_read.v1',
    mode: 'shopify_admin_graphql_read_only',
    generatedAt: new Date().toISOString(),
    configured: status.configured,
    query,
    shopify: {
      shopDomainFormat: status.shopDomain.format,
      apiVersion: adminApiVersion(env),
      token: 'not_requested',
    },
    connector: {
      status: status.configured ? 'ok' : 'not_configured',
      source: 'not_connected',
      messages: status.configured ? [] : status.nextRequired,
    },
    products: [],
    metaobjects: [],
    safety: {
      readOnly: true,
      writesShopify: false,
      createsCart: false,
      createsCheckout: false,
      readsCustomers: false,
      readsOrders: false,
      mutatesInventory: false,
      touchesInventorySync: false,
      exposesSecrets: false,
    },
  };
}

function invalidRequestResult(kind: 'product_variants' | 'metaobjects', message: string, query: { limit: number }): ShopifyLiveReadResult {
  return {
    schemaVersion: 'shopify.live_read.v1',
    mode: 'shopify_admin_graphql_read_only',
    generatedAt: new Date().toISOString(),
    configured: false,
    query: { kind, limit: query.limit },
    shopify: { shopDomainFormat: 'invalid_or_missing', apiVersion: DEFAULT_ADMIN_API_VERSION, token: 'not_requested' },
    connector: { status: 'invalid_request', source: 'not_connected', messages: [message] },
    products: [],
    metaobjects: [],
    safety: {
      readOnly: true,
      writesShopify: false,
      createsCart: false,
      createsCheckout: false,
      readsCustomers: false,
      readsOrders: false,
      mutatesInventory: false,
      touchesInventorySync: false,
      exposesSecrets: false,
    },
  };
}

async function buildClient(env: ShopifyReadAdapterEnv): Promise<
  | { shopDomain: string; apiVersion: string; accessToken: string }
  | { error: { status: 'not_configured' | 'shopify_error'; message: string; tokenState: ShopifyLiveReadResult['shopify']['token'] } }
> {
  const status = getShopifyReadonlyStatus(env);
  const shopDomain = normalizeShopDomain(env.SHOPIFY_SHOP_DOMAIN);
  if (!status.configured || !shopDomain || !env.SHOPIFY_CLIENT_ID || !env.SHOPIFY_CLIENT_SECRET) {
    return { error: { status: 'not_configured', message: status.nextRequired.join(' '), tokenState: 'not_requested' } };
  }

  const scopes = parseScopes(env.SHOPIFY_SCOPES);
  if (!scopes.includes('read_products')) {
    return { error: { status: 'not_configured', message: 'Shopify read adapter requires read_products scope.', tokenState: 'not_requested' } };
  }

  const token = await getAccessToken({
    shopDomain,
    clientId: env.SHOPIFY_CLIENT_ID,
    clientSecret: env.SHOPIFY_CLIENT_SECRET,
  });
  if ('error' in token) return { error: { status: 'shopify_error', message: token.error, tokenState: 'unavailable' } };

  return { shopDomain, apiVersion: adminApiVersion(env), accessToken: token.token };
}

async function getAccessToken(input: { shopDomain: string; clientId: string; clientSecret: string }): Promise<{ token: string } | { error: string }> {
  const cacheKey = `${input.shopDomain}:${input.clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs > Date.now() + TOKEN_SAFETY_WINDOW_MS) {
    return { token: cached.token };
  }

  let response: Response;
  try {
    response = await fetch(`https://${input.shopDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: input.clientId,
        client_secret: input.clientSecret,
      }),
    });
  } catch (error) {
    return { error: `Shopify token exchange network error: ${errorMessage(error)}` };
  }

  if (!response.ok) {
    return { error: `Shopify token exchange failed with HTTP ${response.status}. Confirm app installation, shop domain, org, and read-only scopes.` };
  }

  const body = await readJson<TokenResponse>(response, 'Shopify token exchange');
  if ('error' in body) return body;
  if (typeof body.data.access_token !== 'string' || body.data.access_token.trim() === '') {
    return { error: 'Shopify token exchange did not return an access token.' };
  }

  const expiresInSeconds = typeof body.data.expires_in === 'number' && Number.isFinite(body.data.expires_in)
    ? Math.max(300, body.data.expires_in)
    : 86_400;
  tokenCache.set(cacheKey, {
    token: body.data.access_token,
    expiresAtMs: Date.now() + expiresInSeconds * 1000,
  });

  return { token: body.data.access_token };
}

async function readProductNodes(
  client: { shopDomain: string; apiVersion: string; accessToken: string },
  parsed: { sku?: string; handle?: string; query?: string; limit: number; includeMetafields: boolean },
): Promise<{ products: ShopifyReadonlyProduct[] } | { error: string }> {
  if (parsed.handle && !parsed.sku && !parsed.query) {
    const response = await shopifyGraphQl<ProductByHandleGraphQlData>(client, productByHandleQuery(parsed.includeMetafields), {
      handle: parsed.handle,
      first: parsed.limit,
    });
    if ('error' in response) return response;
    return { products: normalizeProductByHandle(response.data.productByHandle, parsed.includeMetafields) };
  }

  const response = await shopifyGraphQl<ProductVariantsGraphQlData>(client, productVariantsQuery(parsed.includeMetafields), {
    query: buildProductVariantSearch(parsed),
    first: parsed.limit,
  });
  if ('error' in response) return response;
  return { products: normalizeProducts(response.data.productVariants?.nodes ?? [], parsed.includeMetafields) };
}

async function shopifyGraphQl<T>(client: { shopDomain: string; apiVersion: string; accessToken: string }, query: string, variables: Record<string, unknown>): Promise<{ data: T } | { error: string }> {
  let response: Response;
  try {
    response = await fetch(`https://${client.shopDomain}/admin/api/${client.apiVersion}/graphql.json`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-shopify-access-token': client.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    return { error: `Shopify GraphQL read network error: ${errorMessage(error)}` };
  }

  if (!response.ok) {
    return { error: `Shopify GraphQL read failed with HTTP ${response.status}.` };
  }

  const body = await readJson<GraphQlResponse<T>>(response, 'Shopify GraphQL read');
  if ('error' in body) return body;
  if (body.data.errors && body.data.errors.length > 0) {
    return { error: `Shopify GraphQL read returned ${body.data.errors.length} error(s): ${body.data.errors.map((error) => error.message ?? 'unknown').join('; ')}` };
  }
  if (!body.data.data) return { error: 'Shopify GraphQL read returned no data.' };
  return { data: body.data.data };
}

async function readJson<T>(response: Response, context: string): Promise<{ data: T } | { error: string }> {
  try {
    return { data: await response.json() as T };
  } catch (error) {
    return { error: `${context} returned invalid JSON: ${errorMessage(error)}` };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function normalizeProductByHandle(product: ProductNode | null | undefined, includeMetafields: boolean): ShopifyReadonlyProduct[] {
  if (!product) return [];
  const productId = stringOrUndefined(product.id) ?? 'unknown-product';
  const normalized = buildProduct(productId, product, includeMetafields);
  normalized.variants = normalizeVariants(product.variants?.nodes ?? [], includeMetafields);
  return [normalized];
}

function normalizeVariants(nodes: ProductVariantNode[], includeMetafields: boolean): ShopifyReadonlyVariant[] {
  return nodes.map((variant) => {
    const normalizedVariant: ShopifyReadonlyVariant = {
      variantId: stringOrUndefined(variant.id) ?? '',
      sku: stringOrUndefined(variant.sku) ?? '',
      title: stringOrUndefined(variant.title) ?? '',
      metafields: includeMetafields ? normalizeMetafields(variant.metafields?.nodes ?? []) : [],
    };
    assignIfPresent(normalizedVariant, 'price', stringOrUndefined(variant.price));
    assignIfPresent(normalizedVariant, 'inventoryQuantity', typeof variant.inventoryQuantity === 'number' ? variant.inventoryQuantity : undefined);
    assignIfPresent(normalizedVariant, 'inventoryTracked', typeof variant.inventoryItem?.tracked === 'boolean' ? variant.inventoryItem.tracked : undefined);
    assignIfPresent(normalizedVariant, 'inventoryItemId', stringOrUndefined(variant.inventoryItem?.id));
    return normalizedVariant;
  });
}

function normalizeProducts(nodes: ProductVariantNode[], includeMetafields: boolean): ShopifyReadonlyProduct[] {
  const byProductId = new Map<string, ShopifyReadonlyProduct>();

  for (const variant of nodes) {
    const product = variant.product;
    const productId = stringOrUndefined(product?.id) ?? 'unknown-product';
    const existing = byProductId.get(productId) ?? buildProduct(productId, product, includeMetafields);

    existing.variants.push(...normalizeVariants([variant], includeMetafields));

    byProductId.set(productId, existing);
  }

  return [...byProductId.values()];
}

function buildProduct(productId: string, product: ProductNode | null | undefined, includeMetafields: boolean): ShopifyReadonlyProduct {
  const normalized: ShopifyReadonlyProduct = {
    productId,
    handle: stringOrUndefined(product?.handle) ?? '',
    title: stringOrUndefined(product?.title) ?? '',
    tags: Array.isArray(product?.tags) ? product.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    metafields: includeMetafields ? normalizeMetafields(product?.metafields?.nodes ?? []) : [],
    media: normalizeMedia(product?.media?.nodes ?? []),
    variants: [],
  };
  assignIfPresent(normalized, 'status', stringOrUndefined(product?.status));
  assignIfPresent(normalized, 'productType', stringOrUndefined(product?.productType));
  assignIfPresent(normalized, 'vendor', stringOrUndefined(product?.vendor));
  assignIfPresent(normalized, 'productUrl', safePublicUrl(product?.onlineStoreUrl));
  return normalized;
}

function normalizeMetafields(nodes: MetafieldNode[]): ShopifyReadonlyMetafield[] {
  return nodes.map((node) => {
    const normalized: ShopifyReadonlyMetafield = {
      namespace: stringOrUndefined(node.namespace) ?? '',
      key: stringOrUndefined(node.key) ?? '',
      type: stringOrUndefined(node.type) ?? '',
    };
    assignIfPresent(normalized, 'valuePreview', previewValue(node.value));
    assignIfPresent(normalized, 'reference', normalizeReference(node.reference));
    return normalized;
  });
}

function normalizeReference(reference: MetafieldReference | null | undefined): ShopifyReadonlyMetafield['reference'] | undefined {
  if (!reference) return undefined;
  const typeName = stringOrUndefined(reference.__typename) ?? '';
  const imageUrl = safePublicUrl(reference.image?.url);
  const fileUrl = safePublicUrl(reference.url);
  if (typeName === 'MediaImage') {
    const normalized: NonNullable<ShopifyReadonlyMetafield['reference']> = { kind: 'image' };
    assignIfPresent(normalized, 'url', imageUrl);
    assignIfPresent(normalized, 'altText', stringOrUndefined(reference.image?.altText));
    return normalized;
  }
  if (typeName === 'GenericFile') {
    const normalized: NonNullable<ShopifyReadonlyMetafield['reference']> = { kind: 'file' };
    assignIfPresent(normalized, 'url', fileUrl);
    return normalized;
  }
  if (typeName === 'Metaobject') {
    const normalized: NonNullable<ShopifyReadonlyMetafield['reference']> = { kind: 'metaobject' };
    assignIfPresent(normalized, 'type', stringOrUndefined(reference.type));
    assignIfPresent(normalized, 'handle', stringOrUndefined(reference.handle));
    return normalized;
  }
  return { kind: 'other' };
}

function normalizeMedia(nodes: MediaNode[]): ShopifyReadonlyMedia[] {
  return nodes.map((node) => {
    const normalized: ShopifyReadonlyMedia = { kind: stringOrUndefined(node.mediaContentType) ?? 'unknown' };
    assignIfPresent(normalized, 'altText', stringOrUndefined(node.alt));
    assignIfPresent(normalized, 'previewImageUrl', safePublicUrl(node.preview?.image?.url));
    return normalized;
  });
}

function normalizeMetaobjects(nodes: MetaobjectNode[]): ShopifyReadonlyMetaobject[] {
  return nodes.map((node) => {
    const normalized: ShopifyReadonlyMetaobject = {
      id: stringOrUndefined(node.id) ?? '',
      type: stringOrUndefined(node.type) ?? '',
      fields: (node.fields ?? []).map((field) => {
        const normalizedField: ShopifyReadonlyMetaobject['fields'][number] = { key: stringOrUndefined(field.key) ?? '' };
        assignIfPresent(normalizedField, 'type', stringOrUndefined(field.type));
        assignIfPresent(normalizedField, 'valuePreview', previewValue(field.value));
        return normalizedField;
      }),
    };
    assignIfPresent(normalized, 'handle', stringOrUndefined(node.handle));
    return normalized;
  });
}

function assignIfPresent<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

function withConnectorError(
  base: ShopifyLiveReadResult,
  status: ShopifyLiveReadResult['connector']['status'],
  message: string,
  tokenState: ShopifyLiveReadResult['shopify']['token'],
): ShopifyLiveReadResult {
  return {
    ...base,
    shopify: { ...base.shopify, token: tokenState },
    connector: { status, source: 'not_connected', messages: [redactSensitiveText(message)] },
  };
}

function adminApiVersion(env: ShopifyReadAdapterEnv): string {
  const configured = env.SHOPIFY_ADMIN_API_VERSION?.trim();
  if (configured && /^\d{4}-\d{2}$/.test(configured)) return configured;
  return DEFAULT_ADMIN_API_VERSION;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function previewValue(value: unknown): string | undefined {
  const text = stringOrUndefined(value);
  if (!text) return undefined;
  return redactSensitiveText(text).slice(0, 160);
}

function safePublicUrl(value: unknown): string | undefined {
  const text = stringOrUndefined(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:') return undefined;
    if (['commonlands.com', 'cdn.shopify.com'].includes(url.hostname)) return url.toString();
  } catch {
    return undefined;
  }
  return undefined;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/shpat_[a-zA-Z0-9_-]+/g, '[redacted]')
    .replace(/shpss_[a-zA-Z0-9_-]+/g, '[redacted]')
    .replace(/access[_-]?token\s*[:=]\s*[^\s,}]+/gi, 'access_token=[redacted]')
    .replace(/client[_-]?secret\s*[:=]\s*[^\s,}]+/gi, 'client_secret=[redacted]')
    .replace(/client[_-]?id\s*[:=]\s*[^\s,}]+/gi, 'client_id=[redacted]');
}

function productVariantsQuery(includeMetafields: boolean): string {
  return `#graphql
    query CommonlandsReadProductVariants($query: String!, $first: Int!) {
      productVariants(first: $first, query: $query) {
        nodes {
          ${VARIANT_FIELDS}
          product {
            ${PRODUCT_FIELDS}
          }
        }
      }
    }
    ${metafieldFragment(includeMetafields)}
  `;
}

function productByHandleQuery(includeMetafields: boolean): string {
  return `#graphql
    query CommonlandsReadProductByHandle($handle: String!, $first: Int!) {
      productByHandle(handle: $handle) {
        ${PRODUCT_FIELDS}
        variants(first: $first) {
          nodes {
            ${VARIANT_FIELDS}
          }
        }
      }
    }
    ${metafieldFragment(includeMetafields)}
  `;
}

const VARIANT_FIELDS = `
  id
  sku
  title
  price
  inventoryQuantity
  inventoryItem {
    id
    tracked
  }
  ...VariantMetafields
`;

const PRODUCT_FIELDS = `
  id
  handle
  title
  status
  productType
  vendor
  tags
  onlineStoreUrl
  ...ProductMetafields
  media(first: 5) {
    nodes {
      mediaContentType
      alt
      preview { image { url altText } }
    }
  }
`;

function metafieldFragment(includeMetafields: boolean): string {
  if (!includeMetafields) {
    return `
      fragment VariantMetafields on ProductVariant { __typename }
      fragment ProductMetafields on Product { __typename }
    `;
  }
  return `
    fragment VariantMetafields on ProductVariant {
      metafields(first: 100) {
        nodes {
          namespace
          key
          type
          value
          reference {
            __typename
            ... on GenericFile { url }
            ... on MediaImage { image { url altText } }
            ... on Metaobject { type handle }
          }
        }
      }
    }
    fragment ProductMetafields on Product {
      metafields(first: 100) {
        nodes {
          namespace
          key
          type
          value
          reference {
            __typename
            ... on GenericFile { url }
            ... on MediaImage { image { url altText } }
            ... on Metaobject { type handle }
          }
        }
      }
    }
  `;
}

const METAOBJECTS_QUERY = `#graphql
  query CommonlandsReadMetaobjects($type: String!, $first: Int!) {
    metaobjects(type: $type, first: $first) {
      nodes {
        id
        type
        handle
        fields {
          key
          type
          value
        }
      }
    }
  }
`;
