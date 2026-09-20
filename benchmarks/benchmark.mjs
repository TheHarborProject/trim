#!/usr/bin/env node
// Trim 0.1.2 performance audit — measurement only, no optimization applied.
//
// Compiles src/** once (read-only), then runs each hotspot section against
// small instrumented doubles (MutationObserver/localStorage/setAttribute
// counters — see lib/stubs.mjs) instead of jsdom. Every timed number is a
// median over several iterations after a warmup, per node:perf_hooks.
//
// This script is not part of `pnpm test` (tests/*.mjs glob only) and is not
// published — package.json's "files" is ["dist"], so `pnpm pack` never
// includes benchmarks/ regardless of this file's presence.
//
// Usage: node benchmarks/benchmark.mjs

import { compileTrim } from "./lib/compile.mjs";
import { createInstrumentedEnvironment, withGlobals, countJson } from "./lib/stubs.mjs";
import { medianTime, fmtMs, table } from "./lib/timing.mjs";

const SIZES = [10, 100, 1000];

function heading(title) {
  console.log(`\n=== ${title} ===`);
}

function buildSchema(n) {
  const schema = {};
  const defaults = {};
  for (let i = 0; i < n; i++) {
    schema[`k${i}`] = ["a", "b"];
    defaults[`k${i}`] = "a";
  }
  return { schema, defaults };
}

function buildIntegrations(n, mods, controlsPerIntegration = 1) {
  const dummyBinding = { get: () => undefined, set: () => {}, subscribe: () => () => {} };
  const integrations = [];
  for (let i = 0; i < n; i++) {
    const controls = {};
    for (let c = 0; c < controlsPerIntegration; c++) {
      controls[`c${c}`] = { id: `c${c}`, kind: "toggle", label: `Control ${c}`, binding: dummyBinding };
    }
    integrations.push({ id: `int${i}`, meta: { label: `Integration ${i}`, group: i % 5 === 0 ? "g" : undefined, order: i }, controls });
  }
  return integrations;
}

// --- 1. controller subscriptions ------------------------------------------

function benchControllerSubscriptions(mods) {
  heading("1. Controller subscriptions — createControllerEngine().subscribe()");
  const { schema, defaults } = buildSchema(1);
  const rows = [["subscribers", "MutationObservers", "observe()", "fan-out listener calls", "median apply() time (fan-out)"]];

  for (const n of SIZES) {
    const env = createInstrumentedEnvironment();
    withGlobals(env, () => {
      const engine = mods.controllerEngine.createControllerEngine(schema, defaults, `bench-sub-${n}`);
      const unsubs = [];
      for (let i = 0; i < n; i++) unsubs.push(engine.subscribe(() => {}));
      const observersBeforeApply = env.counts.mutationObserverConstructed;
      const observeBeforeApply = env.counts.observeCalls;

      env.counts.listenerFired = 0;
      let flip = false;
      const { medianMs } = medianTime(
        () => {
          env.counts.listenerFired = 0; // reset per-iteration so the reported count is one apply()'s fan-out
          // Alternate the value so every call is a genuine change — an
          // identical repeated apply() would be a no-op mutation (see
          // section 3's "no-op" column) and fire no observers at all.
          flip = !flip;
          engine.apply({ ...defaults, k0: flip ? "b" : "a" }, false);
        },
        { warmup: 3, iterations: 11 },
      );

      rows.push([n, observersBeforeApply, observeBeforeApply, env.counts.listenerFired, fmtMs(medianMs)]);
      for (const u of unsubs) u();
    });
  }
  console.log(table(rows));
  console.log(
    "-> 0.1.3: one shared MutationObserver per engine regardless of subscriber\n" +
      "   count — subscribe() adds to an internal listener Set and fans out through\n" +
      "   it; disconnect() only fires once the last subscriber unsubscribes.\n" +
      "   (Pre-0.1.3 this was N observers for N subscribers — see git history.)",
  );
}

// --- 2. snapshot parsing ---------------------------------------------------

function benchSnapshotParsing(mods) {
  heading("2. Snapshot parsing — JSON.parse per getSnapshot() call");
  const { schema, defaults } = buildSchema(20);
  const rows = [["consumers reading after 1 change", "JSON.parse calls", "median total getSnapshot() time"]];

  for (const n of SIZES) {
    const env = createInstrumentedEnvironment();
    withGlobals(env, () => {
      const ctrl = mods.coreController.createTrimController(schema, defaults, `bench-parse-${n}`);
      ctrl.apply({ ...defaults, k0: "b" }, false);

      const { parse } = countJson(() => {
        for (let i = 0; i < n; i++) ctrl.getSnapshot();
      });

      const { medianMs } = medianTime(
        () => {
          for (let i = 0; i < n; i++) ctrl.getSnapshot();
        },
        { warmup: 3, iterations: 11 },
      );

      rows.push([n, parse, fmtMs(medianMs)]);
    });
  }
  console.log(table(rows));
  console.log(
    "-> 0.1.3: parseState() is cached (single entry, keyed on the snapshot string) —\n" +
      "   N consumers reading the same unchanged snapshot cost exactly one JSON.parse.\n" +
      "   (Pre-0.1.3 this re-parsed on every call — N parses for N reads.)",
  );
}

