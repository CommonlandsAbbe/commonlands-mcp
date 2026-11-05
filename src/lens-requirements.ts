import { normalizeMountText } from './product-resolver';

const ENGINEERING_EVIDENCE = {
  mtf: 'MTF curves with spatial frequency, field position, orientation, wavelength, aperture, focus and measured/nominal status',
  cra: 'Chief-ray angle versus image height with wavelength and configuration',
  relative_illumination: 'Relative illumination versus image height with aperture and spectral conditions',
  spectral_transmission: 'Transmission data for the exact filter and lens configuration',
  mechanical_fit: 'Holder dimensions, thread engagement and rear clearance with reference planes',
  environmental: 'Tested configuration, temperature, focus shift and ingress-test scope',
  depth_of_field: 'Circle-of-confusion criterion, working-distance reference and validated focus model',
} as const;
type EvidenceName = keyof typeof ENGINEERING_EVIDENCE;
type Axis = 'horizontal' | 'vertical' | 'diagonal';
type Range = { min: number; max: number };
export interface LensRequirements {
  horizontal_fov_deg?: Range;
  vertical_fov_deg?: Range;
  diagonal_fov_deg?: Range;
  full_sensor_coverage?: true;
  mount?: string;
  distortion?: { axis: Axis; max_absolute_percent: number };
  max_weight_g?: number;
  max_diameter_mm?: number;
  require_evidence?: EvidenceName[];
}

const rangeSchema = {
  type: 'object', required: ['min', 'max'], additionalProperties: false,
  properties: { min: { type: 'number', exclusiveMinimum: 0, maximum: 360 }, max: { type: 'number', exclusiveMinimum: 0, maximum: 360 } },
};
export const LENS_REQUIREMENTS_SCHEMA = {
  type: 'object', minProperties: 1, additionalProperties: false,
  properties: {
    horizontal_fov_deg: rangeSchema, vertical_fov_deg: rangeSchema, diagonal_fov_deg: rangeSchema,
    full_sensor_coverage: { const: true, description: 'Require the image circle to cover the full sensor diagonal. Does not establish edge image quality.' },
    mount: { type: 'string', description: 'M12/S-mount, C-mount/C FA, or CS-mount. Nominal interface only; does not establish mechanical fit.' },
    distortion: { type: 'object', required: ['axis', 'max_absolute_percent'], additionalProperties: false, properties: {
      axis: { enum: ['horizontal', 'vertical', 'diagonal'] }, max_absolute_percent: { type: 'number', minimum: 0, maximum: 100 },
    } },
    max_weight_g: { type: 'number', exclusiveMinimum: 0, description: 'Unknown unless the source explicitly supplies grams; unitless numbers are not interpreted.' },
    max_diameter_mm: { type: 'number', exclusiveMinimum: 0, description: 'Unknown unless the source explicitly supplies millimetres. Does not establish rear clearance.' },
    require_evidence: { type: 'array', minItems: 1, maxItems: 7, uniqueItems: true, items: { enum: Object.keys(ENGINEERING_EVIDENCE) }, description: 'Request engineering confirmation. These structured datasets are not currently supplied by the public backend contract.' },
  },
} as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function mountName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const mount = normalizeMountText(value).trim();
  if (mount === 'm12') return 'M12';
  if (mount === 'cmount') return 'C-mount';
  if (/^cs(?:[ -]?mount)?$/.test(mount)) return 'CS-mount';
  return null;
}

/** Validate at dispatch, not just in tools/list: clients can bypass JSON Schema. */
export function validateLensRequirements(value: unknown): string | null {
  if (!record(value) || !Object.keys(value).length) return 'requirements must contain at least one check';
  for (const [key, item] of Object.entries(value)) {
    if (!Object.hasOwn(LENS_REQUIREMENTS_SCHEMA.properties, key)) return 'unsupported requirement';
    if (key.endsWith('_fov_deg')) {
      if (!record(item) || !exactKeys(item, ['min', 'max']) || !finite(item.min) || !finite(item.max)
        || item.min <= 0 || item.max > 360 || item.min > item.max) return 'FoV ranges require 0 < min <= max <= 360 degrees';
    } else if (key === 'full_sensor_coverage' && item !== true) return 'full_sensor_coverage must be true when requested';
    else if (key === 'mount' && mountName(item) === null) return 'mount must be M12/S-mount, C-mount/C FA, or CS-mount';
    else if (key === 'distortion') {
      if (!record(item) || !exactKeys(item, ['axis', 'max_absolute_percent'])
        || !['horizontal', 'vertical', 'diagonal'].includes(String(item.axis))
        || !finite(item.max_absolute_percent) || item.max_absolute_percent < 0 || item.max_absolute_percent > 100) {
        return 'distortion requires an axis and max_absolute_percent between 0 and 100';
      }
    } else if ((key === 'max_weight_g' || key === 'max_diameter_mm') && (!finite(item) || item <= 0)) return 'mass and diameter limits must be positive numbers';
    else if (key === 'require_evidence' && (!Array.isArray(item) || item.length < 1 || item.length > 7
      || new Set(item).size !== item.length || !item.every(name => typeof name === 'string' && Object.hasOwn(ENGINEERING_EVIDENCE, name)))) {
      return 'require_evidence must contain distinct supported evidence names';
    }
  }
  return null;
}

interface Check {
  requirement: string;
  status: 'satisfied' | 'failed' | 'unknown';
  requested: unknown;
  observed: number | string | boolean | null;
  unit: 'deg' | '%' | 'g' | 'mm' | null;
  source: string | null;
  sourceRevision: null;
  reason: string;
}
export interface AssessmentInput {
  lensSku: string;
  sensor: { partNumber: string; activeAreaMm: { width: number; height: number }; source: 'live' | 'fixture' | 'custom' };
  requirements: LensRequirements;
  // These records have already passed the public optics sanitizer in index.ts.
  lens: Record<string, unknown>;
  optics: Record<string, unknown>;
}

