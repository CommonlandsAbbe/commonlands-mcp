import { CATALOG_SNAPSHOT, FIXTURE_NOT_PRODUCT_TRUTH_WARNING, type CatalogSnapshot } from './catalog';

interface SnapshotValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

interface SourceWarning {
  severity: typeof FIXTURE_NOT_PRODUCT_TRUTH_WARNING.severity;
  code: typeof FIXTURE_NOT_PRODUCT_TRUTH_WARNING.code;
  text: typeof FIXTURE_NOT_PRODUCT_TRUTH_WARNING.text;
}

export interface CatalogSnapshotStatus {
  schemaVersion: 'catalog.snapshot_status.v1';
  generatedAt: string;
  counts: {
    lenses: number;
    sensors: number;
    joins: number;
    missingCommerce: number;
    missingOptical: number;
    unsafeUrls: number;
  };
  validation: SnapshotValidation;
  sourceWarning: SourceWarning;
  sources: {
    optical: 'fixture:dynamodb-audit';
    commerce: 'fixture:shopify-products-sheet';
  };
  refresh: {
    mode: 'fixture_static';
    liveConnectors: 'not_connected';
    note: string;
  };
}

export function getCatalogSnapshotStatus(snapshot: CatalogSnapshot = CATALOG_SNAPSHOT): CatalogSnapshotStatus {
  const validation = validateCatalogSnapshot(snapshot);

  return {
    schemaVersion: 'catalog.snapshot_status.v1',
    generatedAt: snapshot.generatedAt,
    counts: {
      lenses: snapshot.lenses.length,
      sensors: snapshot.sensors.length,
      joins: snapshot.lenses.filter(hasOpticalAndCommerceSources).length,
      missingCommerce: snapshot.lenses.filter((lens) => !lens.source.commerce).length,
      missingOptical: snapshot.lenses.filter((lens) => !lens.source.optical).length,
      unsafeUrls: validation.errors.filter((error) => error.includes('Unsafe')).length,
    },
    validation: {
      ...validation,
      warnings: [FIXTURE_NOT_PRODUCT_TRUTH_WARNING.text, ...validation.warnings],
    },
    sourceWarning: FIXTURE_NOT_PRODUCT_TRUTH_WARNING,
    sources: {
      optical: 'fixture:dynamodb-audit',
      commerce: 'fixture:shopify-products-sheet',
    },
    refresh: {
      mode: 'fixture_static',
      liveConnectors: 'not_connected',
      note: 'Static fixture snapshot. Use read_shopify_products for live purchasable product truth; fixture data is not authoritative for price, availability, Shopify IDs, variant IDs, exact product specs, cart, or checkout preparation.',
    },
  };
}

function validateCatalogSnapshot(snapshot: CatalogSnapshot): SnapshotValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenSkus = new Set<string>();
  const seenSensors = new Set<string>();

  for (const lens of snapshot.lenses) {
    if (seenSkus.has(lens.sku)) {
      errors.push(`Duplicate lens SKU: ${lens.sku}`);
    }
    seenSkus.add(lens.sku);

    if (!lens.source.optical) errors.push(`Missing optical source for ${lens.sku}`);
    if (!lens.source.commerce) errors.push(`Missing commerce source for ${lens.sku}`);
    if (!lens.mechanicalDrawingUrl) warnings.push(`Missing mechanical drawing URL for ${lens.sku}`);

    collectUrlError(errors, lens.productUrl, ['commonlands.com'], `product URL for ${lens.sku}`);
    if (lens.mechanicalDrawingUrl) {
      collectUrlError(errors, lens.mechanicalDrawingUrl, ['cdn.shopify.com', 'commonlands.com'], `drawing URL for ${lens.sku}`);
    }

    if (JSON.stringify(lens).toLowerCase().includes('docsend')) {
      errors.push(`Unsafe gated URL leaked into catalog fixture for ${lens.sku}`);
    }
  }

  for (const sensor of snapshot.sensors) {
    if (seenSensors.has(sensor.partNumber)) {
      errors.push(`Duplicate sensor part number: ${sensor.partNumber}`);
    }
    seenSensors.add(sensor.partNumber);

    if (sensor.resolution.widthPx <= 0 || sensor.resolution.heightPx <= 0) {
      errors.push(`Invalid sensor resolution for ${sensor.partNumber}`);
    }
    if (sensor.activeAreaMm.width <= 0 || sensor.activeAreaMm.height <= 0) {
      errors.push(`Invalid sensor active area for ${sensor.partNumber}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function hasOpticalAndCommerceSources(lens: CatalogSnapshot['lenses'][number]): boolean {
  return Boolean(lens.source.optical && lens.source.commerce);
}

function collectUrlError(errors: string[], value: string, allowedHosts: string[], label: string): void {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !allowedHosts.includes(url.hostname)) {
      errors.push(`Unsafe ${label}: ${value}`);
    }
  } catch {
    errors.push(`Unsafe ${label}: ${value}`);
  }
}
