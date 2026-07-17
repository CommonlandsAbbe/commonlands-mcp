#!/usr/bin/env node
/**
 * Guards against version drift between the three hand-maintained version
 * constants: package.json, server.json (MCP registry metadata), and
 * SERVER_INFO.version in src/index.ts (served by initialize and /healthz).
 *
 * The registry entry once advertised 0.1.1 while production served 0.1.4 —
 * this check runs in `npm run verify` so that can't happen silently again.
 */

import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const packageVersion = JSON.parse(read('../package.json')).version;
const serverJsonVersion = JSON.parse(read('../server.json')).version;
const serverInfoMatch = read('../src/index.ts').match(/const SERVER_INFO = \{[^}]*version: '([^']+)'/);
const serverInfoVersion = serverInfoMatch?.[1];

const versions = {
  'package.json': packageVersion,
  'server.json': serverJsonVersion,
  'src/index.ts SERVER_INFO': serverInfoVersion,
};

const unique = new Set(Object.values(versions));
if (unique.size !== 1 || unique.has(undefined)) {
  console.error('Version drift detected:');
  for (const [file, version] of Object.entries(versions)) {
    console.error(`  ${file}: ${version ?? 'NOT FOUND'}`);
  }
  console.error('Bump all three together, then re-run `mcp-publisher publish` for the registry.');
  process.exit(1);
}

console.log(`Version parity OK: ${packageVersion}`);
