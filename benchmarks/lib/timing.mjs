// Shared timing helpers for benchmarks/*.mjs. Node-only (node:perf_hooks),
// no dependency. Every measurement here: warm up, run several iterations,
// report the median (not a single run, not a mean skewed by GC pauses).

import { performance } from "node:perf_hooks";

/**
 * Runs `fn()` `warmup` times (discarded) then `iterations` times, returning
 * the median wall-clock duration in milliseconds across the measured runs.
 * `fn` may return a value; the last return value is attached as `.result`
 * for callers that also want to sanity-check what was measured.
 */
export function medianTime(fn, { warmup = 5, iterations = 21 } = {}) {
  for (let i = 0; i < warmup; i++) fn();
  const samples = [];
  let result;
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    result = fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  return { medianMs: median, samples, result };
}

export function fmtMs(ms) {
  if (ms < 0.001) return "<0.001ms";
  return `${ms.toFixed(3)}ms`;
}

/** Renders a simple fixed-width text table from an array of row arrays (first row = header). */
export function table(rows) {
  const widths = rows[0].map((_, col) => Math.max(...rows.map(row => String(row[col]).length)));
  return rows
    .map(row => row.map((cell, col) => String(cell).padEnd(widths[col])).join("  |  "))
    .join("\n");
}
