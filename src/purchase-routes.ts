import { getLensBySku, type LensCatalogItem } from './catalog';
import { buildProductPageDetails } from './product-page';
import { prepareShopifyPurchaseHandoff } from './ucp-catalog';

interface PurchaseRouteAction {
  futureTool: string;
  currentSafeAction: string;
  target?: string;
}

interface PurchaseRoute {
  channel: 'commonlands_mcp_dedicated_purchase' | 'shopify_native_checkout' | 'engineering_review_request';
  status:
    | 'planned_requires_approval_and_live_connectors'
    | 'planned_requires_shopify_storefront_cart'
    | 'available_now_non_transactional';
  recommendedFor: string[];
  actions: PurchaseRouteAction;
  readiness: {
    liveConnectors: 'not_connected';
    mutationEnabled: false;
    requiredApproval: string;
  };
}

export interface PurchaseRouteOptions {
  schemaVersion: 'commerce.purchase_routes.v1';
  correctionStatus: 'fixture_dual_channel_transaction_plan_no_mutation';
  generatedAt: string;
  product: {
    sku: string;
    title: string;
    handle: string;
    productUrl: string;
    variantId: string;
    price: { amount: number; currency: 'USD' };
    availability: LensCatalogItem['availability'];
  };
  context: {
    buyerIntent: string;
    agentType?: string;
    sensorPartNumber?: string;
    quantity: number;
  };
  routes: PurchaseRoute[];
  productDetails: ReturnType<typeof buildProductPageDetails>;
  requiredBeforeLiveTransaction: string[];
  transactionSafety: {
    createsCart: false;
    createsCheckout: false;
    writesShopify: false;
    writesCommonlandsOrder: false;
    mutatesInventory: false;
    touchesCustomerData: false;
    requiresHumanApprovalBeforeMutation: true;
  };
  warnings: string[];
  provenance: {
    optical: LensCatalogItem['source']['optical'];
    commerce: LensCatalogItem['source']['commerce'];
  };
}

