import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const css = read('src/react/panel.css').replace(/\/\*[\s\S]*?\*\//g, '');
const defaults = css.match(/\[data-trim-panel\]\s*\{([^}]+)\}/)[1];
const tokens = new Map([...defaults.matchAll(/(--[\w-]+):\s*([^;]+);/g)]
  .map(([, name, value]) => [name, value]));
for (const name of ['bg', 'ink', 'muted', 'line', 'font-family', 'font-size',
  'line-height', 'radius', 'padding', 'gap', 'control-min-height', 'control-padding']) {
  assert.ok(tokens.has(`--trim-${name}`), `required token: ${name}`);
}
for (const [, name] of css.matchAll(/(--[\w-]+)/g)) {
  assert.ok(name.startsWith('--trim-'), `no host or Tailwind variable: ${name}`);
  assert.ok(tokens.has(name), `every token has a panel-local default: ${name}`);
}
for (const name of tokens.keys()) {
  assert.ok(read('README.md').includes(`\`${name}\``), `document token ${name}`);
  if (name !== '--trim-muted') {
    assert.ok(css.includes(`var(${name})`), `consume token ${name}`);
  }
}
assert.doesNotMatch(css, /:root|@import|@tailwind|@apply|forced-color-adjust\s*:\s*none|appearance\s*:\s*none|\b(?:animation|transition)\s*:/);
assert.equal(tokens.get('--trim-bg'), 'var(--trim-surface)', 'preserve surface overrides');
assert.equal(tokens.get('--trim-font-size'), '0.875rem');
assert.match(css, /min-height:\s*max\(24px, var\(--trim-control-min-height\)\)/);
assert.match(css, /:focus-visible\s*\{\s*outline: var\(--trim-focus-width\) solid currentColor;\s*outline-offset: var\(--trim-focus-offset\);/);
const forced = css.slice(css.indexOf('@media (forced-colors: active)'));
assert.ok(forced.length, 'explicit forced-colors support');
assert.doesNotMatch(forced, /var\(/, 'forced colors bypass host tokens');
for (const declaration of ['color: CanvasText !important', 'background: Canvas !important',
  'border-color: CanvasText !important', 'outline: 2px solid Highlight !important']) {
  assert.ok(forced.includes(declaration), declaration);
}
const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.exports['./panel.css'], './dist/react/panel.css');
assert.ok(pkg.sideEffects.includes('./dist/react/panel.css'));
assert.ok(pkg.files.includes('dist'));
console.log('PASS panel.css: local token contract, documentation, host isolation, accessibility rules, public export');
