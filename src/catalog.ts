export interface LensCatalogItem {
  sku: string;
  title: string;
  handle: string;
  productUrl: string;
  priceUsd: number;
  availability: 'in_stock' | 'out_of_stock' | 'unknown';
  mount: string;
  lensType: string;
  eflMm: number;
  fNumber: number;
  imageCircleMm: number;
  maxFovDeg: number;
  projectionModel: 'projection_polynomial_theta_even_powers';
  coefficientCount: number;
  fixtureDistortion?: {
    alpha: number;
    beta: number;
    notes: string;
  };
  mechanicalDrawingUrl?: string;
  datasheet: {
    gated: true;
    note: string;
  };
  source: {
    optical: 'fixture:dynamodb-audit';
    commerce: 'fixture:shopify-products-sheet';
    refreshedAt: string;
  };
}

export interface SensorCatalogItem {
  partNumber: string;
  manufacturer: string;
  name: string;
  resolution: {
    widthPx: number;
    heightPx: number;
  };
  activeAreaMm: {
    width: number;
    height: number;
  };
  pixelSizeUm: number;
}

export interface CatalogSnapshot {
  schemaVersion: 'catalog.snapshot.v1';
  generatedAt: string;
  lenses: LensCatalogItem[];
  sensors: SensorCatalogItem[];
  notes: string[];
}

const GATED_DATASHEET = {
  gated: true,
  note: 'Datasheets are gated; use the product page for access instructions.',
} as const;

const SOURCE = {
  optical: 'fixture:dynamodb-audit',
  commerce: 'fixture:shopify-products-sheet',
  refreshedAt: '2026-05-01T00:00:00.000Z',
} as const;

export const CATALOG_SNAPSHOT: CatalogSnapshot = {
  schemaVersion: 'catalog.snapshot.v1',
  generatedAt: '2026-05-01T00:00:00.000Z',
  notes: [
    'Fixture-backed Phase 1 snapshot; replace with scheduled DDB + Shopify joined cache after credentials/schema are confirmed.',
    'Datasheets are intentionally gated and direct DocSend URLs are never emitted.',
  ],
  lenses: [
    {
      sku: 'CIL078',
      title: 'CIL078 M12 wide-angle lens',
      handle: 'cil078',
      productUrl: 'https://commonlands.com/products/cil078',
      priceUsd: 29,
      availability: 'in_stock',
      mount: 'M12',
      lensType: 'board lens',
      eflMm: 2.8,
      fNumber: 2.0,
      imageCircleMm: 6.6,
      maxFovDeg: 130,
      projectionModel: 'projection_polynomial_theta_even_powers',
      coefficientCount: 4,
      fixtureDistortion: { alpha: 1, beta: 0.02, notes: 'Placeholder wide-angle parity scaffold.' },
      mechanicalDrawingUrl: 'https://cdn.shopify.com/s/files/1/0624/5391/3805/files/CIL078.pdf',
      datasheet: GATED_DATASHEET,
      source: SOURCE,
    },
    {
      sku: 'CIL250',
      title: 'CIL250 M12 lens',
      handle: 'cil250',
      productUrl: 'https://commonlands.com/products/cil250',
      priceUsd: 34,
      availability: 'in_stock',
      mount: 'M12',
      lensType: 'board lens',
      eflMm: 6.0,
      fNumber: 2.4,
      imageCircleMm: 7.2,
      maxFovDeg: 72,
      projectionModel: 'projection_polynomial_theta_even_powers',
      coefficientCount: 4,
      fixtureDistortion: { alpha: 1, beta: 0, notes: 'Rectilinear baseline until production coefficients are connected.' },
      mechanicalDrawingUrl: 'https://cdn.shopify.com/s/files/1/0624/5391/3805/files/CIL250.pdf',
      datasheet: GATED_DATASHEET,
      source: SOURCE,
    },
    {
      sku: 'CIL350',
      title: 'CIL350 M12 telephoto lens',
      handle: 'cil350',
      productUrl: 'https://commonlands.com/products/cil350',
      priceUsd: 38,
      availability: 'unknown',
      mount: 'M12',
      lensType: 'board lens',
      eflMm: 12.0,
      fNumber: 2.8,
      imageCircleMm: 8.0,
      maxFovDeg: 40,
      projectionModel: 'projection_polynomial_theta_even_powers',
      coefficientCount: 4,
      fixtureDistortion: { alpha: 1, beta: 0, notes: 'Rectilinear baseline until production coefficients are connected.' },
      mechanicalDrawingUrl: 'https://cdn.shopify.com/s/files/1/0624/5391/3805/files/CIL350.pdf',
      datasheet: GATED_DATASHEET,
      source: SOURCE,
    },
    {
      sku: 'CIL051',
      title: 'CIL051 M8 compact lens',
      handle: 'cil051',
      productUrl: 'https://commonlands.com/products/cil051',
      priceUsd: 24,
      availability: 'in_stock',
      mount: 'M8',
      lensType: 'board lens',
      eflMm: 1.8,
      fNumber: 2.8,
      imageCircleMm: 4.5,
      maxFovDeg: 150,
      projectionModel: 'projection_polynomial_theta_even_powers',
      coefficientCount: 4,
      fixtureDistortion: { alpha: 1, beta: 0.05, notes: 'Placeholder fisheye/wide-angle parity scaffold.' },
      mechanicalDrawingUrl: 'https://cdn.shopify.com/s/files/1/0624/5391/3805/files/CIL051.pdf',
      datasheet: GATED_DATASHEET,
      source: SOURCE,
    },
    {
      sku: 'CIL121',
      title: 'CIL121 C-mount machine vision lens',
      handle: 'cil121',
      productUrl: 'https://commonlands.com/products/cil121',
      priceUsd: 89,
      availability: 'in_stock',
      mount: 'C-mount',
      lensType: 'machine vision lens',
      eflMm: 16.0,
      fNumber: 1.8,
      imageCircleMm: 11.0,
      maxFovDeg: 24,
      projectionModel: 'projection_polynomial_theta_even_powers',
      coefficientCount: 4,
      fixtureDistortion: { alpha: 1, beta: 0, notes: 'Rectilinear baseline until production coefficients are connected.' },
      mechanicalDrawingUrl: 'https://cdn.shopify.com/s/files/1/0624/5391/3805/files/CIL121.pdf',
      datasheet: GATED_DATASHEET,
      source: SOURCE,
    },
  ],
  sensors: [
    {
      partNumber: 'IMX477',
      manufacturer: 'Sony',
      name: 'Sony IMX477',
      resolution: { widthPx: 4056, heightPx: 3040 },
      activeAreaMm: { width: 6.287, height: 4.712 },
      pixelSizeUm: 1.55,
    },
    {
      partNumber: 'IMX219',
      manufacturer: 'Sony',
      name: 'Sony IMX219',
      resolution: { widthPx: 3280, heightPx: 2464 },
      activeAreaMm: { width: 3.674, height: 2.760 },
      pixelSizeUm: 1.12,
    },
    {
      partNumber: 'AR0234',
      manufacturer: 'onsemi',
      name: 'onsemi AR0234',
      resolution: { widthPx: 1920, heightPx: 1200 },
      activeAreaMm: { width: 5.76, height: 3.6 },
      pixelSizeUm: 3.0,
    },
  ],
};

