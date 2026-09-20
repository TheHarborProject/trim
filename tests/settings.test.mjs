// Unit tests for src/core/settings.ts — schema validation, motion math,
// prepaint init script generation, localStorage persistence. Package-only:
// compiles nothing outside packages/trim/src, and every schema here is a
// toy fixture, never any host's. The equivalence proof that ONE:ACCESS's
// lib/oa-tools.ts stays byte-for-byte behaviorally identical to this engine
// lives on the host side (scripts/test-oa-tools-trim-compat.mjs) — that's a
// ONE:ACCESS integration/compatibility concern, not a Trim package concern.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const root = path.join(import.meta.dirname, '..');
const dir = mkdtempSync(path.join(tmpdir(), 'trim-settings-'));
try {
  execFileSync('node', [
    'node_modules/typescript/bin/tsc',
    'src/types.ts', 'src/core/settings.ts',
    '--outDir', dir, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck',
  ], { cwd: root });
  const require = createRequire(import.meta.url);
  const { normalizeSettings, effectiveMotion, readStoredSettings, writeStoredSettings, clearStoredSettings, createInitScript } = require(path.join(dir, 'core', 'settings.js'));

  const toySchema = { theme: ['light', 'dark'], density: ['comfortable', 'compact'] };
  const toyDefaults = { theme: 'light', density: 'comfortable' };

  // --- normalisation des réglages ---
  assert.deepEqual(normalizeSettings(toySchema, toyDefaults, null), toyDefaults, 'null input falls back to defaults');
  assert.deepEqual(normalizeSettings(toySchema, toyDefaults, { theme: 'dark' }), { theme: 'dark', density: 'comfortable' }, 'valid partial input merges over defaults');
  assert.deepEqual(normalizeSettings(toySchema, toyDefaults, { theme: 'neon' }), toyDefaults, 'invalid value falls back to defaults');
  assert.deepEqual(normalizeSettings(toySchema, toyDefaults, ['dark']), toyDefaults, 'array input falls back to defaults');
  assert.deepEqual(
    normalizeSettings(toySchema, toyDefaults, JSON.parse('{"theme":"dark","__proto__":{"density":"compact"}}')),
    { theme: 'dark', density: 'comfortable' },
    'prototype pollution attempt is ignored',
  );

  // --- mouvement effectif ---
  assert.equal(effectiveMotion('full', true), 'reduced', 'a stored "full" is floored to "reduced" under system reduced-motion');
  assert.equal(effectiveMotion('full', false), 'full');
  assert.equal(effectiveMotion('none', true), 'none', '"none" is never overridden');
  assert.equal(effectiveMotion('reduced', false), 'reduced');

  // --- génération du script d'initialisation, avec clé motion ---
  const motionSchema = { animations: ['full', 'reduced', 'none'], density: ['comfortable', 'compact'] };
  const motionDefaults = { animations: 'full', density: 'comfortable' };
  for (const stored of [null, '{broken', JSON.stringify({ animations: 'none', density: 'compact' })]) {
    const script = createInitScript(motionSchema, motionDefaults, 'test-storage-key', 'animations');
    const attrs = {};
    vm.runInNewContext(script, {
      document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } },
      window: { matchMedia: () => ({ matches: true }) }, // system prefers reduced motion
      localStorage: { getItem: () => stored },
    });
    const parsed = (() => { try { return JSON.parse(stored); } catch { return null; } })();
    const expectedSettings = normalizeSettings(motionSchema, { ...motionDefaults, animations: 'reduced' }, parsed);
    assert.deepEqual(JSON.parse(attrs['data-oa-state']).settings, expectedSettings, 'createInitScript agrees with normalizeSettings for the same stored value');
    assert.equal(attrs['data-oa-motion'], expectedSettings.animations === 'full' ? 'reduced' : expectedSettings.animations, 'data-oa-motion is floored by the system preference, same as effectiveMotion');
  }

  // --- persistance / restauration ---
  const store = {};
  globalThis.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: k => { delete store[k]; },
  };
  try {
    writeStoredSettings('test-key', { theme: 'dark', density: 'compact' });
    assert.equal(store['test-key'], JSON.stringify({ theme: 'dark', density: 'compact' }));
    assert.deepEqual(readStoredSettings(toySchema, toyDefaults, 'test-key'), { theme: 'dark', density: 'compact' }, 'restore reads back a valid write');
    clearStoredSettings('test-key');
    assert.equal('test-key' in store, false, 'reset removes the stored value');
    assert.deepEqual(readStoredSettings(toySchema, toyDefaults, 'test-key'), toyDefaults, 'cleared storage falls back to defaults');
    store['broken-key'] = '{not json';
    assert.deepEqual(readStoredSettings(toySchema, toyDefaults, 'broken-key'), toyDefaults, 'malformed storage falls back to defaults');
  } finally {
    delete globalThis.localStorage;
  }

  // --- createInitScript/initializeTrim sans clé motion ---
  {
    const script = createInitScript(toySchema, toyDefaults, 'test-no-motion-key');
    for (const stored of [null, JSON.stringify({ theme: 'dark' })]) {
      const attrs = {};
      vm.runInNewContext(script, {
        document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } },
        window: { matchMedia: () => ({ matches: true }) }, // reduced motion has no effect at all here
        localStorage: { getItem: () => stored },
      });
      assert.equal('data-oa-motion' in attrs, false, 'no data-oa-motion attribute is written when motionKey is omitted');
      const state = JSON.parse(attrs['data-oa-state']);
      assert.equal('motion' in state, false, 'no "motion" key appears in data-oa-state when motionKey is omitted');
      assert.equal(state.systemReduced, true, 'systemReduced is still reported regardless of motionKey');
      const expectedSettings = stored ? { ...toyDefaults, ...JSON.parse(stored) } : toyDefaults;
      assert.deepEqual(state.settings, expectedSettings, 'settings still validate/apply normally with no motionKey');
    }
  }

  console.log('PASS core/settings: generic normalization (incl. prototype-pollution guard), motion floor math, init script generation with and without a motion key, persistence/restore');
} finally { rmSync(dir, { recursive: true, force: true }); }
