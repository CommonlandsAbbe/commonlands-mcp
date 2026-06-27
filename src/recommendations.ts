import { CATALOG_SNAPSHOT, type LensCatalogItem, type SensorCatalogItem } from './catalog';
import { computeFov, type FovResult } from './optics';

export interface LensRecommendation {
  lens: {
    sku: string;
    title: string;
    handle: string;
    productUrl: string;
    mount: string;
    lensType: string;
    eflMm: number;
    fNumber: number;
    imageCircleMm: number;
    maxFovDeg: number;
    availability: LensCatalogItem['availability'];
  };
  score: number;
  rank: number;
  fit: 'excellent' | 'good' | 'conditional' | 'poor';
  fov: FovResult['fov'];
  imageCircle: FovResult['imageCircle'];
  angularResolution: FovResult['angularResolution'];
  tradeoffs: string[];
  warnings: string[];
}

export interface MatchLensesInput {
  sensorPartNumber: string;
  desiredHorizontalFovDeg?: number;
  workingDistanceMm?: number;
  mount?: string;
  maxResults?: number;
}

export interface RecommendApplicationInput extends MatchLensesInput {
  application?: string;
  preferLowDistortion?: boolean;
  requireInStock?: boolean;
}

export interface CompareLensesInput {
  lensSkus: string[];
  sensorPartNumber: string;
  workingDistanceMm?: number;
}

// Normalized lens record sourced from the LIVE FoV backend (AWS Lambda + DynamoDB
// lens catalog). Carries the real specs and the backend's already-computed FoV, so
// the ranking tools score against product truth instead of the scrambled fixture.
export interface LiveLensInput {
  sku: string;
  mount: string;
  lensType: string;
  eflMm: number;
  fNumber: number;
  imageCircleMm: number;
  maxFovDeg: number;
  productUrl: string;
  resolution: string;
  fov: FovResult['fov'];
  imageCircle: FovResult['imageCircle'];
  angularResolution: FovResult['angularResolution'];
  warnings: string[];
}

export function matchLensesToSensor(input: MatchLensesInput): LensRecommendation[] {
  const sensor = requireSensor(input.sensorPartNumber);
  const maxResults = clampMaxResults(input.maxResults);
  return CATALOG_SNAPSHOT.lenses
    .filter((lens) => matchesMount(lens, input.mount))
    .map((lens) => scoreLens(lens, sensor, input))
    .sort(sortRecommendations)
    .slice(0, maxResults)
    .map((recommendation, index) => ({ ...recommendation, rank: index + 1 }));
}

export function recommendLensesForApplication(input: RecommendApplicationInput): LensRecommendation[] {
  const base = matchLensesToSensor({ ...input, maxResults: CATALOG_SNAPSHOT.lenses.length });
  return base
    .map((recommendation) => applyApplicationPreferences(recommendation, input))
    .sort(sortRecommendations)
    .slice(0, clampMaxResults(input.maxResults))
    .map((recommendation, index) => ({ ...recommendation, rank: index + 1 }));
}

export function compareLenses(input: CompareLensesInput): LensRecommendation[] {
  const sensor = requireSensor(input.sensorPartNumber);
  const uniqueSkus = [...new Set(input.lensSkus.map((sku) => sku.trim().toUpperCase()))];
  return uniqueSkus
    .map((sku) => {
      const lens = CATALOG_SNAPSHOT.lenses.find((candidate) => candidate.sku.toUpperCase() === sku);
      if (!lens) throw new Error(`Lens not found: ${sku}`);
      return scoreLens(lens, sensor, {
        sensorPartNumber: sensor.partNumber,
        ...(input.workingDistanceMm !== undefined ? { workingDistanceMm: input.workingDistanceMm } : {}),
      });
    })
    .sort(sortRecommendations)
    .map((recommendation, index) => ({ ...recommendation, rank: index + 1 }));
}

// ----------------------------------------------------------------------------
// LIVE-backed ranking (preferred). Consumes lens records from the live FoV backend
// so specs and FoV reflect product truth. Scoring logic mirrors the fixture path;
// only the data source differs. Availability is unknown (the FoV backend has no
// stock signal); use read_shopify_products for live availability.
// ----------------------------------------------------------------------------

