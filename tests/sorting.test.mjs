// Unit tests for src/advanced/sorting.ts — pure ordering/grouping over
// registered integrations, no hooks. Package-only: toy fixtures.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const dir = mkdtempSync(path.join(tmpdir(), 'trim-sorting-'));
try {
  execFileSync('node', [
    'node_modules/typescript/bin/tsc',
    'src/core/integration.ts', 'src/core/bindings.ts', 'src/advanced/sorting.ts',
    '--outDir', dir, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck',
  ], { cwd: root });
  const require = createRequire(import.meta.url);
  const { sortByOrder, groupInOrder } = require(path.join(dir, 'advanced', 'sorting.js'));

  const item = (id, group, order) => ({ id, meta: { label: id, group, order }, controls: {} });

  // --- sortByOrder ---
  {
    const a = item('a', 'g1', 2);
    const b = item('b', 'g1', 1);
    const c = item('c', 'g2'); // no explicit order → falls back to registration index
    assert.deepEqual(sortByOrder([a, b, c]).map(i => i.id), ['b', 'a', 'c'], 'lower meta.order sorts first; items with no order keep their registration index as the tiebreak');
  }
  {
    const noOrder1 = item('first', undefined);
    const noOrder2 = item('second', undefined);
    assert.deepEqual(sortByOrder([noOrder1, noOrder2]).map(i => i.id), ['first', 'second'], 'with no explicit order at all, registration order is preserved');
  }

  // --- groupInOrder ---
  {
    const motion1 = item('loader', 'motion', 1);
    const vision1 = item('contrast', 'vision', 1);
    const motion2 = item('scroll', 'motion', 2);
    const ungrouped = item('standalone', undefined);
    const groups = groupInOrder([motion1, vision1, motion2, ungrouped]);
    assert.deepEqual(groups.map(g => g.group), ['motion', 'vision', undefined], 'groups appear in the order their first member sorts to, not alphabetically');
    assert.deepEqual(groups.find(g => g.group === 'motion').integrations.map(i => i.id), ['loader', 'scroll']);
    assert.deepEqual(groups.find(g => g.group === undefined).integrations.map(i => i.id), ['standalone'], 'an integration with no group forms its own (undefined-keyed) group');
  }
  {
    // empty input
    assert.deepEqual(groupInOrder([]), []);
    assert.deepEqual(sortByOrder([]), []);
  }

  console.log('PASS advanced/sorting: sortByOrder (explicit order + registration-index tiebreak), groupInOrder (stable group order, ungrouped bucket, empty input)');
} finally { rmSync(dir, { recursive: true, force: true }); }
