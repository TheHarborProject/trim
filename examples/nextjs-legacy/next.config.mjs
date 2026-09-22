import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // This fixture lives inside a repo that also has its own pnpm-lock.yaml —
  // without this, Next.js's workspace-root inference picks the repo root
  // (seeing that lockfile) instead of this fixture, and warns on every
  // build/dev run. This fixture is a standalone npm project (its own
  // package-lock.json, its own node_modules), so its root is itself.
  outputFileTracingRoot: path.join(import.meta.dirname),
};

export default nextConfig;
