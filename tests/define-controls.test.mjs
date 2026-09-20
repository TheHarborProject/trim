// Unit + type tests for src/core/define-controls.ts — pure factories that
// stamp a `kind` discriminant onto caller-provided fields. No React, no
// registry: these are plain data producers, directly unit-testable with no
// renderer, package-only like every other tests/*.mjs.
//
// Two tsc invocations:
//   1. Compiles the real source (bindings/integration/define-controls) and
//      the resulting JS is asserted against with plain node:assert — the
//      runtime-behavior half.
//   2. --noEmit compiles a small type-probe fixture that assigns each
//      factory's return value to an explicitly-typed variable (ToggleControl,
//      SegmentedControl<"light"|"dark">, ...). A factory returning a loosely-
//      widened shape (e.g. `options: SegmentedOption<string>[]` instead of
//      the literal-preserving `readonly SegmentedOption<V>[]`) fails this
//      compile before any assertion runs — the type-level half.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const dir = mkdtempSync(path.join(root, '.trim-define-controls-test-'));
try {
  // --- type-probe fixture (compiled with --noEmit --strict below) ---
  const probePath = path.join(dir, 'probe.ts');
  writeFileSync(
    probePath,
    `
    import { callback } from "../src/core/bindings";
    import {
      defineBooleanControl, defineSegmentedControl, defineActionControl, defineToggleActionControl,
    } from "../src/core/define-controls";
    import type { ToggleControl, SegmentedControl, ActionControl, ToggleActionControl } from "../src/core/integration";

    const bool: ToggleControl = defineBooleanControl({
      id: "a", label: "A", binding: callback(() => true, () => {}),
    });

    const segmented: SegmentedControl<"light" | "dark"> = defineSegmentedControl({
      id: "theme", label: "Theme",
      binding: callback<"light" | "dark">(() => "light", () => {}),
      options: [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }],
    });

    const action: ActionControl = defineActionControl({
      id: "reset", label: "Reset", binding: callback<void>(() => undefined, () => {}),
    });

    const toggleAction: ToggleActionControl = defineToggleActionControl({
      id: "pin", label: "Pin", binding: callback(() => false, () => {}), is_unique: false,
    });

    void bool; void segmented; void action; void toggleAction;
    `,
  );

  execFileSync('node', [
    'node_modules/typescript/bin/tsc', probePath,
    '--noEmit', '--strict', '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck',
  ], { cwd: root });

  // --- runtime behavior ---
  execFileSync('node', [
    'node_modules/typescript/bin/tsc',
    'src/core/bindings.ts', 'src/core/integration.ts', 'src/core/define-controls.ts',
    '--outDir', dir, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck',
  ], { cwd: root });

  const require = createRequire(import.meta.url);
  // Only src/core/* files are given to tsc, so their common ancestor (and
  // hence the inferred rootDir) is src/core itself — output lands directly
  // in `dir`, not `dir/core` (contrast tests that also include src/types.ts,
  // whose common ancestor is src, e.g. bindings.test.mjs).
  const { defineBooleanControl, defineSegmentedControl, defineActionControl, defineToggleActionControl } =
    require(path.join(dir, 'define-controls.js'));

  const binding = { get: () => undefined, set: () => {}, subscribe: () => () => {} };

  // --- kind stamping + field passthrough ---
  {
    const input = { id: "a", label: "A", description: "d", binding };
    const result = defineBooleanControl(input);
    assert.equal(result.kind, "toggle");
    assert.equal(result.id, "a");
    assert.equal(result.label, "A");
    assert.equal(result.description, "d");
    assert.equal(result.binding, binding, "binding is passed through by reference, not cloned");
    assert.notEqual(result, input, "factory returns a new object, does not mutate/return the input");
  }
  {
    const options = [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }];
    const result = defineSegmentedControl({ id: "theme", label: "Theme", binding, options });
    assert.equal(result.kind, "segmented");
    assert.equal(result.options, options, "options array is passed through by reference");
  }
  {
    const result = defineActionControl({ id: "reset", label: "Reset", binding });
    assert.equal(result.kind, "action");
  }
  {
    const result = defineToggleActionControl({ id: "pin", label: "Pin", binding });
    assert.equal(result.kind, "toggle-action");
  }

  // --- is_unique: never eagerly stamped ---
  {
    const omitted = defineBooleanControl({ id: "a", label: "A", binding });
    assert.ok(!("is_unique" in omitted), "is_unique key is absent, not defaulted to true, when the caller omits it");
  }
  {
    const explicitTrue = defineBooleanControl({ id: "a", label: "A", binding, is_unique: true });
    assert.equal(explicitTrue.is_unique, true, "an explicit is_unique is preserved");
  }
  {
    const explicitFalse = defineSegmentedControl({ id: "theme", label: "Theme", binding, options: [], is_unique: false });
    assert.equal(explicitFalse.is_unique, false, "an explicit is_unique: false survives the factory unchanged");
  }

  console.log('PASS core/define-controls: kind stamping + field passthrough for all four factories, is_unique left exactly as given (absent when omitted), type-probe compiles against concrete TrimControl member types');
} finally { rmSync(dir, { recursive: true, force: true }); }
