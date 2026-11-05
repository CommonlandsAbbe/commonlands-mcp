export type PublicValue = string | number | boolean | null | PublicValue[] | { [key: string]: PublicValue };
export interface PublicFieldValue {
  value: PublicValue;
  valueStatus: 'complete' | 'invalid' | 'too_large' | 'reference_only' | 'unsupported';
  truncated: boolean;
}

/** Complete typed values or an explicit omission; never a chopped JSON document. */
export function parsePublicValue(type: string, raw: unknown): PublicFieldValue {
  const result = (value: PublicValue, valueStatus: PublicFieldValue['valueStatus'] = 'complete'): PublicFieldValue => ({ value, valueStatus, truncated: valueStatus === 'too_large' });
  if (type.includes('reference')) return result(null, 'reference_only');
  if (typeof raw !== 'string') return result(null, 'invalid');
  if (raw.length > 16_384) return result(null, 'too_large');
  if (type === 'single_line_text_field' || type === 'multi_line_text_field') return result(sanitizeText(raw));
  if (type === 'url') return result(publicUrl(raw));
  try {
    const value: unknown = JSON.parse(raw);
    if (type.startsWith('list.') && !Array.isArray(value)) return result(null, 'invalid');
    if (type === 'number_integer' && !Number.isSafeInteger(value)) return result(null, 'invalid');
    if (type === 'number_decimal' && (typeof value !== 'number' || !Number.isFinite(value))) return result(null, 'invalid');
    if (type === 'boolean' && typeof value !== 'boolean') return result(null, 'invalid');
    if (!type.startsWith('list.') && !['json', 'rich_text_field', 'number_integer', 'number_decimal', 'boolean', 'dimension', 'weight', 'volume', 'rating', 'money'].includes(type)) return result(null, 'unsupported');
    return result(sanitizeValue(value, 0));
  } catch { return result(null, 'invalid'); }
}

function sanitizeValue(value: unknown, depth: number): PublicValue {
  if (depth > 20) throw new Error('value nesting limit');
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(alpha|beta|.*token.*|.*secret.*)$/i.test(key)).map(([key, item]) => [key, sanitizeValue(item, depth + 1)]));
  throw new Error('unsupported value');
}

function publicUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && ['commonlands.com', 'cdn.shopify.com'].includes(url.hostname) ? value : null;
  } catch { return null; }
}

function sanitizeText(value: string): string {
  return value.replace(/shp(?:at|ss)_[a-zA-Z0-9_-]+/g, '[redacted]')
    .replace(/(?:access[_-]?token|client[_-]?(?:secret|id))\s*[:=]\s*[^\s,}]+/gi, '[redacted]')
    .replace(/https?:\/\/[^\s<>"']+/gi, url => publicUrl(url) ?? '[restricted link]');
}

export function pairPublicFields(fields: Array<{ key: string } & PublicFieldValue>, left: string, right: string) {
  const a = fields.find(field => field.key === left);
  const b = fields.find(field => field.key === right);
  if (!a && !b) return { status: 'unpublished', pairs: [] };
  if (a?.valueStatus !== 'complete' || b?.valueStatus !== 'complete' || !Array.isArray(a.value) || !Array.isArray(b.value) || a.value.length !== b.value.length || !a.value.every(item => typeof item === 'string') || !b.value.every(item => typeof item === 'string')) {
    return { status: 'invalid_or_incomplete', pairs: [] };
  }
  const rightValues = b.value;
  return { status: 'complete', pairs: a.value.map((value, index) => ({ [left]: value, [right]: rightValues[index]! })) };
}
