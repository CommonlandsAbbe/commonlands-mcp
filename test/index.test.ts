import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/index';

const env: Env = {
  ENVIRONMENT: 'test',
  VERSION: '0.1.0-test',
  GIT_SHA: 'abc123',
};

async function fetchWorker(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`https://mcp.commonlands.test${path}`, init), env);
}

describe('Commonlands MCP Worker Phase 0', () => {
  it('returns deploy metadata from /healthz', async () => {
    const response = await fetchWorker('/healthz');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      service: 'commonlands-mcp',
      environment: 'test',
      version: '0.1.0-test',
      gitSha: 'abc123',
    });
  });

  it('supports MCP initialize smoke test', async () => {
    const response = await fetchWorker('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'vitest', version: '0.0.0' },
        },
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'commonlands-mcp', version: '0.1.0' },
        capabilities: { tools: {}, resources: {} },
      },
    });
  });

  it('returns JSON-RPC method-not-found for business tools in Phase 0', async () => {
    const response = await fetchWorker('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'tools', method: 'tools/list' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      jsonrpc: '2.0',
      id: 'tools',
      error: { code: -32601, message: 'Method not found: tools/list' },
    });
  });

  it('rejects non-json MCP requests before parsing', async () => {
    const response = await fetchWorker('/mcp', { method: 'POST', body: 'not json' });
    const body = await response.json();

    expect(response.status).toBe(415);
    expect(body).toEqual({ error: 'unsupported_media_type' });
  });

  it('returns safe 404 JSON for unknown paths', async () => {
    const response = await fetchWorker('/does-not-exist');
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'not_found' });
  });
});