// --- 3. controller.apply() -------------------------------------------------

function benchApply(mods) {
  heading("3. controller.apply() — setAttribute count and JSON.stringify cost");
  const rows = [
    ["schema size", "setAttribute calls (changed)", "setAttribute calls (no-op)", "median apply() time", "median JSON.stringify(state) time alone"],
  ];

  for (const n of SIZES) {
    const { schema, defaults } = buildSchema(n);
    const env = createInstrumentedEnvironment();
    withGlobals(env, () => {
      const engine = mods.controllerEngine.createControllerEngine(schema, defaults, `bench-apply-${n}`);
      engine.apply(defaults, false); // establish a baseline state

      env.counts.setAttributeCalls = 0;
      engine.apply({ ...defaults, k0: "b" }, false); // one real change
      const changedCalls = env.counts.setAttributeCalls;

      env.counts.setAttributeCalls = 0;
      engine.apply({ ...defaults, k0: "b" }, false); // apply the SAME settings again — no-op in substance
      const noopCalls = env.counts.setAttributeCalls;

      const { medianMs } = medianTime(() => engine.apply({ ...defaults, k0: "b" }, false), { warmup: 3, iterations: 11 });

      const state = { settings: defaults, systemReduced: false };
      const { medianMs: stringifyMs } = medianTime(() => JSON.stringify(state), { warmup: 5, iterations: 21 });

      rows.push([n, changedCalls, noopCalls, fmtMs(medianMs), fmtMs(stringifyMs)]);
    });
  }
  console.log(table(rows));
  console.log(
    "-> setAttribute count is identical whether the call actually changed one key\n" +
      "   or repeated the exact same settings — writeDocument() has no per-key diff,\n" +
      "   it always rewrites every schema key plus the state attribute.",
  );
}

// --- 4. registry scalability ------------------------------------------------

function benchRegistry(mods) {
  heading("4. Registry scalability — createTrimRegistry()");
  const rows = [["integrations (N)", "median register() [N-th, fresh id]", "median update (same id) time", "median unregister() time", "median list() [cold]", "median list() [cached]"]];

  for (const n of SIZES) {
    const registry = mods.registry.createTrimRegistry();
    const integrations = buildIntegrations(n, mods);
    for (const integration of integrations) registry.register(integration);

    const { medianMs: registerMs } = medianTime(
      () => {
        registry.register({ id: `probe-${Math.random()}`, meta: { label: "probe" }, controls: {} });
      },
      { warmup: 3, iterations: 11 },
    );

    const target = integrations[integrations.length - 1];
    let flip = false;
    const { medianMs: updateMs } = medianTime(
      () => {
        flip = !flip;
        registry.register({ ...target, meta: { ...target.meta, label: flip ? "Updated" : target.meta.label } });
      },
      { warmup: 3, iterations: 11 },
    );

    registry.list(); // ensure a cached list exists
    const { medianMs: listCachedMs } = medianTime(() => registry.list(), { warmup: 3, iterations: 11 });

    const { medianMs: listColdMs } = medianTime(
      () => {
        registry.register({ id: `invalidate-${Math.random()}`, meta: { label: "x" }, controls: {} });
        return registry.list();
      },
      { warmup: 3, iterations: 11 },
    );

    const { medianMs: unregisterMs } = medianTime(
      () => {
        const probeId = `unreg-probe-${Math.random()}`;
        registry.register({ id: probeId, meta: { label: "x" }, controls: {} });
        registry.unregister(probeId);
      },
      { warmup: 3, iterations: 11 },
    );

    rows.push([n, fmtMs(registerMs), fmtMs(updateMs), fmtMs(unregisterMs), fmtMs(listColdMs), fmtMs(listCachedMs)]);
  }
  console.log(table(rows));

  heading("4b. Registry listener fan-out (independent of integration count)");
  const rows2 = [["listeners", "median notify() time (via one register())"]];
  for (const n of [10, 100, 1000]) {
    const registry = mods.registry.createTrimRegistry();
    const unsubs = [];
    for (let i = 0; i < n; i++) unsubs.push(registry.subscribe(() => {}));
    let flip = false;
    const { medianMs } = medianTime(
      () => {
        flip = !flip;
        registry.register({ id: "probe", meta: { label: flip ? "a" : "b" }, controls: {} });
      },
      { warmup: 3, iterations: 11 },
    );
    rows2.push([n, fmtMs(medianMs)]);
    for (const u of unsubs) u();
  }
  console.log(table(rows2));
  console.log("-> register/get/unregister are Map-backed (O(1) regardless of N); notify() cost scales with listener count, not with integration count.");
}

