// Narrowed for the public-data-only surface (Anthropic directory review,
// 2026-07): metaobject, marketing, payment-terms, and shipping scopes were
// removed because no public tool needs them. Requesting fewer Admin scopes
// keeps the exchanged token unable to read non-public store data even if a
// future code path regresses.
const APPROVED_READ_SCOPES = [
  'read_files',
  'read_inventory',
  'read_online_store_navigation',
  'read_online_store_pages',
  'read_product_feeds',
  'read_product_listings',
  'read_products',
  'read_content',
] as const;

const DENIED_SCOPE_PREFIXES = ['write_', 'unauthenticated_write_'] as const;
const SENSITIVE_ENV_KEYS = ['SHOPIFY_CLIENT_SECRET'] as const;

export interface ShopifyReadonlyEnv {
  SHOPIFY_CLIENT_ID?: string;
  SHOPIFY_CLIENT_SECRET?: string;
  SHOPIFY_SHOP_DOMAIN?: string;
  SHOPIFY_SCOPES?: string;
}

export interface ShopifyReadonlyStatus {
  schemaVersion: 'shopify.readonly_config_status.v1';
  mode: 'read_only_configuration_check';
  credentialModel: 'shopify_dev_dashboard_client_credentials';
  configured: boolean;
  bindings: {
    clientId: BindingStatus;
    clientSecret: BindingStatus;
    shopDomain: BindingStatus;
    scopes: BindingStatus;
  };
  shopDomain: {
    configured: boolean;
    normalizedDomain?: string;
    format: 'myshopify_domain' | 'shop_subdomain' | 'invalid_or_missing';
  };
  scopes: {
    configured: string[];
    approvedReadScopes: string[];
    missingApprovedReadScopes: string[];
    unapprovedScopes: string[];
    deniedMutationScopes: string[];
  };
  safety: {
    readOnly: boolean;
    writesShopify: false;
    createsCart: false;
    createsCheckout: false;
    readsCustomers: false;
    readsOrders: false;
    mutatesInventory: false;
    touchesInventorySync: false;
    exposesSecrets: false;
  };
  nextRequired: string[];
}

type BindingStatus = 'present' | 'missing';

export function getShopifyReadonlyStatus(env: ShopifyReadonlyEnv = {}): ShopifyReadonlyStatus {
  const configuredScopes = parseScopes(env.SHOPIFY_SCOPES);
  const deniedMutationScopes = configuredScopes.filter(isDeniedMutationScope);
  const unapprovedScopes = configuredScopes.filter((scope) => !APPROVED_READ_SCOPES.includes(scope as typeof APPROVED_READ_SCOPES[number]));
  const missingApprovedReadScopes = APPROVED_READ_SCOPES.filter((scope) => !configuredScopes.includes(scope));
  const normalizedDomain = normalizeShopDomain(env.SHOPIFY_SHOP_DOMAIN);
  const hasAllBindings = Boolean(env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET && normalizedDomain && configuredScopes.length > 0);
  const readOnly = deniedMutationScopes.length === 0;

  return {
    schemaVersion: 'shopify.readonly_config_status.v1',
    mode: 'read_only_configuration_check',
    credentialModel: 'shopify_dev_dashboard_client_credentials',
    configured: hasAllBindings && readOnly,
    bindings: {
      clientId: present(env.SHOPIFY_CLIENT_ID),
      clientSecret: presentSecret(env.SHOPIFY_CLIENT_SECRET),
      shopDomain: present(env.SHOPIFY_SHOP_DOMAIN),
      scopes: present(env.SHOPIFY_SCOPES),
    },
    shopDomain: {
      configured: Boolean(normalizedDomain),
      ...(normalizedDomain ? { normalizedDomain } : {}),
      format: shopDomainFormat(env.SHOPIFY_SHOP_DOMAIN),
    },
    scopes: {
      configured: configuredScopes,
      approvedReadScopes: [...APPROVED_READ_SCOPES],
      missingApprovedReadScopes,
      unapprovedScopes,
      deniedMutationScopes,
    },
    safety: {
      readOnly,
      writesShopify: false,
      createsCart: false,
      createsCheckout: false,
      readsCustomers: false,
      readsOrders: false,
      mutatesInventory: false,
      touchesInventorySync: false,
      exposesSecrets: false,
    },
    nextRequired: nextRequired({
      hasClientId: Boolean(env.SHOPIFY_CLIENT_ID),
      hasClientSecret: Boolean(env.SHOPIFY_CLIENT_SECRET),
      hasShopDomain: Boolean(normalizedDomain),
      hasScopes: configuredScopes.length > 0,
      deniedMutationScopes,
      unapprovedScopes,
      missingApprovedReadScopes,
    }),
  };
}

export function parseScopes(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean))].sort();
}

export function normalizeShopDomain(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(trimmed)) return trimmed;
  if (/^[a-z0-9][a-z0-9-]*$/.test(trimmed)) return `${trimmed}.myshopify.com`;
  return undefined;
}

function shopDomainFormat(value: string | undefined): ShopifyReadonlyStatus['shopDomain']['format'] {
  if (!value) return 'invalid_or_missing';
  const trimmed = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(trimmed)) return 'myshopify_domain';
  if (/^[a-z0-9][a-z0-9-]*$/.test(trimmed)) return 'shop_subdomain';
  return 'invalid_or_missing';
}

function isDeniedMutationScope(scope: string): boolean {
  return DENIED_SCOPE_PREFIXES.some((prefix) => scope.startsWith(prefix));
}

function present(value: string | undefined): BindingStatus {
  return value && value.trim() ? 'present' : 'missing';
}

function presentSecret(value: string | undefined): BindingStatus {
  return SENSITIVE_ENV_KEYS.length > 0 && value && value.trim() ? 'present' : 'missing';
}

function nextRequired(input: {
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasShopDomain: boolean;
  hasScopes: boolean;
  deniedMutationScopes: string[];
  unapprovedScopes: string[];
  missingApprovedReadScopes: string[];
}): string[] {
  const next: string[] = [];
  if (!input.hasClientId) next.push('Add SHOPIFY_CLIENT_ID as a Cloudflare variable.');
  if (!input.hasClientSecret) next.push('Add SHOPIFY_CLIENT_SECRET as a Cloudflare secret.');
  if (!input.hasShopDomain) next.push('Add SHOPIFY_SHOP_DOMAIN as the permanent myshopify.com domain or subdomain.');
  if (!input.hasScopes) next.push('Add SHOPIFY_SCOPES as the approved comma-separated read scope list.');
  if (input.deniedMutationScopes.length > 0) next.push('Remove all Shopify mutation scopes before enabling any live adapter.');
  if (input.unapprovedScopes.length > 0) next.push('Review unapproved scopes before enabling any live adapter.');
  if (input.missingApprovedReadScopes.length > 0) next.push('Confirm whether omitted approved read scopes are intentionally unnecessary.');
  if (next.length === 0) {
    next.push('Build the token-exchange and read-only product/variant/metafield adapter behind tests.');
  }
  return next;
}
