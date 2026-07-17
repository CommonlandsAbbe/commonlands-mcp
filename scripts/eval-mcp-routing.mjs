#!/usr/bin/env node

const endpoint = process.env.MCP_ENDPOINT ?? 'https://mcp.commonlands.com/mcp';
const latencyTargetMs = Number(process.env.CALCULATOR_P95_TARGET_MS ?? '1500');
const enforceLatency = process.env.ENFORCE_LATENCY_TARGET === 'true';
const warmSampleCount = Number(process.env.WARM_LATENCY_SAMPLES ?? '20');

if (!Number.isInteger(warmSampleCount) || warmSampleCount < 1) {
  throw new Error('WARM_LATENCY_SAMPLES must be a positive integer');
}

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

  try {
    const samples = [];
    for (let sampleIndex = 0; sampleIndex <= warmSampleCount; sampleIndex += 1) {
      const started = performance.now();
      const result = await rpc('tools/call', {
        name: item.toolName,
        arguments: item.arguments,
      });
      const durationMs = Math.round(performance.now() - started);
      const structuredContent = result.structuredContent;
      if (!structuredContent || typeof structuredContent !== 'object') {
        throw new Error(`sample ${sampleIndex + 1}: expected structuredContent object`);
      }
      item.assertStructuredContent(structuredContent);
      samples.push(durationMs);
    }

    const [firstCallMs, ...warmSamples] = samples;
    const warmP95Ms = percentile(warmSamples, 0.95);
    const latencyText = warmP95Ms <= latencyTargetMs
      ? `${warmP95Ms}ms <= ${latencyTargetMs}ms target`
      : `${warmP95Ms}ms > ${latencyTargetMs}ms target`;
    console.log(
      `PASS ${item.expectedTool}: "${item.query}" called ${item.toolName}; `
      + `first-call ${firstCallMs}ms (cold-start candidate, excluded); `
      + `warm p95 ${latencyText} across ${warmSampleCount} samples`,
    );
    if (warmP95Ms > latencyTargetMs && enforceLatency) {
      failures.push(
        `${item.query}: ${item.toolName} warm p95 ${warmP95Ms}ms exceeded ${latencyTargetMs}ms target `
        + `across ${warmSampleCount} samples`,
      );
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

function percentile(samples, percentileValue) {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[index];
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