// --- 5. control resolution ---------------------------------------------------

function benchResolution(mods) {
  heading("5. Control resolution — findIntegration()/findControl() linear scan");
  const rows = [["integrations (N)", "median findIntegration(first id)", "median findIntegration(last id)", "median: resolve ALL N controls once (O(N) x N calls)"]];

  for (const n of SIZES) {
    const integrations = buildIntegrations(n, mods);
    const { medianMs: firstMs } = medianTime(() => mods.resolution.findIntegration(integrations, integrations[0].id), { warmup: 5, iterations: 21 });
    const { medianMs: lastMs } = medianTime(() => mods.resolution.findIntegration(integrations, integrations[n - 1].id), { warmup: 5, iterations: 21 });

    const refs = integrations.map(i => `${i.id}.c0`);
    const { medianMs: allMs } = medianTime(
      () => {
        for (const ref of refs) mods.resolution.findControl(integrations, ref);
      },
      { warmup: 3, iterations: 11 },
    );

    rows.push([n, fmtMs(firstMs), fmtMs(lastMs), fmtMs(allMs)]);
  }
  console.log(table(rows));
  console.log(
    "-> findIntegration is Array.prototype.find: O(1) best case (first id), O(N)\n" +
      "   worst case (last id). Resolving every control in a panel once (what a\n" +
      "   render pass of N mounted controls does) is N lookups x O(N) each = O(N^2).",
  );
}

// --- 6. React subscription topology (simulated via the same primitives hooks.ts wraps) ---

function benchReactTopology(mods) {
  heading("6. React subscription topology — <Trim.Panel> with N controls, one shared controller");
  const rows = [
    [
      "controls (N)",
      "registry subscriptions",
      "binding/controller subscriptions",
      "MutationObservers implied",
      "resolutions after 1 registry notify",
    ],
  ];

  for (const n of SIZES) {
    const { schema, defaults } = buildSchema(n);
    const env = createInstrumentedEnvironment();
    withGlobals(env, () => {
      const ctrl = mods.reactController.createTrimController(schema, defaults, `bench-topo-${n}`);
      const integrations = [
        {
          id: "int0",
          meta: { label: "Integration" },
          controls: Object.fromEntries(
            Object.keys(schema).map(key => [key, { id: key, kind: "toggle", label: key, binding: mods.bindings.controller(ctrl, key) }]),
          ),
        },
      ];
      const registry = mods.registry.createTrimRegistry();
      registry.register(integrations[0]);

      // AutoPanel calls useTrimRegistry() once; each of the N mounted
      // <ControlWidget> instances calls useTrimControlState -> useTrimControl
      // -> useTrimRegistry() AGAIN (hooks.ts) — so N+1 registry subscriptions
      // exist for a panel with N controls, all reading the identical list().
      const registrySubs = [];
      for (let i = 0; i < n + 1; i++) registrySubs.push(registry.subscribe(() => {}));

      // Each mounted ControlWidget subscribes to its own control's binding
      // exactly once (useSyncExternalStore keeps the subscribe fn stable
      // across re-renders as long as `binding` doesn't change identity).
      const bindingUnsubs = [];
      for (const key of Object.keys(schema)) {
        bindingUnsubs.push(mods.resolution.subscribeToControl(mods.bindings.controller(ctrl, key), () => {}));
      }

      const observersImplied = env.counts.mutationObserverConstructed;

      // One registry notification (e.g. an unrelated integration mounting
      // elsewhere) invalidates registry.list()'s cached reference; every
      // ControlWidget's useMemo(findControl, [integrations, ref]) therefore
      // re-runs because its `integrations` dependency changed identity —
      // even though this integration's own controls didn't change.
      const list = registry.list();
      const { medianMs, result: resolutions } = medianTime(
        () => {
          let count = 0;
          for (const key of Object.keys(schema)) {
            mods.resolution.findControl(list, `int0.${key}`);
            count++;
          }
          return count;
        },
        { warmup: 3, iterations: 11 },
      );

      rows.push([n, registrySubs.length, bindingUnsubs.length, observersImplied, `${resolutions} resolutions (${fmtMs(medianMs)})`]);

      for (const u of registrySubs) u();
      for (const u of bindingUnsubs) u();
    });
  }
  console.log(table(rows));
  console.log(
    "-> 0.1.3: N controls sharing one controller now share ONE MutationObserver\n" +
      "   (was N pre-0.1.3). Still unfixed: a registry notification anywhere\n" +
      "   re-triggers findControl for all N mounted controls, not just the ones\n" +
      "   that changed (see hotspot #3 — the Map-lookup optimization, not in this patch).",
  );
}

