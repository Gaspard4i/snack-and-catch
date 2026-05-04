import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ItemIcon } from "./ItemIcon";
import type { ZoneRecommendation } from "@/lib/recommend/best-zones";

const DIMENSION_LABELS: Record<string, string> = {
  "minecraft:overworld": "Overworld",
  "minecraft:the_nether": "Nether",
  "minecraft:the_end": "The End",
  "aether:the_aether": "Aether",
};

function prettyBiome(biome: string): string {
  return biome
    .replace(/^#/, "")
    .replace(/^[a-z0-9_]+:/, "")
    .replace(/^(?:nether|end|overworld)\//, "")
    .replace(/^is_/, "")
    .replace(/_/g, " ");
}

/**
 * `/snack` deep-link that pre-selects the zone (dimension + primary
 * biome) and the recommended cake (berry slugs as `seasoning` query
 * params).
 */
function snackHref(zone: ZoneRecommendation): string {
  const u = new URLSearchParams();
  u.set("dimension", zone.dimension);
  if (zone.primaryBiome) u.set("biome", zone.primaryBiome.replace(/^#/, ""));
  for (const slug of zone.berrySlugs) u.append("seasoning", slug);
  return `/snack?${u.toString()}`;
}

function fmtPct(p: number): string {
  if (p >= 0.01) return `${(p * 100).toFixed(2)}%`;
  if (p >= 0.0001) return `${(p * 100).toFixed(4)}%`;
  return `${(p * 100).toFixed(6)}%`;
}

export function BestZonesCards({
  zones,
  berryItemBySlug,
  labels,
}: {
  zones: ZoneRecommendation[];
  /** Used to render the right item icon for each recommended berry slug. */
  berryItemBySlug: Map<string, string>;
  labels: {
    title: string;
    empty: string;
    cakeLabel: string;
    cakeEmpty: string;
    chanceLabel: string;
    baselineLabel: string;
    biomesLabel: string;
    openInSnack: string;
  };
}) {
  if (zones.length === 0) {
    return (
      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
          {labels.title}
        </h2>
        <p className="mt-2 text-sm text-muted">{labels.empty}</p>
      </section>
    );
  }

  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
        {labels.title}
      </h2>
      <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {zones.map((zone) => {
          const dim = DIMENSION_LABELS[zone.dimension] ?? zone.dimension;
          return (
            <li key={zone.key}>
              <Link
                href={snackHref(zone)}
                className="group h-full rounded-xl border border-border bg-card p-4 flex flex-col gap-3 hover:border-accent/60 hover:bg-subtle transition-colors"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-wide text-muted">
                      {dim}
                    </div>
                    <div className="font-semibold capitalize truncate">
                      {zone.zoneTitle}
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-muted shrink-0 group-hover:text-accent transition-colors" />
                </div>

                {zone.biomes.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted">
                      {labels.biomesLabel}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {zone.biomes.slice(0, 8).map((b) => (
                        <span
                          key={b}
                          className="inline-block rounded border border-border bg-subtle/60 px-1.5 py-0.5 text-[10px] capitalize"
                          title={b}
                        >
                          {prettyBiome(b)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted">
                    {labels.chanceLabel}
                  </div>
                  <div className="font-mono text-lg text-accent">
                    {fmtPct(zone.probability)}
                  </div>
                  {zone.baselineProbability < zone.probability && (
                    <div className="text-[10px] text-muted">
                      {labels.baselineLabel}: {fmtPct(zone.baselineProbability)}
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted">
                    {labels.cakeLabel}
                  </div>
                  {zone.berrySlugs.length === 0 ? (
                    <div className="text-xs text-muted italic">{labels.cakeEmpty}</div>
                  ) : (
                    <div className="mt-1 flex items-center gap-1 flex-wrap">
                      {zone.berrySlugs.map((slug) => {
                        const itemId = berryItemBySlug.get(slug);
                        return (
                          <span
                            key={slug}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-subtle px-1.5 py-1 text-xs"
                          >
                            {itemId && <ItemIcon id={itemId} size={18} />}
                            <span className="capitalize">{slug.replace(/_/g, " ")}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
