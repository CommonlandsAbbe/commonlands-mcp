#!/usr/bin/env node

const endpoint = process.env.MCP_ENDPOINT ?? 'https://mcp.commonlands.com/mcp';
const latencyTargetMs = Number(process.env.CALCULATOR_P95_TARGET_MS ?? '1500');
const enforceLatency = process.env.ENFORCE_LATENCY_TARGET === 'true';

const evals = [
  {
    query: 'find me a 60 degree lens on the AR0234',
    expectedTool: 'match_lens_to_sensor',
    toolName: 'match_lens_to_sensor',
    arguments: { sensor: 'AR0234', desired_horizontal_fov_deg: 60, max_results: 5 },
    assertStructuredContent: (structuredContent) => {
      if (!Array.isArray(structuredContent.recommendations)) {
        throw new Error('expected recommendations array');
      }
    },
  },
  {
    query: 'HFOV of CIL061 on AR0234',
    expectedTool: 'calculate_field_of_view',
    toolName: 'calculate_field_of_view',
    arguments: { lens_sku: 'CIL061', sensor: 'AR0234' },
    assertStructuredContent: (structuredContent) => {
      if (typeof structuredContent.hfov_deg !== 'number') {
        throw new Error('expected numeric hfov_deg');
      }
      if (!structuredContent.rectilinear_comparison || typeof structuredContent.rectilinear_comparison !== 'object') {
        throw new Error('expected rectilinear_comparison object');
      }
    },
  },
];

const failures = [];

const tools = await rpc('tools/list');
const toolNames = new Set(tools.tools?.map((tool) => tool.name) ?? []);

for (const item of evals) {
  if (!toolNames.has(item.expectedTool)) {
    failures.push(`${item.query}: expected tool ${item.expectedTool} is not exposed by tools/list`);
    continue;
  }

  const started = performance.now();
  try {
    const result = await rpc('tools/call', {
      name: item.toolName,
      arguments: item.arguments,
    });
    const durationMs = Math.round(performance.now() - started);
    const structuredContent = result.structuredContent;
    if (!structuredContent || typeof structuredContent !== 'object') {
      throw new Error('expected structuredContent object');
    }
    item.assertStructuredContent(structuredContent);

    const latencyText = durationMs <= latencyTargetMs
      ? `${durationMs}ms <= ${latencyTargetMs}ms target`
      : `${durationMs}ms > ${latencyTargetMs}ms target`;
    console.log(`PASS ${item.expectedTool}: "${item.query}" called ${item.toolName}; ${latencyText}`);
    if (durationMs > latencyTargetMs && enforceLatency) {
      failures.push(`${item.query}: ${item.toolName} latency ${durationMs}ms exceeded ${latencyTargetMs}ms target`);
    }
  } catch (error) {
    failures.push(`${item.query}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} routing eval failure(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

async function rpc(method, params) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-client-name': 'commonlands-routing-eval',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `${method}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`${method} HTTP ${response.status}: ${await response.text()}`);
  }
  const body = await response.json();
  if (body.error) {
    throw new Error(`${method} JSON-RPC error ${body.error.code}: ${body.error.message}`);
  }
  if (!body.result || typeof body.result !== 'object') {
    throw new Error(`${method} missing result object`);
  }
  return body.result;
}
