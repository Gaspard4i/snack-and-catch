"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";

const FLAVOURS = ["SWEET", "SPICY", "DRY", "BITTER", "SOUR"] as const;
const FLAVOUR_TINT: Record<string, string> = {
  SWEET: "#f8b3d7",
  SPICY: "#e85a3a",
  DRY: "#7fb3d5",
  BITTER: "#735a8a",
  SOUR: "#f4d35e",
};

export type SeasoningRow = {
  slug: string;
  itemId: string;
  name: string;
  kind: "berry" | "vanilla" | "other";
  snackValid: boolean;
  dominantFlavour: string | null;
  colour: string | null;
  effectTags: string[];
  spriteUrl: string;
  hasBaitEffects: boolean;
};

type Props = {
  rows: SeasoningRow[];
};

/**
 * Interactive Seasoning Dex with search + filters. The server passes the
 * full list once; we filter on the client to avoid round-trips since the
 * dataset is < 100 entries.
 *
 * Filters:
 *   - free-text search (slug substring match)
 *   - kind toggle: all / berry / vanilla
 *   - flavour chips: SWEET, SPICY, DRY, BITTER, SOUR (multi-select)
 *   - effect tag chips (hp_recovery, status_recovery, …) when relevant
 *   - "with bait effects" toggle
 */
export function SeasoningDexClient({ rows }: Props) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "berry" | "vanilla">("all");
  const [activeFlavours, setActiveFlavours] = useState<Set<string>>(new Set());
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [baitOnly, setBaitOnly] = useState(false);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) for (const t of r.effectTags) set.add(t);
    return [...set].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (kind === "berry" && r.kind !== "berry") return false;
      if (kind === "vanilla" && r.kind !== "vanilla") return false;
      if (q && !r.slug.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q)) {
        return false;
      }
      if (activeFlavours.size > 0) {
        if (!r.dominantFlavour || !activeFlavours.has(r.dominantFlavour)) {
          return false;
        }
      }
      if (activeTags.size > 0) {
        if (!r.effectTags.some((t) => activeTags.has(t))) return false;
      }
      if (baitOnly && !r.hasBaitEffects) return false;
      return true;
    });
  }, [rows, query, kind, activeFlavours, activeTags, baitOnly]);

  const berryCount = rows.filter((r) => r.kind === "berry").length;
  const vanillaCount = rows.filter((r) => r.kind === "vanilla").length;

  const toggleFlavour = (f: string) => {
    setActiveFlavours((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };
  const toggleTag = (t: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const reset = () => {
    setQuery("");
    setKind("all");
    setActiveFlavours(new Set());
    setActiveTags(new Set());
    setBaitOnly(false);
  };
  const hasActiveFilter =
    Boolean(query) ||
    kind !== "all" ||
    activeFlavours.size > 0 ||
    activeTags.size > 0 ||
    baitOnly;

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Seasoning Dex
        </h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          Every berry and bait seasoning known to Cobblemon. Click a card to
          see its 3D model, flavour profile, and what it attracts when used in
          a Poké Snack or Poké Bait.
        </p>
        <p className="text-[11px] text-muted mt-2">
          {berryCount} berries · {vanillaCount} vanilla bait items
        </p>
      </header>

      {/* Filter toolbar */}
      <div className="mb-4 space-y-2 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a seasoning…"
            className="flex-1 min-w-0 sm:flex-none sm:w-60 rounded-md border border-border bg-subtle px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
          <div className="flex gap-1">
            {(["all", "berry", "vanilla"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={`text-[11px] uppercase tracking-wide px-2.5 py-1 rounded-full border transition-colors ${
                  kind === k
                    ? "bg-accent text-accent-foreground border-accent"
                    : "border-border bg-card text-muted hover:text-foreground"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={baitOnly}
              onChange={(e) => setBaitOnly(e.target.checked)}
              className="accent-accent"
            />
            With bait effects
          </label>
          {hasActiveFilter && (
            <button
              type="button"
              onClick={reset}
              className="ml-auto text-[11px] uppercase tracking-wide text-muted hover:text-foreground px-2 py-1 rounded border border-border"
            >
              Reset
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1" role="group" aria-label="Flavours">
          {FLAVOURS.map((f) => {
            const active = activeFlavours.has(f);
            return (
              <button
                key={f}
                type="button"
                onClick={() => toggleFlavour(f)}
                aria-pressed={active}
                className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border transition-colors"
                style={
                  active
                    ? {
                        background: FLAVOUR_TINT[f],
                        borderColor: FLAVOUR_TINT[f],
                        color: "#1c1917",
                      }
                    : undefined
                }
              >
                {f}
              </button>
            );
          })}
        </div>

        {allTags.length > 0 && (
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label="Effect tags"
          >
            {allTags.map((tag) => {
              const active = activeTags.has(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  aria-pressed={active}
                  className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border transition-colors ${
                    active
                      ? "bg-accent text-accent-foreground border-accent"
                      : "border-border bg-card text-muted hover:text-foreground"
                  }`}
                >
                  {tag.replace(/_/g, " ")}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted mb-2">
        {filtered.length} match{filtered.length === 1 ? "" : "es"}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted">
          No seasoning matches your filters.
        </div>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {filtered.map((r) => (
            <SeasoningCard key={r.slug} row={r} />
          ))}
        </ul>
      )}
    </>
  );
}

function SeasoningCard({ row }: { row: SeasoningRow }) {
  const tint = row.dominantFlavour ? FLAVOUR_TINT[row.dominantFlavour] : null;
  // Only berries have a dedicated detail route (`/berry/[slug]`).
  // Vanilla seasonings (golden_apple, sweet_berries, glow_berries…) have
  // no page yet — render a static card instead of a 404 link.
  const cardClasses =
    "group flex flex-col items-center gap-1 rounded-lg border border-border bg-card p-3 transition-colors";
  const inner = (
    <>
      <div
        className="relative w-12 h-12 rounded-md flex items-center justify-center"
        style={{ background: tint ? `${tint}33` : undefined }}
      >
        <Image
          src={row.spriteUrl}
          alt={row.name}
          width={32}
          height={32}
          style={{ imageRendering: "pixelated" }}
          unoptimized
        />
      </div>
      <span className="text-xs font-medium capitalize text-center leading-tight group-hover:text-accent">
        {row.name}
      </span>
      <div className="flex items-center gap-1 flex-wrap justify-center">
        {row.dominantFlavour && (
          <span
            className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded text-stone-900"
            style={{ background: tint ?? "#bbb" }}
          >
            {row.dominantFlavour.toLowerCase()}
          </span>
        )}
        {row.hasBaitEffects && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-subtle text-muted">
            bait
          </span>
        )}
      </div>
    </>
  );

  return (
    <li>
      {row.kind === "berry" ? (
        <Link
          href={`/berry/${row.slug}`}
          className={`${cardClasses} hover:border-accent`}
        >
          {inner}
        </Link>
      ) : (
        <div className={cardClasses} title={row.name}>
          {inner}
        </div>
      )}
    </li>
  );
}
