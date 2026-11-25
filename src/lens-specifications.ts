import { normalizeMountText } from './product-resolver';

type TrackLengthReference = 'front_to_image_plane' | 'front_to_mounting_flange' | 'unknown';

export interface LensSpecifications {
  weight?: number | string;
  pixelpitchres?: number | string;
  flange_dist?: number | string;
  mbfl?: number | string;
  max_diameter?: number | string;
  ttl?: number | string;
  ttlReference?: TrackLengthReference;
  totalTrackLengthMm?: number | null;
}

function positiveMm(value: unknown): number | null {
  const decimal = typeof value === 'string' && value.length <= 200
    ? /^(\d+(?:\.\d+)?|\.\d+)\s*(?:mm)?$/i.exec(value.trim())?.[1] : undefined;
  const mm = typeof value === 'number' ? value : Number(decimal);
  return Number.isFinite(mm) && mm > 0 ? mm : null;
}

// Raw LensList rows use different end planes for the same ttl column.
// A backend with an explicitly identified reference can also send a normalized row.
function trackLengthReference(mount: unknown, reference: unknown): TrackLengthReference {
  if (reference !== undefined) {
    return reference === 'front_to_image_plane' || reference === 'front_to_mounting_flange' ? reference : 'unknown';
  }
  switch (typeof mount === 'string' && normalizeMountText(mount.trim())) {
    case 'm12': return 'front_to_image_plane';
    case 'cmount': return 'front_to_mounting_flange';
    default: return 'unknown';
  }
}

export function lensSpecifications(source: LensSpecifications & { mount?: unknown }): LensSpecifications {
  const result: LensSpecifications = { totalTrackLengthMm: null };
  for (const key of ['weight', 'pixelpitchres', 'flange_dist', 'mbfl', 'max_diameter'] as const) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
    else if (typeof value === 'string' && value.trim() && value.length <= 200) result[key] = value;
  }
  if (source.ttl === undefined) return result;
  const length = positiveMm(source.ttl);
  if (length === null) return result;
  result.ttl = source.ttl;
  result.ttlReference = trackLengthReference(source.mount, source.ttlReference);
  if (result.ttlReference === 'front_to_image_plane') result.totalTrackLengthMm = length;
  if (result.ttlReference === 'front_to_mounting_flange') {
    const flangeToImage = positiveMm(source.flange_dist);
    if (flangeToImage !== null && Number.isFinite(length + flangeToImage)) {
      result.totalTrackLengthMm = Number((length + flangeToImage).toPrecision(15));
    }
  }
  return result;
}
