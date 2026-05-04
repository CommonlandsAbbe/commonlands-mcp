import type { LensCatalogItem, SensorCatalogItem } from './catalog';

export interface FovResult {
  schemaVersion: 'optics.fov.v1';
  modelVersion: 'fixture-polynomial-fov-0.1.0';
  correctionStatus: 'fixture_parity_scaffold';
  lens: {
    sku: string;
    eflMm: number;
    projectionModel: LensCatalogItem['projectionModel'];
    coefficientCount: number;
    fixtureDistortion?: LensCatalogItem['fixtureDistortion'];
  };
  sensor: {
    partNumber: string;
    resolution: SensorCatalogItem['resolution'];
    activeAreaMm: SensorCatalogItem['activeAreaMm'];
  };
  imageCircle: {
    clipped: boolean;
    usedWidthMm: number;
    usedHeightMm: number;
    usedDiagonalMm: number;
    lensImageCircleMm: number;
  };
  fov: {
    horizontalDeg: number;
    verticalDeg: number;
    diagonalDeg: number;
    sceneWidthMm?: number;
    sceneHeightMm?: number;
    workingDistanceMm?: number;
  };
  angularResolution: {
    horizontalPxPerDeg: number;
    verticalPxPerDeg: number;
  };
  assumptions: string[];
  warnings: string[];
}

const MODEL_VERSION = 'fixture-polynomial-fov-0.1.0' as const;

export function computeFov(
  lens: LensCatalogItem,
  sensor: SensorCatalogItem,
  workingDistanceMm?: number,
): FovResult {
  const clippedDimensions = clipSensorToImageCircle(sensor.activeAreaMm, lens.imageCircleMm);
  const horizontalRaw = rectilinearFovDeg(clippedDimensions.width, lens.eflMm);
  const verticalRaw = rectilinearFovDeg(clippedDimensions.height, lens.eflMm);
  const diagonalRaw = rectilinearFovDeg(clippedDimensions.diagonal, lens.eflMm);
  const capScale = diagonalRaw > lens.maxFovDeg ? lens.maxFovDeg / diagonalRaw : 1;

  const horizontalDeg = round(horizontalRaw * capScale, 1);
  const verticalDeg = round(verticalRaw * capScale, 1);
  const diagonalDeg = round(Math.min(diagonalRaw, lens.maxFovDeg), 1);
  const fov: FovResult['fov'] = { horizontalDeg, verticalDeg, diagonalDeg };

  if (workingDistanceMm !== undefined) {
    fov.workingDistanceMm = workingDistanceMm;
    fov.sceneWidthMm = round(sceneSizeMm(workingDistanceMm, horizontalDeg), 1);
    fov.sceneHeightMm = round(sceneSizeMm(workingDistanceMm, verticalDeg), 1);
  }

  const warnings = [
    'Fixture-backed optics are for MCP contract/parity scaffolding; verify against production calculator before customer-facing launch.',
  ];

  if (clippedDimensions.clipped) {
    warnings.push(
      `Sensor active area is clipped by the ${lens.imageCircleMm}mm lens image circle before FoV calculation.`,
    );
  }

  if (capScale < 1) {
    warnings.push(`FoV is capped by the lens maximum field of view (${lens.maxFovDeg}°).`);
  }

  return {
    schemaVersion: 'optics.fov.v1',
    modelVersion: MODEL_VERSION,
    correctionStatus: 'fixture_parity_scaffold',
    lens: {
      sku: lens.sku,
      eflMm: lens.eflMm,
      projectionModel: lens.projectionModel,
      coefficientCount: lens.coefficientCount,
    },
    sensor: {
      partNumber: sensor.partNumber,
      resolution: sensor.resolution,
      activeAreaMm: sensor.activeAreaMm,
    },
    imageCircle: {
      clipped: clippedDimensions.clipped,
      usedWidthMm: round(clippedDimensions.width, 3),
      usedHeightMm: round(clippedDimensions.height, 3),
      usedDiagonalMm: round(clippedDimensions.diagonal, 3),
      lensImageCircleMm: lens.imageCircleMm,
    },
    fov,
    angularResolution: {
      horizontalPxPerDeg: round(sensor.resolution.widthPx / horizontalDeg, 1),
      verticalPxPerDeg: round(sensor.resolution.heightPx / verticalDeg, 1),
    },
    assumptions: [
      'Uses fixture coefficients until real AppSync/DynamoDB projection data is connected.',
      'Uses the legacy calculator pattern: clip sensor by image circle, compute FoV from effective focal length, cap by max_fov, and report angular resolution as pixels per degree.',
      'Coefficient convention/sign/units must be replaced by production parity fixtures before customer-facing launch.',
    ],
    warnings,
  };
}

function clipSensorToImageCircle(
  activeAreaMm: SensorCatalogItem['activeAreaMm'],
  imageCircleMm: number,
): { width: number; height: number; diagonal: number; clipped: boolean } {
  const diagonal = Math.hypot(activeAreaMm.width, activeAreaMm.height);
  if (diagonal <= imageCircleMm) {
    return { width: activeAreaMm.width, height: activeAreaMm.height, diagonal, clipped: false };
  }

  const scale = imageCircleMm / diagonal;
  return {
    width: activeAreaMm.width * scale,
    height: activeAreaMm.height * scale,
    diagonal: imageCircleMm,
    clipped: true,
  };
}

function rectilinearFovDeg(sensorDimensionMm: number, eflMm: number): number {
  return radiansToDegrees(2 * Math.atan(sensorDimensionMm / (2 * eflMm)));
}

function sceneSizeMm(workingDistanceMm: number, fovDeg: number): number {
  return 2 * workingDistanceMm * Math.tan(degreesToRadians(fovDeg) / 2);
}

function radiansToDegrees(radians: number): number {
  return radians * (180 / Math.PI);
}

function degreesToRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
