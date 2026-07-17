#!/usr/bin/env node
/**
 * Deploys the Worker with real build metadata so /healthz never reports the
 * wrangler.toml "local" placeholders in production.
 *
 * Injects at deploy time:
 *   ENVIRONMENT = "production"
 *   VERSION     = package version
 *   GIT_SHA     = short sha of HEAD
 *
 * Usage: npm run deploy
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const gitSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
const sha = status ? `${gitSha}-dirty` : gitSha;
const version =
  process.env.npm_package_version ??
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const extraArgs = process.argv.slice(2);

const result = spawnSync(
  'npx',
  [
    'wrangler',
    'deploy',
    '--keep-vars',
    '--var',
    'ENVIRONMENT:production',
    '--var',
    `VERSION:${version}`,
    '--var',
    `GIT_SHA:${sha}`,
    ...extraArgs,
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);

process.exit(result.status ?? 1);