export function matchLensesToSensorLive(
  lenses: LiveLensInput[],
  input: MatchLensesInput,
): LensRecommendation[] {
  const maxResults = clampMaxResults(input.maxResults);
  return lenses
    .filter((lens) => (input.mount ? lens.mount.toLowerCase() === input.mount.trim().toLowerCase() : true))
    .map((lens) => scoreLiveLens(lens, input))
    .sort(sortRecommendations)
    .slice(0, maxResults)
    .map((recommendation, index) => ({ ...recommendation, rank: index + 1 }));
}

export function recommendLensesForApplicationLive(
  lenses: LiveLensInput[],
  input: RecommendApplicationInput,
): LensRecommendation[] {
  const base = matchLensesToSensorLive(lenses, { ...input, maxResults: lenses.length || 1 });
  return base
    .map((recommendation) => applyApplicationPreferences(recommendation, input))
    .sort(sortRecommendations)
    .slice(0, clampMaxResults(input.maxResults))
    .map((recommendation, index) => ({ ...recommendation, rank: index + 1 }));
}

export function compareLensesLive(
  lenses: LiveLensInput[],
  input: CompareLensesInput,
): LensRecommendation[] {
  const bySku = new Map(lenses.map((lens) => [lens.sku.toUpperCase(), lens]));
  const uniqueSkus = [...new Set(input.lensSkus.map((sku) => sku.trim().toUpperCase()))];
  return uniqueSkus
    .map((sku) => {
      const lens = bySku.get(sku);
      if (!lens) throw new Error(`Lens not found: ${sku}`);
      return scoreLiveLens(lens, {
        sensorPartNumber: input.sensorPartNumber,
        ...(input.workingDistanceMm !== undefined ? { workingDistanceMm: input.workingDistanceMm } : {}),
      });
    })
    .sort(sortRecommendations)
    .map((recommendation, index) => ({ ...recommendation, rank: index + 1 }));
}

function scoreLiveLens(lens: LiveLensInput, input: MatchLensesInput): LensRecommendation {
  let score = 100;
  const tradeoffs: string[] = [];
  const warnings = [...lens.warnings];

  if (lens.imageCircle.clipped) {
    score -= 30;
    tradeoffs.push('Sensor active area exceeds lens image circle; FoV uses clipped sensor dimensions.');
  } else {
    score += 8;
    tradeoffs.push('Lens image circle covers the full sensor active area.');
  }

  if (input.desiredHorizontalFovDeg !== undefined) {
    const delta = Math.abs(lens.fov.horizontalDeg - input.desiredHorizontalFovDeg);
    score -= Math.min(delta * 1.8, 45);
    if (delta <= 5) tradeoffs.push('Horizontal FoV is within 5° of target.');
    else if (delta <= 15) tradeoffs.push('Horizontal FoV is close but may need working-distance adjustment.');
    else tradeoffs.push('Horizontal FoV is far from target; validate before sampling.');
  }

  // Live backend carries no stock signal; availability is unknown here.
  tradeoffs.push('Availability is not included in FoV data; verify with read_shopify_products.');

  if (lens.maxFovDeg > 100) {
    score -= 6;
    tradeoffs.push('Wide/fisheye-style candidate (high max FoV); expect more distortion at the edge.');
  }

  return {
    lens: {
      sku: lens.sku,
      title: `${lens.sku} ${lens.mount} ${lens.lensType}`.trim(),
      handle: lens.sku.toLowerCase(),
      productUrl: lens.productUrl,
      mount: lens.mount,
      lensType: lens.lensType,
      eflMm: lens.eflMm,
      fNumber: lens.fNumber,
      imageCircleMm: lens.imageCircleMm,
      maxFovDeg: lens.maxFovDeg,
      availability: 'unknown',
    },
    score: round(Math.max(0, Math.min(100, score)), 1),
    rank: 0,
    fit: fitFromScore(score),
    fov: lens.fov,
    imageCircle: lens.imageCircle,
    angularResolution: lens.angularResolution,
    tradeoffs,
    warnings,
  };
}

