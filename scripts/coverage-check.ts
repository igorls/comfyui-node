#!/usr/bin/env bun
/**
 * Simple LCOV coverage threshold checker.
 * Usage: After generating coverage/ with lcov.info run via npm/bun script.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

interface FileSummary { linesFound: number; linesHit: number; functionsFound: number; functionsHit: number; }

const THRESHOLDS = {
  lines: Number(process.env.COVERAGE_MIN_LINES || 25),
  functions: Number(process.env.COVERAGE_MIN_FUNCTIONS || 60)
};

function parseLcov(lcov: string): FileSummary[] {
  const summaries: FileSummary[] = [];
  let current: FileSummary | null = null;
  for (const raw of lcov.split(/\n/)) {
    const line = raw.trim();
    if (line.startsWith('TN:') || line.startsWith('SF:')) {
      // start of new record
      if (current) summaries.push(current);
      current = { linesFound: 0, linesHit: 0, functionsFound: 0, functionsHit: 0 };
    } else if (line.startsWith('FNF:') && current) {
      current.functionsFound = Number(line.slice(4));
    } else if (line.startsWith('FNH:') && current) {
      current.functionsHit = Number(line.slice(4));
    } else if (line.startsWith('LF:') && current) {
      current.linesFound = Number(line.slice(3));
    } else if (line.startsWith('LH:') && current) {
      current.linesHit = Number(line.slice(3));
    } else if (line === 'end_of_record') {
      if (current) {
        summaries.push(current);
        current = null;
      }
    }
  }
  return summaries;
}

function aggregate(files: FileSummary[]) {
  return files.reduce((acc, f) => {
    acc.linesFound += f.linesFound; acc.linesHit += f.linesHit; acc.functionsFound += f.functionsFound; acc.functionsHit += f.functionsHit; return acc; }, { linesFound:0, linesHit:0, functionsFound:0, functionsHit:0 });
}

function pct(hit: number, found: number) { return found === 0 ? 100 : (hit / found) * 100; }

function main() {
  const lcovPath = resolve(process.cwd(), 'coverage', 'lcov.info');
  let content: string;
  try { content = readFileSync(lcovPath, 'utf8'); } catch {
    console.error(`[coverage-check] Could not read ${lcovPath}. Did you run the coverage:lcov script?`);
    process.exit(1);
  }
  const summaries = parseLcov(content);
  const totals = aggregate(summaries);
  const linePct = pct(totals.linesHit, totals.linesFound);
  const funcPct = pct(totals.functionsHit, totals.functionsFound);
  const lineOk = linePct >= THRESHOLDS.lines;
  const funcOk = funcPct >= THRESHOLDS.functions;
  console.log(`[coverage-check] Lines: ${linePct.toFixed(2)}% (threshold ${THRESHOLDS.lines}%)`);
  console.log(`[coverage-check] Functions: ${funcPct.toFixed(2)}% (threshold ${THRESHOLDS.functions}%)`);
  if (!lineOk || !funcOk) {
    console.error('[coverage-check] Coverage thresholds not met.');
    process.exit(2);
  }
  console.log('[coverage-check] Coverage thresholds satisfied.');
}

main();
