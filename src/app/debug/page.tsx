import Link from "next/link";
import { listBerries } from "@/lib/db/queries";

export const metadata = {
  title: "Debug",
};

/**
 * Index of every dev-only debug surface. Lives behind the /debug layout
 * gate so it's only reachable in dev / preview deployments. New debug
 * pages should be added to ENTRIES below as they land.
 */
type Entry = {
  href: string;
  title: string;
  description: string;
};

const ENTRIES: Entry[] = [
  {
    href: "/debug/snack",
    title: "Snack 3D inspector",
    description:
      "Live editor for berry placement on the Poké Snack. Toggle 1/2/3 berries, drag sliders for offsets and rotations, copy a JSON snippet ready for berry-pivots.ts.",
  },
];

export default async function DebugIndexPage() {
  const berries = await listBerries();
  // Show one explicit link per saved-pivot berry, plus an "open the full
  // list" entry. Helps when the operator wants to jump straight to a
  // specific model without typing its slug.
  const sample = berries
    .filter((b) => b.fruitModel)
    .slice(0, 12)
    .map((b) => b.slug);

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Debug index
        </h1>
        <p className="text-sm text-muted mt-1">
          Developer-only tools. Disabled on production unless{" "}
          <code className="font-mono text-[11px]">DEBUG_ROUTES=1</code> is set.
        </p>
      </header>

      <ul className="grid gap-2">
        {ENTRIES.map((e) => (
          <li
            key={e.href}
            className="rounded-lg border border-border bg-card p-3"
          >
            <Link
              href={e.href}
              className="font-medium hover:text-accent transition-colors"
            >
              {e.title}
            </Link>
            <p className="text-xs text-muted mt-1">{e.description}</p>
            <code className="font-mono text-[10px] text-muted">{e.href}</code>
          </li>
        ))}

        <li className="rounded-lg border border-border bg-card p-3">
          <div className="font-medium">Berry tuner · per-slug</div>
          <p className="text-xs text-muted mt-1">
            One page per berry: pivot sliders with autosave to{" "}
            <code className="font-mono text-[11px]">berry-pivots.ts</code>,
            optional auto-centre, axes / grid helpers.
          </p>
          <code className="font-mono text-[10px] text-muted">
            /debug/berry/[slug]
          </code>
          <div className="mt-2 flex flex-wrap gap-1">
            {sample.map((slug) => (
              <Link
                key={slug}
                href={`/debug/berry/${slug}`}
                className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-subtle capitalize"
              >
                {slug.replace(/_/g, " ")}
              </Link>
            ))}
            {berries.length > sample.length && (
              <span className="text-[11px] text-muted self-center">
                + {berries.length - sample.length} more. type the slug in the URL
              </span>
            )}
          </div>
        </li>
      </ul>
    </div>
  );
}