export function searchLenses(query = '', limit = 10): LensCatalogItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 10, 1), 25);

  const matches = normalizedQuery
    ? CATALOG_SNAPSHOT.lenses.filter((lens) => {
        const searchable = [lens.sku, lens.title, lens.handle, lens.mount, lens.lensType]
          .join(' ')
          .toLowerCase();
        return searchable.includes(normalizedQuery);
      })
    : CATALOG_SNAPSHOT.lenses;

  return matches.slice(0, safeLimit);
}

export function getLensBySku(sku: string): LensCatalogItem | undefined {
  const normalizedSku = sku.trim().toLowerCase();
  return CATALOG_SNAPSHOT.lenses.find((lens) => lens.sku.toLowerCase() === normalizedSku);
}

export function getSensorByPartNumber(partNumber: string): SensorCatalogItem | undefined {
  const normalizedPartNumber = partNumber.trim().toLowerCase();
  return CATALOG_SNAPSHOT.sensors.find(
    (sensor) => sensor.partNumber.toLowerCase() === normalizedPartNumber,
  );
}

export function assertSafePublicCatalogUrls(snapshot: CatalogSnapshot = CATALOG_SNAPSHOT): void {
  for (const lens of snapshot.lenses) {
    assertAllowedUrl(lens.productUrl, ['commonlands.com']);

    if (lens.mechanicalDrawingUrl) {
      assertAllowedUrl(lens.mechanicalDrawingUrl, ['cdn.shopify.com', 'commonlands.com']);
    }

    const serialized = JSON.stringify(lens).toLowerCase();
    if (serialized.includes('docsend')) {
      throw new Error(`Unsafe gated URL leaked into catalog fixture for ${lens.sku}`);
    }
  }
}

function assertAllowedUrl(value: string, allowedHosts: string[]): void {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !allowedHosts.includes(url.hostname)) {
    throw new Error(`Unsafe public URL in catalog fixture: ${value}`);
  }
}
