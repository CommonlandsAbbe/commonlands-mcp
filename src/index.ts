export interface Env {
  ENVIRONMENT?: string;
  VERSION?: string;
  GIT_SHA?: string;
}

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

interface JsonRpcError {
  code: number;
  message: string;
}

const SERVER_INFO = {
  name: 'commonlands-mcp',
  version: '0.1.0',
} as const;

const PROTOCOL_VERSION = '2024-11-05';

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init.headers,
    },
  });
}

function methodNotAllowed(): Response {
  return json({ error: 'method_not_allowed' }, { status: 405, headers: { allow: 'GET, POST' } });
}

function health(env: Env): Response {
  return json({
    ok: true,
    service: SERVER_INFO.name,
    environment: env.ENVIRONMENT ?? 'unknown',
    version: env.VERSION ?? SERVER_INFO.version,
    gitSha: env.GIT_SHA ?? 'unknown',
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rpcError(id: unknown, error: JsonRpcError): Response {
  return json({ jsonrpc: '2.0', id: id ?? null, error }, { status: 200 });
}

function validateRpcRequest(payload: unknown): JsonRpcRequest | JsonRpcError {
  if (!isRecord(payload)) {
    return { code: -32600, message: 'Invalid Request' };
  }

  if (payload.jsonrpc !== '2.0' || typeof payload.method !== 'string') {
    return { code: -32600, message: 'Invalid Request' };
  }

  return payload;
}

function initializeResponse(id: unknown): Response {
  return json({
    jsonrpc: '2.0',
    id: id ?? null,
    result: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        tools: {},
        resources: {},
      },
      serverInfo: SERVER_INFO,
      instructions:
        'Commonlands MCP Phase 0 smoke endpoint. Read-only business tools are not implemented yet.',
    },
  });
}

async function handleMcp(request: Request): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return json({ error: 'unsupported_media_type' }, { status: 415 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return rpcError(null, { code: -32700, message: 'Parse error' });
  }

  const parsed = validateRpcRequest(payload);
  if ('code' in parsed) {
    const id = isRecord(payload) ? payload.id : null;
    return rpcError(id, parsed);
  }

  if (parsed.method === 'initialize') {
    return initializeResponse(parsed.id);
  }

  return rpcError(parsed.id, {
    code: -32601,
    message: `Method not found: ${parsed.method}`,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/healthz') {
      if (request.method !== 'GET') return methodNotAllowed();
      return health(env);
    }

    if (url.pathname === '/mcp') {
      if (request.method !== 'POST') return methodNotAllowed();
      return handleMcp(request);
    }

    return json({ error: 'not_found' }, { status: 404 });
  },
};
