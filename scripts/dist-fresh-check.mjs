#!/usr/bin/env node
/**
 * Cross-platform dist freshness check.
 * 1. Stash current git diff state for dist
 * 2. Re-run build (build already executed before calling this in main script chain)
 * 3. Recreate TypeScript output deterministically; compare working tree
 * 4. Exit 1 if any uncommitted changes inside dist
 */
import { execSync } from 'node:child_process';

function run(cmd) {
  return execSync(cmd, { stdio: 'pipe', encoding: 'utf-8' });
}

function hasGit() {
  try { run('git rev-parse --is-inside-work-tree'); return true; } catch { return false; }
}

if (!hasGit()) {
  console.log('[dist:fresh] Not a git repository, skipping freshness check.');
  process.exit(0);
}

// Ensure dist exists
try { run('git ls-files dist'); } catch { /* ignore */ }

let diff = '';
try {
  diff = run('git diff --name-only -- dist');
} catch (e) {
  // git diff exits 1 if differences? Actually it exits 0; treat any throw as fatal
  console.error('[dist:fresh] Failed to diff dist:', e.message);
  process.exit(1);
}

if (diff.trim().length > 0) {
  console.error('[dist:fresh] Detected uncommitted changes in dist after build:');
  console.error(diff);
  console.error('\nPlease commit the updated dist/ artifacts to keep published package in sync.');
  process.exit(1);
}

console.log('[dist:fresh] dist is up to date.');