function scoreLens(
  lens: LensCatalogItem,
  sensor: SensorCatalogItem,
  input: MatchLensesInput,
): LensRecommendation {
  const fovResult = computeFov(lens, sensor, input.workingDistanceMm);
  let score = 100;
  const tradeoffs: string[] = [];
  const warnings = [...fovResult.warnings];

  if (fovResult.imageCircle.clipped) {
    score -= 30;
    tradeoffs.push('Sensor active area exceeds lens image circle; FoV uses clipped sensor dimensions.');
  } else {
    score += 8;
    tradeoffs.push('Lens image circle covers the full sensor active area.');
  }

  if (input.desiredHorizontalFovDeg !== undefined) {
    const delta = Math.abs(fovResult.fov.horizontalDeg - input.desiredHorizontalFovDeg);
    score -= Math.min(delta * 1.8, 45);
    if (delta <= 5) tradeoffs.push('Horizontal FoV is within 5° of target.');
    else if (delta <= 15) tradeoffs.push('Horizontal FoV is close but may need working-distance adjustment.');
    else tradeoffs.push('Horizontal FoV is far from target; validate before sampling.');
  }

  if (lens.availability === 'in_stock') {
    score += 4;
    tradeoffs.push('Fixture catalog marks this lens as in stock.');
  } else if (lens.availability === 'unknown') {
    score -= 4;
    tradeoffs.push('Stock status is unknown until Shopify read-only integration is connected.');
  }

  if (lens.fixtureDistortion && Math.abs(lens.fixtureDistortion.beta) > 0.03) {
    score -= 6;
    tradeoffs.push('Fixture distortion marker indicates this is a wide/fisheye-style candidate.');
  }

  return {
    lens: summarizeLensForRecommendation(lens),
    score: round(Math.max(0, Math.min(100, score)), 1),
    rank: 0,
    fit: fitFromScore(score),
    fov: fovResult.fov,
    imageCircle: fovResult.imageCircle,
    angularResolution: fovResult.angularResolution,
    tradeoffs,
    warnings,
  };
}

function applyApplicationPreferences(
  recommendation: LensRecommendation,
  input: RecommendApplicationInput,
): LensRecommendation {
  let score = recommendation.score;
  const tradeoffs = [...recommendation.tradeoffs];

  if (input.requireInStock && recommendation.lens.availability !== 'in_stock') {
    score -= 35;
    tradeoffs.push('Penalized because requireInStock was requested and stock is not confirmed in fixtures.');
  }

  if (input.preferLowDistortion && recommendation.lens.maxFovDeg > 100) {
    score -= 12;
    tradeoffs.push('Penalized for low-distortion preference because the lens is a very wide-FoV candidate.');
  }

  const application = input.application?.toLowerCase() ?? '';
  if (application.includes('robot') || application.includes('embedded')) {
    if (recommendation.lens.mount === 'M12') {
      score += 32;
      tradeoffs.push('M12 form factor fits embedded vision and robotics fixture preference.');
    }
  }
  if (application.includes('machine vision') || application.includes('inspection')) {
    if (recommendation.lens.mount === 'C-mount') {
      score += 18;
      tradeoffs.push('C-mount candidate boosted for machine-vision fixture preference.');
    }
  }

  const boundedScore = round(Math.max(0, Math.min(100, score)), 1);
  return {
    ...recommendation,
    score: boundedScore,
    fit: fitFromScore(boundedScore),
    tradeoffs,
  };
}

function requireSensor(partNumber: string): SensorCatalogItem {
  const sensor = CATALOG_SNAPSHOT.sensors.find(
    (candidate) => candidate.partNumber.toUpperCase() === partNumber.trim().toUpperCase(),
  );
  if (!sensor) throw new Error(`Sensor not found: ${partNumber}`);
  return sensor;
}

function matchesMount(lens: LensCatalogItem, mount?: string): boolean {
  return mount ? lens.mount.toLowerCase() === mount.trim().toLowerCase() : true;
}

function clampMaxResults(maxResults: number | undefined): number {
  return Math.min(Math.max(Math.trunc(maxResults ?? 5), 1), 10);
}

function fitFromScore(score: number): LensRecommendation['fit'] {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'conditional';
  return 'poor';
}

function summarizeLensForRecommendation(lens: LensCatalogItem): LensRecommendation['lens'] {
  return {
    sku: lens.sku,
    title: lens.title,
    handle: lens.handle,
    productUrl: lens.productUrl,
    mount: lens.mount,
    lensType: lens.lensType,
    eflMm: lens.eflMm,
    fNumber: lens.fNumber,
    imageCircleMm: lens.imageCircleMm,
    maxFovDeg: lens.maxFovDeg,
    availability: lens.availability,
  };
}

function sortRecommendations(a: LensRecommendation, b: LensRecommendation): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.lens.sku.localeCompare(b.lens.sku);
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
