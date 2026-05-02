import { type LensCatalogItem } from './catalog';

export interface ProductPageDetails {
  schemaVersion: 'product_page.v1';
  correctionStatus: 'fixture_commerce_handoff';
  product: {
    sku: string;
    title: string;
    handle: string;
    productUrl: string;
    priceUsd: number;
    availability: LensCatalogItem['availability'];
    mechanicalDrawingUrl?: string;
  };
  technicalSpecifications: {
    mount: string;
    lensType: string;
    eflMm: number;
    fNumber: number;
    imageCircleMm: number;
    maxFovDeg: number;
    projectionModel: LensCatalogItem['projectionModel'];
    coefficientCount: number;
    resolution: {
      value: string;
      source: LensCatalogItem['source']['optical'];
    };
  };
  datasheet: LensCatalogItem['datasheet'];
  safety: {
    datasheetAccess: 'gated';
    liveConnectors: 'not_connected';
    notes: string[];
  };
  source: {
    optical: LensCatalogItem['source']['optical'];
    commerce: LensCatalogItem['source']['commerce'];
    refreshedAt: string;
  };
}

export function buildProductPageDetails(lens: LensCatalogItem): ProductPageDetails {
  return {
    schemaVersion: 'product_page.v1',
    correctionStatus: 'fixture_commerce_handoff',
    product: {
      sku: lens.sku,
      title: lens.title,
      handle: lens.handle,
      productUrl: lens.productUrl,
      priceUsd: lens.priceUsd,
      availability: lens.availability,
      ...(lens.mechanicalDrawingUrl ? { mechanicalDrawingUrl: lens.mechanicalDrawingUrl } : {}),
    },
    technicalSpecifications: {
      mount: lens.mount,
      lensType: lens.lensType,
      eflMm: lens.eflMm,
      fNumber: lens.fNumber,
      imageCircleMm: lens.imageCircleMm,
      maxFovDeg: lens.maxFovDeg,
      projectionModel: lens.projectionModel,
      coefficientCount: lens.coefficientCount,
      resolution: {
        value: lens.resolution,
        source: lens.source.optical,
      },
    },
    datasheet: lens.datasheet,
    safety: {
      datasheetAccess: 'gated',
      liveConnectors: 'not_connected',
      notes: [
        'Resolution is an optical catalog field sourced from DynamoDB, not Shopify enrichment.',
        'Datasheets remain gated and direct gated-document URLs are never emitted.',
        'Live price, inventory, and metafields are fixture-backed until read-only connectors are approved and configured.',
      ],
    },
    source: lens.source,
  };
}