/** Only explicit canonical units are accepted. Never infer units from field names. */
function explicitMeasurement(raw: unknown, unit: 'g' | 'mm'): number | null {
  if (typeof raw !== 'string') return null;
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(g|mm)$/i);
  if (!match || match[2]?.toLowerCase() !== unit) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Evaluate evidence, without recomputing FoV or promoting catalog labels to test data. */
export function assessLensRequirements(input: AssessmentInput) {
  const { lensSku, sensor, requirements, lens, optics } = input;
  const source = 'aws-lambda-dynamodb-readonly';
  const checks: Check[] = [];
  const add = (requirement: string, requested: unknown, observed: Check['observed'], unit: Check['unit'], passes: boolean, reason: string) => {
    checks.push({ requirement, requested, observed, unit, status: observed === null ? 'unknown' : passes ? 'satisfied' : 'failed',
      source: observed === null ? null : source, sourceRevision: null, reason });
  };
  for (const [key, field] of [['horizontal_fov_deg', 'hfov_deg'], ['vertical_fov_deg', 'vfov_deg'], ['diagonal_fov_deg', 'dfov_deg']] as const) {
    const range = requirements[key];
    if (!range) continue;
    const raw = optics[field];
    const value = finite(raw) && raw > 0 && raw <= 360 ? raw : null;
    add(key, range, value, 'deg', value !== null && value >= range.min && value <= range.max,
      value === null ? 'No valid FoV returned for this axis.' : 'Inclusive range compared with the existing live FoV result; no interpolation or recalculation.');
  }
  if (requirements.full_sensor_coverage) {
    const value = typeof optics.coverage_ok === 'boolean' ? optics.coverage_ok : null;
    add('full_sensor_coverage', true, value, null, value === true,
      value === null ? 'Image-circle coverage is unavailable.' : 'Existing image-circle coverage result; does not establish MTF, illumination or mechanical fit.');
  }
  if (requirements.mount) {
    const value = mountName(lens.mount);
    add('mount', mountName(requirements.mount), value, null, value === mountName(requirements.mount),
      value === null ? 'No recognized nominal mount in the public lens record.' : 'Nominal mount comparison only; C-mount and CS-mount remain distinct.');
  }
  if (requirements.distortion) {
    const distortion = record(lens.distortion) ? lens.distortion : {};
    const raw = distortion[requirements.distortion.axis];
    const value = distortion.status === 'calculated' && finite(raw) ? raw : null;
    add('distortion', requirements.distortion, value, '%', value !== null && Math.abs(value) <= requirements.distortion.max_absolute_percent,
      value === null ? 'No calculated distortion for the requested axis. Display strings and other axes cannot satisfy this requirement.' : 'Absolute value of the backend calculated distortion for the requested axis; not a measured acceptance test.');
  }
  for (const [key, field, unit] of [['max_weight_g', 'weight', 'g'], ['max_diameter_mm', 'max_diameter', 'mm']] as const) {
    const limit = requirements[key];
    if (limit === undefined) continue;
    const value = explicitMeasurement(lens[field], unit);
    add(key, limit, value, unit, value !== null && value <= limit,
      value === null ? `The public ${field} field is absent or lacks an explicit supported ${unit} unit; no units are inferred.` : 'Explicit source unit at the optical part-number level; verify the selected purchasable configuration separately.');
  }
  for (const name of requirements.require_evidence ?? []) {
    add(name, 'required', null, null, false, `${ENGINEERING_EVIDENCE[name]} are not supplied by the current public backend contract.`);
  }
  const missingData = checks.filter(check => check.status === 'unknown').map(check => ({ requirement: check.requirement, reason: check.reason }));
  const failed = checks.filter(check => check.status === 'failed').map(check => check.requirement);
  return {
    schemaVersion: 'optics.requirements.v1', evaluatedAt: new Date().toISOString(),
    scope: 'optical_part_number_not_selected_shopify_variant', lensSku, sensor,
    status: failed.length ? 'fails_requested_requirements' : missingData.length || sensor.source === 'fixture' ? 'needs_confirmation' : 'satisfies_requested_checks',
    checks, missingData, failedRequirements: failed,
    provenance: { source, method: optics.method, adapterModelRevision: 'lambda-dynamodb-fov-0.1.0', sourceDataRevision: null, sensorSource: sensor.source },
    optics: {
      hfov_deg: optics.hfov_deg, vfov_deg: optics.vfov_deg, dfov_deg: optics.dfov_deg,
      image_circle_mm: optics.image_circle_mm, sensor_diagonal_mm: optics.sensor_diagonal_mm,
      coverage_ok: optics.coverage_ok, method: optics.method, distortion_status: optics.distortion_status,
    },
    limitations: [
      'Only requested checks are assessed. Satisfaction is conditional on the supplied/resolved sensor dimensions and public optical-part evidence; it is not engineering qualification.',
      'The backend does not provide a source dataset revision. adapterModelRevision identifies the MCP adapter model, not a verified source-data revision.',
      'Nominal pixel-pitch and resolution ratings are not measured MTF. Image-circle coverage and mount labels do not establish mechanical fit or edge image quality.',
      ...(sensor.source === 'fixture' ? ['Sensor dimensions came from the labeled reference fixture fallback; confirm them before final selection.'] : []),
      'Resolve the family with resolve_lens_product, select an exact full SKU, then use get_purchase_options for current Shopify inventory and price. This report makes no purchasing recommendation.',
    ],
  };
}
