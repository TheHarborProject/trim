// Server Component — no "use client" here, and none is needed: Next.js App
// Router lets a Server Component import and render a Client Component
// directly (only the reverse, server code *inside* a client component, is
// restricted). <VanillaGlobalPanel/> is itself "use client" (it calls
// hooks), and @theharborproject/trim's own <Panel>/<Trim.Registry> already
// carry a package-level "use client" pragma — see this fixture's README for
// how that was verified against the real built dist/ output.
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";
import "@theharborproject/trim/themes/default.css";
import { VanillaGlobalPanel } from "../components/VanillaGlobalPanel";

export const metadata = {
  title: "Trim 0.2 — Next.js fixture",
  description: "Verifies ui.adapter/ui.shell end to end inside a real Next.js App Router app.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/">Home (vanilla, global)</Link>
          <Link href="/shadcn">shadcn + popover (Radix)</Link>
          <Link href="/shadcn-base">shadcn + popover (Base UI)</Link>
          <Link href="/headless">headless</Link>
        </nav>
        <main>{children}</main>
        {/* Rendered on every page via this Server Component root layout —
            the vanilla + popover variant, proving a Client Component from
            @theharborproject/trim/react can be rendered straight from
            RootLayout with zero client-boundary changes needed here. */}
        <VanillaGlobalPanel />
      </body>
    </html>
  );
}
