export default function HomePage() {
  return (
    <>
      <h1>Trim 0.2 — Next.js App Router fixture</h1>
      <p>
        This page (and every page on this site) renders the <strong>vanilla adapter + popover
        shell</strong> globally from <code>app/layout.tsx</code>, a Server Component — look for
        the floating launcher button in the bottom-right corner.
      </p>
      <ul>
        <li>
          <a href="/shadcn">shadcn adapter + popover shell</a> — a host-local{" "}
          <code>TrimShell</code> built from this fixture&apos;s own local shadcn Button/Popover.
        </li>
        <li>
          <a href="/headless">headless adapter</a> — no Trim-rendered chrome at all.
        </li>
      </ul>
    </>
  );
}