// --- 7. declarative integration parsing (buildIntegrationDescriptor) -----------

function benchParsing(mods) {
  heading("7. Declarative integration parsing — buildIntegrationDescriptor()");
  const React = mods.React;
  const { Toggle, Segmented, Option, buildIntegrationDescriptor } = mods.components;
  const noopBind = { get: () => false, set: () => {}, subscribe: () => () => {} };

  function buildChildren(n, kind) {
    if (kind === "toggle") {
      return Array.from({ length: n }, (_, i) => React.createElement(Toggle, { key: i, id: `t${i}`, label: `Toggle ${i}`, bind: noopBind }));
    }
    return Array.from({ length: n }, (_, i) =>
      React.createElement(
        Segmented,
        { key: i, id: `s${i}`, label: `Segmented ${i}`, bind: noopBind },
        [1, 2, 3].map(v => React.createElement(Option, { key: v, value: String(v) }, `Option ${v}`)),
      ),
    );
  }

  const rows = [["controls (N)", "kind", "median build time"]];
  for (const n of SIZES) {
    for (const kind of ["toggle", "segmented"]) {
      const { medianMs } = medianTime(() => buildIntegrationDescriptor("bench", { label: "Bench" }, buildChildren(n, kind)), { warmup: 3, iterations: 11 });
      rows.push([n, kind, fmtMs(medianMs)]);
    }
  }
  console.log(table(rows));

  heading("7b. Semantically-identical rebuilds and spurious registry notifications");
  const registry = mods.registry.createTrimRegistry();
  const stableBind = noopBind; // simulates controller()'s cached, referentially-stable binding
  const first = buildIntegrationDescriptor("stable", { label: "Bench" }, [React.createElement(Toggle, { key: 0, id: "t0", label: "T", bind: stableBind })]);
  registry.register(first);
  let notified = false;
  registry.subscribe(() => (notified = true));
  // Same content, fresh React element tree (as a real re-render produces) —
  // stable binding reference (as controller()'s WeakMap cache produces).
  const second = buildIntegrationDescriptor("stable", { label: "Bench" }, [React.createElement(Toggle, { key: 0, id: "t0", label: "T", bind: stableBind })]);
  registry.register(second);
  console.log(`Stable binding, identical content, fresh JSX tree -> notify() fired: ${notified} (expected: false)`);

  const registry2 = mods.registry.createTrimRegistry();
  const firstInline = buildIntegrationDescriptor("inline", { label: "Bench" }, [
    React.createElement(Toggle, { key: 0, id: "t0", label: "T", bind: { get: () => false, set: () => {}, subscribe: () => () => {} } }),
  ]);
  registry2.register(firstInline);
  let notifiedInline = false;
  registry2.subscribe(() => (notifiedInline = true));
  const secondInline = buildIntegrationDescriptor("inline", { label: "Bench" }, [
    // A fresh, unmemoized inline binding — same behavior, new object identity.
    React.createElement(Toggle, { key: 0, id: "t0", label: "T", bind: { get: () => false, set: () => {}, subscribe: () => () => {} } }),
  ]);
  registry2.register(secondInline);
  console.log(`Inline (unmemoized) binding, identical content, fresh JSX tree -> notify() fired: ${notifiedInline} (expected: true — spurious)`);
}

// --- 8. grouping/sorting ---------------------------------------------------

function benchSorting(mods) {
  heading("8. Grouping/sorting — sortByOrder()/groupInOrder()");
  const rows = [["integrations (N)", "median sortByOrder()", "median groupInOrder()"]];
  for (const n of SIZES) {
    const integrations = buildIntegrations(n, mods);
    const { medianMs: sortMs } = medianTime(() => mods.sorting.sortByOrder(integrations), { warmup: 5, iterations: 21 });
    const { medianMs: groupMs } = medianTime(() => mods.sorting.groupInOrder(integrations), { warmup: 5, iterations: 21 });
    rows.push([n, fmtMs(sortMs), fmtMs(groupMs)]);
  }
  console.log(table(rows));
  console.log("-> O(N log N), unmemoized in <Trim.Panel>'s AutoPanel (re-runs on every render of that component, not only when `integrations` changes).");
}

function main() {
  const { mods, cleanup } = compileTrim();
  try {
    benchControllerSubscriptions(mods);
    benchSnapshotParsing(mods);
    benchApply(mods);
    benchRegistry(mods);
    benchResolution(mods);
    benchReactTopology(mods);
    benchParsing(mods);
    benchSorting(mods);
  } finally {
    cleanup();
  }
}

main();
