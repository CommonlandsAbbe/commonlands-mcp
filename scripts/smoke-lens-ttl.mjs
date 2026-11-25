// Read-only check of the deployed Lambda-to-Worker contract for both mount conventions.
import assert from 'node:assert/strict';

const endpoint = process.argv[2] ?? 'https://mcp.commonlands.com/mcp';
const cases = [
  { sku: 'CIL250', totalMm: 30 },
  { sku: 'CIL514', totalMm: 61.52 },
];

for (const { sku, totalMm } of cases) {
  try {
    const response = await globalThis.fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: sku, method: 'tools/call',
        params: { name: 'search_lens_catalog', arguments: { query: sku } } }),
      signal: globalThis.AbortSignal.timeout(15_000),
    });
    assert.ok(response.ok, `HTTP ${response.status}`);
    const { result, error } = await response.json();
    assert.ok(!error && !result?.isError, 'MCP tool call failed');
    const lens = result.structuredContent.results.find(row => row.sku === sku);
    assert.ok(lens, 'optical part number missing from catalog');
    assert.equal(lens.totalTrackLengthMm, totalMm, `expected ${totalMm} mm, got ${lens.totalTrackLengthMm}`);
    console.log(`${sku}: ${totalMm} mm`);
  } catch (error) {
    console.error(`${sku}: ${error.message}`);
    process.exitCode = 1;
  }
}
