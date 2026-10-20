// Preserve source names and scalar values; do not infer units or mechanical
// reference surfaces from a field name. Never spread an entire backend record.
export interface LensSpecifications {
  weight?: number | string;
  pixelpitchres?: number | string;
  flange_dist?: number | string;
  mbfl?: number | string;
  max_diameter?: number | string;
}

export function lensSpecifications(source: LensSpecifications): LensSpecifications {
  const result: LensSpecifications = {};
  for (const key of ['weight', 'pixelpitchres', 'flange_dist', 'mbfl', 'max_diameter'] as const) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
    else if (typeof value === 'string' && value.trim() && value.length <= 200) result[key] = value;
  }
  return result;
}
