import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const species = await getSpeciesBySlug(slug);
  if (!species) return { title: "Snack & Catch" };
  const types = [species.primaryType, species.secondaryType].filter(Boolean).join(" / ");
  return {
    title: species.name,
    description: `#${String(species.dexNo).padStart(4, "0")} ${species.name}. ${types}. Spawns, recettes et appâts pour Cobblemon.`,
  };
}
import {
  getSourcesFor,
  getSpeciesBySlug,
  getSpeciesNeighbors,
  getWikiSummary,
  listBaitEffects,
  listBerries,
  listCobblemonSpawnsForSpecies,
  listFormsOfBase,
  listSpawnsWithSpecies,
} from "@/lib/db/queries";
import { bestZonesForSpecies } from "@/lib/recommend/best-zones";
import { BestZonesCards } from "@/components/BestZonesCards";
import { SourceBadge } from "@/components/SourceBadge";
import { TypePair } from "@/components/TypeBadge";
import { VariantBadge } from "@/components/VariantBadge";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SpeciesHero } from "@/components/SpeciesHero";
import { FormTabs } from "@/components/FormTabs";
import { EvolutionChain } from "@/components/EvolutionChain";
import { ItemIcon } from "@/components/ItemIcon";
import {
  rankBaitsForSpecies,
  strongestStatOf,
  type SeasoningLike,
} from "@/lib/recommend/bait-for-species";
import { formatBaitEffects, type RawBaitEffect } from "@/lib/recommend/bait-effects";
import { BAIT_VANILLA_ITEMS } from "@/lib/recommend/bait-effects";
import { listAllSeasonings } from "@/lib/db/queries";
import { PageSkeleton } from "@/components/Loader";
import { BackLink } from "@/components/BackLink";