export function getPurchaseRouteOptions(args: Record<string, unknown>): PurchaseRouteOptions {
  if (typeof args.sku !== 'string' || args.sku.trim() === '') {
    throw new Error('Invalid params: sku is required');
  }
  if (args.quantity !== undefined && (typeof args.quantity !== 'number' || !Number.isFinite(args.quantity) || args.quantity < 1 || args.quantity > 999)) {
    throw new Error('Invalid params: quantity must be between 1 and 999 when provided');
  }
  if (args.sensorPartNumber !== undefined && typeof args.sensorPartNumber !== 'string') {
    throw new Error('Invalid params: sensorPartNumber must be a string when provided');
  }
  if (args.buyerIntent !== undefined && typeof args.buyerIntent !== 'string') {
    throw new Error('Invalid params: buyerIntent must be a string when provided');
  }
  if (args.agentType !== undefined && typeof args.agentType !== 'string') {
    throw new Error('Invalid params: agentType must be a string when provided');
  }

  const lens = getLensBySku(args.sku);
  if (!lens) {
    throw new Error(`Lens not found: ${args.sku}`);
  }

  const quantity = typeof args.quantity === 'number' ? Math.trunc(args.quantity) : 1;
  const handoff = prepareShopifyPurchaseHandoff({
    sku: lens.sku,
    quantity,
    ...(typeof args.sensorPartNumber === 'string' ? { sensorPartNumber: args.sensorPartNumber } : {}),
  });
  const buyerIntent = typeof args.buyerIntent === 'string' && args.buyerIntent.trim() !== ''
    ? args.buyerIntent.trim()
    : 'engineering evaluation or purchase';

  return {
    schemaVersion: 'commerce.purchase_routes.v1',
    correctionStatus: 'fixture_dual_channel_transaction_plan_no_mutation',
    generatedAt: handoff.generatedAt,
    product: {
      sku: lens.sku,
      title: lens.title,
      handle: lens.handle,
      productUrl: lens.productUrl,
      variantId: handoff.product.variantId,
      price: handoff.product.price,
      availability: lens.availability,
    },
    context: {
      buyerIntent,
      ...(typeof args.agentType === 'string' && args.agentType.trim() !== '' ? { agentType: args.agentType.trim() } : {}),
      ...(typeof args.sensorPartNumber === 'string' ? { sensorPartNumber: args.sensorPartNumber } : {}),
      quantity,
    },
    routes: [
      {
        channel: 'commonlands_mcp_dedicated_purchase',
        status: 'planned_requires_approval_and_live_connectors',
        recommendedFor: [
          'AI agents that already selected a lens through Commonlands optics tools',
          'robotics engineers who need a spec-validated purchase session with optical context preserved',
          'future multi-line engineering purchases that should carry sensor, FoV, and recommendation provenance',
        ],
        actions: {
          futureTool: 'create_commonlands_purchase_session',
          currentSafeAction: 'prepare_shopify_purchase_handoff',
          target: 'Commonlands MCP dedicated transaction surface after approval',
        },
        readiness: noMutationReadiness(),
      },
      {
        channel: 'shopify_native_checkout',
        status: 'planned_requires_shopify_storefront_cart',
        recommendedFor: [
          'buyers who should complete payment through Shopify native checkout',
          'AI commerce clients that support Shopify Storefront Cart or UCP transaction capabilities',
          'standard single-SKU sample purchases once live Shopify variant IDs and freshness checks are connected',
        ],
        actions: {
          futureTool: 'create_shopify_cart_or_checkout',
          currentSafeAction: 'open_product_url',
          target: lens.productUrl,
        },
        readiness: noMutationReadiness(),
      },
      {
        channel: 'engineering_review_request',
        status: 'available_now_non_transactional',
        recommendedFor: [
          'robotics or machine-vision applications with sensor-fit, volume, lead-time, or optical-risk questions',
          'cases where an agent should preserve the selected lens, sensor, FoV, quantity, and tradeoffs for human engineering follow-up',
        ],
        actions: {
          futureTool: 'request_engineering_review',
          currentSafeAction: 'return_product_url_and_optical_context',
          target: 'https://commonlands.com/pages/contact',
        },
        readiness: noMutationReadiness(),
      },
    ],
    productDetails: handoff.productDetails,
    requiredBeforeLiveTransaction: [
      'approved Shopify Storefront API cart/checkout credentials stored outside source control',
      'stable live Shopify product and variant ID mapping for every MCP SKU',
      'price, availability, and inventory freshness revalidation at transaction time',
      'explicit approval for any cart, checkout, order, customer, RFQ, or inventory mutation tool',
      'idempotency keys, audit logging, rate limits, and rollback/failure semantics for transaction creation',
      'customer-data/OAuth policy review before any account, order-status, or protected customer data flow',
    ],
    transactionSafety: {
      createsCart: false,
      createsCheckout: false,
      writesShopify: false,
      writesCommonlandsOrder: false,
      mutatesInventory: false,
      touchesCustomerData: false,
      requiresHumanApprovalBeforeMutation: true,
    },
    warnings: [
      'This response plans purchase routes only; it does not create a cart, checkout, order, RFQ, customer record, or inventory reservation.',
      'Use Commonlands MCP tools for optics/spec selection and Shopify-native channels for future payment once approved connectors are live.',
      'Live price, availability, variant IDs, and inventory must be revalidated before any future transaction.',
    ],
    provenance: {
      optical: lens.source.optical,
      commerce: lens.source.commerce,
    },
  };
}

function noMutationReadiness(): PurchaseRoute['readiness'] {
  return {
    liveConnectors: 'not_connected',
    mutationEnabled: false,
    requiredApproval: 'Explicit approval required before enabling live transaction mutation.',
  };
}
