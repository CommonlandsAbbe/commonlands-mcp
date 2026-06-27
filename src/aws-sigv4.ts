/**
 * Minimal AWS Signature V4 signer for DynamoDB calls from a Cloudflare Worker.
 *
 * The Worker runs outside AWS so it cannot assume an IAM role; it authenticates
 * with a read-only IAM user's access key (stored as Worker secrets). This module
 * signs a single DynamoDB JSON (x-amz-json-1.0) request using Web Crypto only, so
 * the repo keeps zero runtime dependencies and stays unit-testable offline.
 *
 * Scope is deliberately narrow: POST to the DynamoDB endpoint with an X-Amz-Target
 * operation and a JSON body. It is not a general-purpose AWS client.
 */

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface SignedDynamoRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

const SERVICE = 'dynamodb';
const ENCODER = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', ENCODER.encode(input));
  return toHex(digest);
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, ENCODER.encode(data));
}

function amzDate(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  // iso is like 20260627T193000Z
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

/**
 * Sign a DynamoDB operation (for example "Scan", "Query", "GetItem").
 * `target` is the bare operation name; the X-Amz-Target prefix is added here.
 */
export async function signDynamoRequest(options: {
  region: string;
  credentials: AwsCredentials;
  target: string;
  body: unknown;
  now?: Date;
}): Promise<SignedDynamoRequest> {
  const { region, credentials, target } = options;
  const host = `dynamodb.${region}.amazonaws.com`;
  const endpoint = `https://${host}/`;
  const payload = JSON.stringify(options.body ?? {});
  const { amzDate: amzDateStr, dateStamp } = amzDate(options.now ?? new Date());

  const xAmzTarget = `DynamoDB_20120810.${target}`;
  const contentType = 'application/x-amz-json-1.0';

  const payloadHash = await sha256Hex(payload);

  // Canonical headers must be sorted by lowercased name.
  const canonicalHeaderEntries: Array<[string, string]> = [
    ['content-type', contentType],
    ['host', host],
    ['x-amz-content-sha256', payloadHash],
    ['x-amz-date', amzDateStr],
    ['x-amz-target', xAmzTarget],
  ];
  if (credentials.sessionToken) {
    canonicalHeaderEntries.push(['x-amz-security-token', credentials.sessionToken]);
  }
  canonicalHeaderEntries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const canonicalHeaders = canonicalHeaderEntries.map(([k, v]) => `${k}:${v}\n`).join('');
  const signedHeaders = canonicalHeaderEntries.map(([k]) => k).join(';');

  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDateStr,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = await hmac(ENCODER.encode(`AWS4${credentials.secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, SERVICE);
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = toHex(await hmac(kSigning, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {
    'content-type': contentType,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDateStr,
    'x-amz-target': xAmzTarget,
    authorization,
  };
  if (credentials.sessionToken) {
    headers['x-amz-security-token'] = credentials.sessionToken;
  }

  return { url: endpoint, headers, body: payload };
}