function formatBiome(biome: string) {
  return biome.replace(/^#?cobblemon:/, "").replace(/is_/, "").replace(/_/g, " ");
}

function prettyId(id: string): string {
  // `#cobblemon:is_lush` → `is lush`, `minecraft:village` → `village`.
  return id.replace(/^#?[a-z0-9_]+:/, "").replace(/_/g, " ");
}

function joinList(items: string[]): string {
  return items.map(prettyId).join(", ");
}

const MOON_PHASE_LABELS = [
  "full",
  "waning gibbous",
  "last quarter",
  "waning crescent",
  "new",
  "waxing crescent",
  "first quarter",
  "waxing gibbous",
];

/**
 * Exhaustive renderer for a Cobblemon `condition` block. Each key produces
 * one human-readable line; the goal is to mirror what an in-game
 * Pokefinder/Cobblenav would surface so a player can read the full
 * gating without having to inspect the JSON.
 *
 * Returns plain strings so the caller can decide on layout. Empty array
 * when nothing is configured.
 */
function formatCondition(
  cond: unknown,
  t: (key: string, values?: Record<string, string | number>) => string,
): string[] {
  if (!cond || typeof cond !== "object") return [];
  const c = cond as Record<string, unknown>;
  const parts: string[] = [];

  if (typeof c.timeRange === "string") parts.push(t("condition.time", { value: c.timeRange }));
  if (c.moonPhase !== undefined) {
    const raw = typeof c.moonPhase === "number" ? c.moonPhase : Number.parseInt(String(c.moonPhase), 10);
    if (Number.isFinite(raw)) {
      parts.push(t("condition.moon", { value: MOON_PHASE_LABELS[raw] ?? String(raw) }));
    }
  }

  if (c.isRaining === true) parts.push(t("condition.raining"));
  else if (c.isRaining === false) parts.push(t("condition.notRaining"));
  if (c.isThundering === true) parts.push(t("condition.thundering"));
  else if (c.isThundering === false) parts.push(t("condition.notThundering"));
  if (c.canSeeSky === true) parts.push(t("condition.openSky"));
  else if (c.canSeeSky === false) parts.push(t("condition.coveredSky"));
  if (c.isSlimeChunk === true) parts.push(t("condition.slimeChunk"));

  if (typeof c.minY === "number" || typeof c.maxY === "number") {
    parts.push(
      t("condition.y", {
        min: typeof c.minY === "number" ? c.minY : "-∞",
        max: typeof c.maxY === "number" ? c.maxY : "+∞",
      }),
    );
  }
  if (typeof c.minLight === "number" || typeof c.maxLight === "number") {
    parts.push(
      t("condition.light", {
        min: typeof c.minLight === "number" ? c.minLight : 0,
        max: typeof c.maxLight === "number" ? c.maxLight : 15,
      }),
    );
  }
  if (typeof c.minSkyLight === "number" || typeof c.maxSkyLight === "number") {
    parts.push(
      t("condition.skyLight", {
        min: typeof c.minSkyLight === "number" ? c.minSkyLight : 0,
        max: typeof c.maxSkyLight === "number" ? c.maxSkyLight : 15,
      }),
    );
  }
  if (typeof c.minDepth === "number" || typeof c.maxDepth === "number") {
    parts.push(
      t("condition.depth", {
        min: typeof c.minDepth === "number" ? c.minDepth : 0,
        max: typeof c.maxDepth === "number" ? c.maxDepth : "+∞",
      }),
    );
  }

  if (Array.isArray(c.dimensions) && c.dimensions.length > 0) {
    parts.push(t("condition.dimensions", { value: joinList(c.dimensions as string[]) }));
  }
  if (Array.isArray(c.structures) && c.structures.length > 0) {
    parts.push(t("condition.structures", { value: joinList(c.structures as string[]) }));
  }
  if (Array.isArray(c.neededBaseBlocks) && c.neededBaseBlocks.length > 0) {
    parts.push(t("condition.blocks", { value: joinList(c.neededBaseBlocks as string[]) }));
  }
  if (Array.isArray(c.neededNearbyBlocks) && c.neededNearbyBlocks.length > 0) {
    parts.push(t("condition.nearbyBlocks", { value: joinList(c.neededNearbyBlocks as string[]) }));
  }
  if (typeof c.fluid === "string") {
    parts.push(t("condition.fluid", { value: prettyId(c.fluid) }));
  }
  if (c.fluidIsSource === true) parts.push(t("condition.fluidSource"));
  if (Array.isArray(c.labels) && c.labels.length > 0) {
    const mode = (c.labelMode as string | undefined) ?? "ANY";
    parts.push(t("condition.labels", { value: (c.labels as string[]).join(", "), mode }));
  }
  return parts;
}

async function SpeciesDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const species = await getSpeciesBySlug(slug);
  if (!species) notFound();

  const [
    spawns,
    sources,
    baits,
    berries,
    seasonings,
    wiki,
    neighbors,
    forms,
    worldSpawns,
    t,
  ] = await Promise.all([
    listCobblemonSpawnsForSpecies(species.id),
    getSourcesFor("species", species.id),
    listBaitEffects(),
    listBerries(),
    listAllSeasonings(),
    getWikiSummary(species.id),
    getSpeciesNeighbors(slug),
    listFormsOfBase(slug),
    listSpawnsWithSpecies(15000),
    getTranslations("pokemon"),
  ]);

  const primarySource = sources[0];

  // Build the pool of valid bait seasonings with their raw effects, and rank
  // them by how much they actually help catch THIS Cobblemon.
  const baitByItem = new Map<string, RawBaitEffect[]>();
  for (const b of baits as Array<{ itemId: string; effects: RawBaitEffect[] }>) {
    baitByItem.set(b.itemId, b.effects as RawBaitEffect[]);
  }
  const pool: SeasoningLike[] = [];
  for (const b of berries) {
    pool.push({
      slug: b.slug,
      itemId: b.itemId,
      colour: b.colour,
      flavours: b.flavours,
      dominantFlavour: b.dominantFlavour,
      rawBaitEffects: baitByItem.get(b.itemId) ?? [],
      baitEffects: formatBaitEffects(baitByItem.get(b.itemId) ?? []),
    });
  }
  for (const s of seasonings) {
    if (!BAIT_VANILLA_ITEMS.has(s.itemId)) continue;
    pool.push({
      slug: s.slug,
      itemId: s.itemId,
      colour: s.colour,
      flavours: {},
      dominantFlavour: null,
      rawBaitEffects: baitByItem.get(s.itemId) ?? [],
      baitEffects: formatBaitEffects(baitByItem.get(s.itemId) ?? []),
    });
  }
  const rawSpecies = (species.raw ?? {}) as Record<string, unknown>;
  const eggGroups = (rawSpecies.eggGroups as string[] | undefined) ?? [];
  // Pick the RAREST bucket among this species' spawns: that's the floor
  // the player will hit when looking for a dropping. Ultra-rare > rare >
  // uncommon > common. When no spawn exists at all (legendary not yet
  // ingested), treat as ultra-rare so we surface tier-up baits.
  const BUCKET_RANK: Record<string, number> = {
    common: 0,
    uncommon: 1,
    rare: 2,
    "ultra-rare": 3,
  };
  const rarestBucket = spawns.length === 0
    ? "ultra-rare"
    : (spawns.reduce<typeof spawns[number]["bucket"]>(
        (acc, s) => (BUCKET_RANK[s.bucket] > BUCKET_RANK[acc] ? s.bucket : acc),
        "common",
      ));
  const rankedSeasonings = rankBaitsForSpecies(
    pool,
    {
      primaryType: species.primaryType,
      secondaryType: species.secondaryType,
      eggGroups,
      strongestStat: strongestStatOf(species.baseStats),
      rarestBucket,
    },
    { limit: 24 },
  );

  // Best zones to find this Pokémon. Each zone gets a greedy-optimised
  // berry cake; only berries whose effects can move the target's odds
  // are considered (typing match / egg group / rarity boost) — keeps
  // the search tractable per page load.
  const berryBaits = berries.map((b) => ({
    slug: b.slug,
    effects: (baitByItem.get(b.itemId) ?? []) as Array<Record<string, unknown>>,
  }));
  const bestZones = bestZonesForSpecies({
    speciesId: species.id,
    spawns: worldSpawns,
    berries: berryBaits,
  });
  const berryItemBySlug = new Map<string, string>();
  for (const b of berries) berryItemBySlug.set(b.slug, b.itemId);

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <BackLink
          fallback="/pokedex"
          className="text-sm text-muted hover:text-foreground transition-colors"
        >
          {t("back")}
        </BackLink>
        <div className="flex items-center gap-1">
          {neighbors.prev ? (
            <Link
              href={`/pokemon/${neighbors.prev.slug}`}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground border border-border rounded-md px-2 py-1"
              title={`${neighbors.prev.name} #${String(neighbors.prev.dexNo).padStart(4, "0")}`}
            >
              <ChevronLeft className="size-3.5" />
              <span className="hidden sm:inline">{neighbors.prev.name}</span>
            </Link>
          ) : (
            <span className="inline-flex items-center text-xs text-muted/50 border border-border rounded-md px-2 py-1">
              <ChevronLeft className="size-3.5" />
            </span>
          )}
          {neighbors.next ? (
            <Link
              href={`/pokemon/${neighbors.next.slug}`}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground border border-border rounded-md px-2 py-1"
              title={`${neighbors.next.name} #${String(neighbors.next.dexNo).padStart(4, "0")}`}
            >
              <span className="hidden sm:inline">{neighbors.next.name}</span>
              <ChevronRight className="size-3.5" />
            </Link>
          ) : (
            <span className="inline-flex items-center text-xs text-muted/50 border border-border rounded-md px-2 py-1">
              <ChevronRight className="size-3.5" />
            </span>
          )}
        </div>
      </div>

      <header className="mt-4 flex items-center gap-4 flex-wrap">
        <SpeciesHero
          dexNo={species.dexNo}
          name={species.name}
          baseSlug={species.slug.replace(
            /-(?:alolan|galarian|hisuian|paldean(?:-.*)?|mega(?:-.*)?|gmax|tera.*).*$/,
            "",
          )}
          variantLabel={species.variantLabel}
        />
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-muted font-mono">
              #{String(species.dexNo).padStart(4, "0")}
            </span>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight truncate">{species.name}</h1>
            {species.variantLabel && (
              <VariantBadge variantLabel={species.variantLabel} inline />
            )}
            <SourceBadge
              kind="mod"
              name="cobblemon"
              href={primarySource?.url ?? undefined}
            />
          </div>
          <div className="mt-2 flex items-center gap-3 flex-wrap text-sm text-muted">
            <TypePair primary={species.primaryType} secondary={species.secondaryType} size={24} />
            <span>{t("captureRate", { value: species.catchRate })}</span>
            {species.baseFriendship != null && (
              <span>{t("friendship", { value: species.baseFriendship })}</span>
            )}
          </div>
        </div>
      </header>

      <FormTabs forms={forms} currentSlug={slug} />

      {wiki?.summary && (
        <section className="mt-6 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
              {t("notes")}
            </h2>
            <SourceBadge kind="wiki" href={wiki.pageUrl} />
          </div>
          <p className="mt-2 text-sm leading-relaxed whitespace-pre-line">
            {wiki.summary.split("\n\n")[0]}
          </p>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">{t("stats")}</h2>
        <dl className="mt-2 grid grid-cols-3 sm:grid-cols-6 gap-2">
          {Object.entries(species.baseStats).map(([k, v]) => {
            const value = v as number;
            const pct = Math.min(100, (value / 255) * 100);
            return (
              <div
                key={k}
                className="rounded-md border border-border bg-card px-3 py-2 relative overflow-hidden"
              >
                <div
                  className="absolute inset-y-0 left-0 bg-accent/15"
                  style={{ width: `${pct}%` }}
                />
                <div className="relative">
                  <dt className="text-[10px] uppercase text-muted">{k.replace("_", " ")}</dt>
                  <dd className="font-mono text-lg">{value}</dd>
                </div>
              </div>
            );
          })}
        </dl>
        {species.abilities && species.abilities.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="text-muted uppercase">Abilities:</span>
            {(species.abilities as string[]).map((a: string, i: number) => (
              <span
                key={i}
                className={`px-2 py-0.5 rounded-full border capitalize ${
                  a.startsWith("h:")
                    ? "border-accent text-accent bg-accent/5"
                    : "border-border bg-subtle"
                }`}
                title={a.startsWith("h:") ? "Hidden ability" : "Ability"}
              >
                {a.replace(/^h:/, "").replaceAll("_", " ")}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
          Best bait seasonings for {species.name}
        </h2>
        <p className="mt-1 text-xs text-muted">
          Ranked by how much they bias the encounter toward this Cobblemon , 
          type, egg-group, and nature alignment come first, rarity and shiny
          boosts next.
        </p>
        {rankedSeasonings.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            No documented bait seasoning biases the encounter toward this
            Cobblemon yet.
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-3">
            {rankedSeasonings.map((r, i) => {
              // Only berries (slug ending in _berry) have a /berry/[slug]
              // page. Vanilla bait items stay as plain cards.
              const isBerry = r.seasoning.slug.endsWith("_berry");
              const inner = (
                <>
                  {i < 3 && (
                    <span className="absolute -top-2 -left-2 size-5 rounded-full bg-accent text-accent-foreground text-[10px] font-mono font-bold flex items-center justify-center shadow">
                      {i + 1}
                    </span>
                  )}
                  <ItemIcon id={r.seasoning.itemId} size={48} />
                  <div className="text-xs font-medium capitalize leading-tight">
                    {r.seasoning.slug.replaceAll("_", " ")}
                  </div>
                  <div className="text-[10px] uppercase text-accent font-medium">
                    {r.primaryReason}
                  </div>
                  {r.reasons.length > 1 && (
                    <div className="text-[9px] text-muted leading-tight">
                      + {r.reasons.slice(1, 3).join(" · ")}
                    </div>
                  )}
                </>
              );
              const cardClass = `relative rounded-lg border p-3 flex flex-col items-center gap-1 w-28 text-center transition-transform ${
                i < 3
                  ? "border-2 border-accent bg-accent/5 shadow-sm"
                  : "border-border bg-card"
              } ${i === 0 ? "scale-105" : ""}`;
              return (
                <li
                  key={r.seasoning.slug}
                  title={r.reasons.join(" · ")}
                >
                  {isBerry ? (
                    <Link
                      href={`/berry/${r.seasoning.slug}`}
                      className={`${cardClass} hover:border-accent/80 hover:bg-accent/10 cursor-pointer`}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div className={cardClass}>{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {Array.isArray(rawSpecies.evolutions) && rawSpecies.evolutions.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
            {t("evolution")}
          </h2>
          <EvolutionChain
            speciesName={species.name}
            evolutions={rawSpecies.evolutions as Array<{
              result?: string;
              variant?: string;
              requiredContext?: string;
            }>}
          />
        </section>
      )}

      <BestZonesCards
        zones={bestZones}
        berryItemBySlug={berryItemBySlug}
        labels={{
          title: t("bestZones.title"),
          empty: t("bestZones.empty"),
          cakeLabel: t("bestZones.cakeLabel"),
          cakeEmpty: t("bestZones.cakeEmpty"),
          chanceLabel: t("bestZones.chanceLabel"),
          baselineLabel: t("bestZones.baselineLabel"),
          biomesLabel: t("bestZones.biomesLabel"),
          openInSnack: t("bestZones.openInSnack"),
        }}
      />

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
          {t("spawnsCount", { count: spawns.length })}
        </h2>
        {spawns.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t("noSpawn")}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {spawns.map((s) => (
              <li key={s.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs rounded bg-subtle px-1.5 py-0.5 capitalize">
                      {s.bucket}
                    </span>
                    <span className="text-xs text-muted">
                      {t("levelRange", { min: s.levelMin, max: s.levelMax })} ·{" "}
                      {t("weight", { value: s.weight })}
                    </span>
                  </div>
                  <SourceBadge
                    kind={s.sourceKind === "addon" ? "addon" : "mod"}
                    name={s.sourceName}
                    href={s.sourceUrl ?? undefined}
                  />
                </div>
                {s.positionType && (
                  <div className="mt-2 text-xs text-muted">
                    <span className="uppercase tracking-wide">{t("context")}: </span>
                    <span className="capitalize">{prettyId(s.positionType)}</span>
                  </div>
                )}
                {s.biomes.length > 0 && (
                  <div className="mt-2 text-sm flex flex-wrap gap-x-2 gap-y-1 items-baseline">
                    <span className="text-muted">{t("biomes")}</span>
                    {s.biomes.map((b, i) => (
                      <Link
                        key={i}
                        href={`/biome/${encodeURIComponent(b.replace(/^#/, ""))}`}
                        className="underline decoration-dotted underline-offset-2 hover:text-accent capitalize"
                      >
                        {formatBiome(b)}
                      </Link>
                    ))}
                  </div>
                )}
                {formatCondition(s.condition, t as never).map((line, i) => (
                  <div key={`c-${i}`} className="text-xs text-muted mt-1">
                    {line}
                  </div>
                ))}
                {formatCondition(s.anticondition, t as never).map((line, i) => (
                  <div key={`a-${i}`} className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                    <span className="uppercase tracking-wide mr-1">{t("except")}</span>
                    {line}
                  </div>
                ))}
                {s.presets && s.presets.length > 0 && (
                  <div className="mt-2 text-xs text-muted flex flex-wrap gap-1">
                    <span className="uppercase tracking-wide mr-1">{t("presets")}</span>
                    {s.presets.map((p, i) => (
                      <span
                        key={i}
                        className="rounded bg-subtle px-1.5 py-0.5 capitalize"
                      >
                        {p.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                )}
                {Array.isArray(s.weightMultipliers) &&
                  (s.weightMultipliers as Array<{ multiplier: number; condition?: unknown }>).map(
                    (wm, i) => {
                      const lines = formatCondition(wm.condition, t as never);
                      return (
                        <div key={`wm-${i}`} className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                          <span className="uppercase tracking-wide mr-1">×{wm.multiplier}</span>
                          {lines.length > 0 ? lines.join(" · ") : t("ifAny")}
                        </div>
                      );
                    },
                  )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function Page({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-10">
      <Suspense fallback={<PageSkeleton variant="pokemon" />}>
        <SpeciesDetail params={params} />
      </Suspense>
    </div>
  );
}
