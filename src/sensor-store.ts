/**
 * Live sensor catalog backed by the Commonlands DynamoDB sensor table.
 *
 * The Worker reads the table with a read-only IAM user (SigV4-signed Scan) and
 * caches the result in memory for the isolate's lifetime. This replaces the small
 * hardcoded sensor fixture as the source of truth for pixel size/count, so FoV
 * math uses real sensor specs and get_sensor_specs resolves any catalogued sensor.
 *
 * Read-only by construction: the only DynamoDB action used is Scan. The IAM policy
 * attached to the Worker's user grants no write actions.
 */

import { signDynamoRequest, type AwsCredentials } from './aws-sigv4';
import type { SensorCatalogItem } from './catalog';

export interface SensorStoreEnv {
  SENSOR_DDB_TABLE?: string;
  SENSOR_DDB_REGION?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_SESSION_TOKEN?: string;
}

// DynamoDB attribute-value helpers (we only need string/number scalars).
type DdbValue = { S?: string; N?: string };
type DdbItem = Record<string, DdbValue>;

const MICRONS_PER_MM = 1000;
const SCAN_PAGE_LIMIT = 1000;
const CACHE_TTL_MS = 5 * 60 * 1000;

interface SensorCache {
  sensors: SensorCatalogItem[];
  byPartNumber: Map<string, SensorCatalogItem>;
  fetchedAtMs: number;
}

let cache: SensorCache | null = null;
let inFlight: Promise<SensorCache> | null = null;

export function isSensorStoreConfigured(env: SensorStoreEnv): boolean {
  return Boolean(
    env.SENSOR_DDB_TABLE &&
      env.SENSOR_DDB_REGION &&
      env.AWS_ACCESS_KEY_ID &&
      env.AWS_SECRET_ACCESS_KEY,
  );
}

function ddbString(item: DdbItem, key: string): string | undefined {
  const value = item[key];
  return value && typeof value.S === 'string' ? value.S : undefined;
}

function ddbNumber(item: DdbItem, key: string): number | undefined {
  const value = item[key];
  if (!value) return undefined;
  if (typeof value.N === 'string' && value.N.trim() !== '') {
    const parsed = Number(value.N);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (typeof value.S === 'string' && value.S.trim() !== '') {
    const parsed = Number(value.S);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Map a raw DynamoDB sensor row into the catalog shape.
 *
 * Table attributes (Commonlands SensorData-*): sensortype (part number, e.g.
 * "IMX477"), sensormfg (manufacturer), sensorhpix / sensorvpix (active pixel
 * counts), sensorpitch (pixel pitch in microns). Active-area mm is derived as
 * pixels * pitch, which is what the FoV math consumes.
 */
function mapSensorItem(item: DdbItem): SensorCatalogItem | null {
  const partNumber = ddbString(item, 'sensortype');
  const widthPx = ddbNumber(item, 'sensorhpix');
  const heightPx = ddbNumber(item, 'sensorvpix');
  const pixelSizeUm = ddbNumber(item, 'sensorpitch');

  if (!partNumber || widthPx === undefined || heightPx === undefined || pixelSizeUm === undefined) {
    return null;
  }

  const manufacturer = ddbString(item, 'sensormfg') ?? 'unknown';
  const widthMm = (widthPx * pixelSizeUm) / MICRONS_PER_MM;
  const heightMm = (heightPx * pixelSizeUm) / MICRONS_PER_MM;

  return {
    partNumber,
    manufacturer,
    name: manufacturer !== 'unknown' ? `${manufacturer} ${partNumber}` : partNumber,
    resolution: { widthPx, heightPx },
    activeAreaMm: {
      width: Number(widthMm.toFixed(4)),
      height: Number(heightMm.toFixed(4)),
    },
    pixelSizeUm,
  };
}

async function scanSensorTable(env: SensorStoreEnv): Promise<SensorCatalogItem[]> {
  const credentials: AwsCredentials = {
    accessKeyId: env.AWS_ACCESS_KEY_ID as string,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY as string,
    ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {}),
  };

  const sensors: SensorCatalogItem[] = [];
  let exclusiveStartKey: DdbItem | undefined;
  let pages = 0;

  do {
    const signed = await signDynamoRequest({
      region: env.SENSOR_DDB_REGION as string,
      credentials,
      target: 'Scan',
      body: {
        TableName: env.SENSOR_DDB_TABLE,
        Limit: SCAN_PAGE_LIMIT,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      },
    });

    const response = await fetch(signed.url, {
      method: 'POST',
      headers: signed.headers,
      body: signed.body,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`DynamoDB sensor scan failed (HTTP ${response.status}): ${detail.slice(0, 200)}`);
    }

    const parsed = (await response.json()) as { Items?: DdbItem[]; LastEvaluatedKey?: DdbItem };
    for (const item of parsed.Items ?? []) {
      const mapped = mapSensorItem(item);
      if (mapped) sensors.push(mapped);
    }

    exclusiveStartKey = parsed.LastEvaluatedKey;
    pages += 1;
  } while (exclusiveStartKey && pages < 20);

  return sensors;
}

async function loadCache(env: SensorStoreEnv): Promise<SensorCache> {
  const sensors = await scanSensorTable(env);
  const byPartNumber = new Map<string, SensorCatalogItem>();
  for (const sensor of sensors) {
    byPartNumber.set(sensor.partNumber.trim().toLowerCase(), sensor);
  }
  return { sensors, byPartNumber, fetchedAtMs: Date.now() };
}

async function getCache(env: SensorStoreEnv): Promise<SensorCache> {
  if (cache && Date.now() - cache.fetchedAtMs < CACHE_TTL_MS) {
    return cache;
  }
  if (inFlight) return inFlight;

  inFlight = loadCache(env)
    .then((loaded) => {
      cache = loaded;
      return loaded;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * Resolve one sensor by part number from the DynamoDB table.
 * Returns undefined when the store is unconfigured or the part is not present.
 */
export async function getLiveSensorByPartNumber(
  env: SensorStoreEnv,
  partNumber: string,
): Promise<SensorCatalogItem | undefined> {
  if (!isSensorStoreConfigured(env)) return undefined;
  const { byPartNumber } = await getCache(env);
  return byPartNumber.get(partNumber.trim().toLowerCase());
}

/** List every sensor in the DynamoDB table (used for actionable error hints). */
export async function listLiveSensors(env: SensorStoreEnv): Promise<SensorCatalogItem[]> {
  if (!isSensorStoreConfigured(env)) return [];
  const { sensors } = await getCache(env);
  return sensors;
}

/** Test-only: clear the in-memory cache between cases. */
export function __resetSensorStoreCacheForTests(): void {
  cache = null;
  inFlight = null;
}
