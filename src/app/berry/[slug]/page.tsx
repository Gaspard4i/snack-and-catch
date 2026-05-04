import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { listBerries, listBaitEffects, listSpawnsWithSpecies } from "@/lib/db/queries";
import { formatBaitEffects, type RawBaitEffect } from "@/lib/recommend/bait-effects";
import { TYPE_TO_FLAVOUR } from "@/lib/recommend/snack";
import { BerryViewer } from "./BerryViewer";

type Params = { slug: string };

const FLAVOUR_TINT: Record<string, string> = {
  SWEET: "#f8b3d7",
  SPICY: "#e85a3a",
  DRY: "#7fb3d5",
  BITTER: "#735a8a",
  SOUR: "#f4d35e",
};

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const pretty = slug.replace(/_/g, " ");
  return {
    title: pretty,
    description: `Cobblemon ${pretty}: 3D model, flavours, bait effects and what it attracts.`,
  };
}

export default async function BerryPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const [berries, baitRows, spawns] = await Promise.all([
    listBerries(),
    listBaitEffects(),
    listSpawnsWithSpecies(10000),
  ]);
  const berry = berries.find((b) => b.slug === slug);
  if (!berry) notFound();

  const baitRow = baitRows.find((r) => r.itemId === berry.itemId);
  const rawEffects: RawBaitEffect[] = (baitRow?.effects ?? []) as RawBaitEffect[];
  const effects = formatBaitEffects(rawEffects);

  // Compute "what this berry attracts" by replaying which species in the
  // spawn pool match any typing/egg_group/nature affinity from the bait
  // effects. Generic effects (shiny, rarity…) don't filter by species, so
  // they're listed below as a separate "global boosts" block.
  const types = new Set<string>();
  const eggGroups = new Set<string>();
  const natureStats = new Set<string>();
  for (const eff of rawEffects) {
    const type = (eff.type ?? "").replace(/^cobblemon:/, "");
    const sub = (eff.subcategory ?? "").replace(/^cobblemon:/, "").toLowerCase();
    if (!sub) continue;
    if (type === "typing") types.add(sub);
    else if (type === "egg_group") eggGroups.add(sub);
    else if (type === "nature") natureStats.add(sub);
  }

  type Attracted = {
    speciesId: number;
    slug: string;
    name: string;
    dexNo: number;
    primaryType: string;
    secondaryType: string | null;
    reason: string;
  };

  const attractedById = new Map<number, Attracted>();
  if (types.size > 0 || eggGroups.size > 0) {
    for (const s of spawns) {
      if (attractedById.has(s.speciesId)) continue;
      const t1 = s.primaryType?.toLowerCase();
      const t2 = s.secondaryType?.toLowerCase();
      const reasons: string[] = [];
      if (t1 && types.has(t1)) reasons.push(`${t1}-type`);
      if (t2 && types.has(t2)) reasons.push(`${t2}-type`);
      if (eggGroups.size > 0) {
        const groups = (s.eggGroups ?? []).map((g) => g.toLowerCase());
        for (const g of groups) {
          if (eggGroups.has(g)) reasons.push(`${g.replace(/_/g, " ")} egg group`);
        }
      }
      if (reasons.length > 0) {
        attractedById.set(s.speciesId, {
          speciesId: s.speciesId,
          slug: s.slug,
          name: s.name,
          dexNo: s.dexNo,
          primaryType: s.primaryType,
          secondaryType: s.secondaryType,
          reason: reasons[0],
        });
      }
    }
  }
  const attracted = [...attractedById.values()]
    .sort((a, b) => a.dexNo - b.dexNo)
    .slice(0, 60);

  // Cake match: which Cobblemon types this berry's dominant flavour pairs well with.
  const cakeTypes = berry.dominantFlavour
    ? Object.entries(TYPE_TO_FLAVOUR)
        .filter(([, f]) => f === berry.dominantFlavour)
        .map(([t]) => t)
    : [];

  const tint = berry.dominantFlavour ? FLAVOUR_TINT[berry.dominantFlavour] : null;

  // Index for prev/next nav.
  const sorted = [...berries].sort((a, b) => a.slug.localeCompare(b.slug));
  const idx = sorted.findIndex((b) => b.slug === slug);
  const prev = idx > 0 ? sorted[idx - 1] : null;
  const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;

  return (
    <div className="mx-auto max-w-[1200px] px-4 sm:px-6 py-6 sm:py-10">
      <nav className="text-xs text-muted mb-4 flex items-center gap-2">
        <Link href="/seasonings" className="hover:text-foreground">
          ← Seasoning Dex
        </Link>
      </nav>

      <header className="flex items-start gap-4 mb-6">
        <div
          className="relative w-16 h-16 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: tint ? `${tint}33` : undefined }}
        >
          <Image
            src={`/textures/cobblemon/item/berries/${berry.slug}.png`}
            alt={berry.slug}
            width={48}
            height={48}
            style={{ imageRendering: "pixelated" }}
            unoptimized
          />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight capitalize">
            {berry.slug.replace(/_/g, " ")}
          </h1>
          <p className="text-sm text-muted mt-1">
            <code className="font-mono">{berry.itemId}</code>
            {berry.colour && (
              <>
                {" · "}
                <span className="capitalize">{berry.colour}</span>
              </>
            )}
            {berry.dominantFlavour && (
              <>
                {" · "}
                <span
                  className="inline-block text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded text-stone-900 align-middle"
                  style={{ background: tint ?? "#bbb" }}
                >
                  {berry.dominantFlavour.toLowerCase()}
                </span>
              </>
            )}
          </p>
          {berry.description && (
            <p className="text-sm mt-2 max-w-2xl">{berry.description}</p>
          )}
        </div>
      </header>

      <div className="grid lg:grid-cols-[420px_1fr] gap-6">
        {/* 3D + flavours */}
        <div className="space-y-4">
          <BerryViewer
            slug={berry.slug}
            fruitModel={berry.fruitModel ?? ""}
            fruitTexture={berry.fruitTexture ?? null}
            itemId={berry.itemId}
          />

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-xs uppercase tracking-wide text-muted mb-2">
              Flavour profile
            </h2>
            <ul className="space-y-1">
              {(["SWEET", "SPICY", "DRY", "BITTER", "SOUR"] as const).map((f) => {
                const v = berry.flavours?.[f] ?? 0;
                const max = 40;
                const pct = Math.min(100, (v / max) * 100);
                const isDominant = berry.dominantFlavour === f;
                return (
                  <li key={f} className="flex items-center gap-2 text-xs">
                    <span
                      className={`w-14 uppercase tracking-wide ${
                        isDominant ? "text-foreground font-semibold" : "text-muted"
                      }`}
                    >
                      {f.toLowerCase()}
                    </span>
                    <div className="flex-1 h-2 rounded bg-subtle overflow-hidden">
                      <div
                        className="h-full rounded transition-all"
                        style={{
                          width: `${pct}%`,
                          background: FLAVOUR_TINT[f],
                          opacity: v > 0 ? 1 : 0.2,
                        }}
                      />
                    </div>
                    <span className="w-8 text-right font-mono tabular-nums">
                      {v}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {berry.effectTags && berry.effectTags.length > 0 && (
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-xs uppercase tracking-wide text-muted mb-2">
                Item tags
              </h2>
              <div className="flex flex-wrap gap-1">
                {berry.effectTags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-subtle"
                  >
                    {tag.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Bait effects + attracted */}
        <div className="space-y-4">
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-xs uppercase tracking-wide text-muted mb-2">
              Bait effects ({effects.length})
            </h2>
            {effects.length === 0 ? (
              <p className="text-sm text-muted">
                No bait effects documented for this berry.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {effects.map((eff, i) => (
                  <li
                    key={`${eff.kind}-${i}`}
                    className="flex items-start gap-2 text-sm"
                  >
                    <span className="text-[10px] font-mono shrink-0 w-12 mt-0.5 text-muted tabular-nums text-right">
                      {Math.round(eff.chance * 100)}%
                    </span>
                    <div className="flex-1">
                      <div className="font-medium">{eff.title}</div>
                      <div className="text-xs text-muted">{eff.description}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-xs uppercase tracking-wide text-muted mb-2">
              Attracts ({attracted.length})
            </h2>
            {attracted.length === 0 ? (
              <p className="text-sm text-muted">
                {types.size === 0 && eggGroups.size === 0
                  ? "No type / egg-group bias. this berry boosts generic stats only."
                  : "No matching species in the world pool."}
              </p>
            ) : (
              <ul className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                {attracted.map((a) => (
                  <li key={a.speciesId}>
                    <Link
                      href={`/pokemon/${a.slug}`}
                      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-subtle text-xs"
                    >
                      <span className="font-mono text-[10px] text-muted tabular-nums">
                        #{String(a.dexNo).padStart(3, "0")}
                      </span>
                      <span className="capitalize truncate">{a.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {attracted.length === 60 && (
              <p className="text-[10px] text-muted mt-2">
                Showing the first 60 results.
              </p>
            )}
          </section>

          {cakeTypes.length > 0 && (
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-xs uppercase tracking-wide text-muted mb-2">
                Poké Cake match
              </h2>
              <p className="text-xs text-muted mb-2">
                A {berry.dominantFlavour?.toLowerCase()} cake biases encounters
                toward Cobblemon of these types:
              </p>
              <div className="flex flex-wrap gap-1">
                {cakeTypes.map((t) => (
                  <span
                    key={t}
                    className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-subtle capitalize"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {(prev || next) && (
        <div className="flex items-center justify-between mt-8 text-xs text-muted">
          {prev ? (
            <Link
              href={`/berry/${prev.slug}`}
              className="hover:text-foreground capitalize"
            >
              ← {prev.slug.replace(/_/g, " ")}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              href={`/berry/${next.slug}`}
              className="hover:text-foreground capitalize"
            >
              {next.slug.replace(/_/g, " ")} →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
