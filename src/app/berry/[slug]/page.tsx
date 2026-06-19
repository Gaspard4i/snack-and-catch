import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import {
  listBerries,
  listBaitEffects,
  listSpawnsWithSpecies,
  listBerryDrops,
} from "@/lib/db/queries";
import { formatBaitEffects, type RawBaitEffect } from "@/lib/recommend/bait-effects";
import { TYPE_TO_FLAVOUR } from "@/lib/recommend/snack";
import { BerryViewer } from "./BerryViewer";

/** Strip "cobblemon:is_plains" → "plains" for display. */
function shortBiomeLabel(tag: string): string {
  return tag
    .replace(/^#/, "")
    .replace(/^[^:]+:/, "")
    .replace(/^is_/, "")
    .replace(/_/g, " ");
}

/** Pick a desaturated badge palette per biome family. Colors are kept
 *  muted on purpose — flashy chips become noisy when there are 12 of
 *  them next to each other. We use `-600/30` text in light mode and
 *  `-300/70` in dark mode for soft contrast, with a low-saturation
 *  background tint and a barely-there border. Order matters — first
 *  match wins. */
const BIOME_PALETTES: { match: RegExp; classes: string }[] = [
  { match: /nether|crimson|warped|basalt|soul_sand|soul_fire|fungus|wasteland|inferno|volcanic|magma/i,
    classes: "bg-red-500/[0.06] text-red-700/80 dark:text-red-300/70 border-red-500/15" },
  { match: /end|void|obsidian|chorus|purpur|shulkren|shattered/i,
    classes: "bg-purple-500/[0.06] text-purple-700/80 dark:text-purple-300/70 border-purple-500/15" },
  { match: /snow|ice|frozen|tundra|glacial|cold|freezing|wintry|siberian/i,
    classes: "bg-cyan-500/[0.06] text-cyan-700/80 dark:text-cyan-300/70 border-cyan-500/15" },
  { match: /ocean|sea|river|coast|beach|aquatic|island/i,
    classes: "bg-blue-500/[0.06] text-blue-700/80 dark:text-blue-300/70 border-blue-500/15" },
  { match: /swamp|bog|marsh|bayou|wetland|mangrove|freshwater/i,
    classes: "bg-teal-500/[0.06] text-teal-700/80 dark:text-teal-300/70 border-teal-500/15" },
  { match: /forest|jungle|taiga|grove|wood|bamboo|cherry|sakura|spooky|mushroom|orchard/i,
    classes: "bg-emerald-500/[0.06] text-emerald-700/80 dark:text-emerald-300/70 border-emerald-500/15" },
  { match: /plains|meadow|floral|grassland|prairie|shrubland|temperate|field|pasture/i,
    classes: "bg-lime-600/[0.06] text-lime-700/80 dark:text-lime-300/70 border-lime-600/15" },
  { match: /mountain|peak|highland|hill|plateau|cliff|spire|cragged/i,
    classes: "bg-slate-500/[0.06] text-slate-700/80 dark:text-slate-300/70 border-slate-500/15" },
  { match: /cave|underground|deep_dark|lush|dripstone|hypogeal/i,
    classes: "bg-stone-500/[0.06] text-stone-700/80 dark:text-stone-300/70 border-stone-500/15" },
  { match: /savanna|arid|desert|badland|sandy|dryland|mesa|canyon|yellowstone/i,
    classes: "bg-amber-600/[0.06] text-amber-700/80 dark:text-amber-300/70 border-amber-600/15" },
  { match: /sky|magical|aether|cloud|skyland|skyris|skyfields|paradise|moonlight/i,
    classes: "bg-indigo-500/[0.06] text-indigo-700/80 dark:text-indigo-300/70 border-indigo-500/15" },
  { match: /bumblezone|hive|pollen|honey|bee/i,
    classes: "bg-yellow-600/[0.06] text-yellow-700/80 dark:text-yellow-300/70 border-yellow-600/15" },
  { match: /mirage|mystic|enchanted|lavender|rainbow|origin|ominous|fragment|witch|nightshade/i,
    classes: "bg-pink-500/[0.06] text-pink-700/80 dark:text-pink-300/70 border-pink-500/15" },
];

const DEFAULT_BIOME_BADGE =
  "bg-subtle text-muted hover:text-foreground border-border";

function biomeBadgeClasses(id: string): string {
  for (const p of BIOME_PALETTES) {
    if (p.match.test(id)) return p.classes;
  }
  return DEFAULT_BIOME_BADGE;
}

/** Pretty-print Cobblemon's berry held-item effect. Source: the
 *  effect_tags column (extracted from raw at ingest time) — these are
 *  the tags Cobblemon attaches to a berry to model its in-battle held
 *  behaviour, separate from bait/snack effects which apply to the bait
 *  block. */
function describeHeldEffect(tags: string[]): { title: string; body: string } | null {
  if (!tags || tags.length === 0) return null;
  const lines = tags
    .map((t) => HELD_EFFECT_LABELS[t])
    .filter((x): x is string => !!x);
  if (lines.length === 0) return null;
  return {
    title: "Held item effect",
    body: lines.join(" • "),
  };
}

const HELD_EFFECT_LABELS: Record<string, string> = {
  hp_recovery: "Restores HP when low",
  status_recovery: "Cures status conditions",
  pp_restore: "Restores PP",
  pinch_boost: "Triggers a pinch effect at low HP",
  type_resist: "Reduces damage from a super-effective hit",
  stat_buff_atk: "Boosts Attack in a pinch",
  stat_buff_def: "Boosts Defense in a pinch",
  stat_buff_spa: "Boosts Sp. Atk in a pinch",
  stat_buff_spd: "Boosts Sp. Def in a pinch",
  stat_buff_spe: "Boosts Speed in a pinch",
  confusion_food: "Heals HP but may confuse",
  evolution_item: "Used for evolution",
};

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
  const [berries, baitRows, spawns, allDrops] = await Promise.all([
    listBerries(),
    listBaitEffects(),
    listSpawnsWithSpecies(10000),
    listBerryDrops(),
  ]);
  const berry = berries.find((b) => b.slug === slug);
  if (!berry) notFound();

  // Pokémon that drop this berry, most likely first. Guaranteed
  // quantity-range drops (no percentage) sort last but stay listed.
  const droppedBy = allDrops
    .filter((d) => d.berryItemId === berry.itemId)
    .sort((a, b) => (b.percentage ?? -1) - (a.percentage ?? -1));

  const baitRow = baitRows.find((r) => r.itemId === berry.itemId);
  const rawEffects: RawBaitEffect[] = (baitRow?.effects ?? []) as RawBaitEffect[];
  const effects = formatBaitEffects(rawEffects);

  // Spawnable berries list their preferred biome tags in the raw
  // datapack. Mutation-only berries (Lum, Figy, Mago…) have an empty
  // spawnConditions and we surface a different message.
  const rawJson = (berry.raw ?? {}) as Record<string, unknown>;
  const spawnConditions = Array.isArray(rawJson.spawnConditions)
    ? (rawJson.spawnConditions as unknown[])
    : [];
  const preferredBiomeTags =
    spawnConditions.length > 0 && Array.isArray(rawJson.preferredBiomeTags)
      ? (rawJson.preferredBiomeTags as unknown[]).filter(
          (x): x is string => typeof x === "string",
        )
      : [];

  // Resolve each preferred tag into the concrete biomes it owns. We
  // include the leading `#` form because that's how the spawn matcher
  // stores tag references, but biome_tag_members keys are stored
  // verbatim from the upstream `values:` field — usually with `#`.
  const tagLookups = preferredBiomeTags.flatMap((t) => [
    t.startsWith("#") ? t : `#${t}`,
    t.replace(/^#/, ""),
  ]);
  const memberRows =
    tagLookups.length > 0
      ? await db
          .select({
            tagId: schema.biomeTagMembers.tagId,
            biomeId: schema.biomeTagMembers.biomeId,
          })
          .from(schema.biomeTagMembers)
          .where(sql`${schema.biomeTagMembers.tagId} IN ${tagLookups}`)
      : [];
  const biomesByTag = new Map<string, string[]>();
  for (const r of memberRows) {
    const key = preferredBiomeTags.find(
      (t) => t === r.tagId || `#${t}` === r.tagId || t === r.tagId.replace(/^#/, ""),
    );
    if (!key) continue;
    const list = biomesByTag.get(key) ?? [];
    if (!list.includes(r.biomeId)) list.push(r.biomeId);
    biomesByTag.set(key, list);
  }

  const heldEffect = describeHeldEffect(berry.effectTags ?? []);

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

          {heldEffect && (
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-xs uppercase tracking-wide text-muted mb-2">
                {heldEffect.title}
              </h2>
              <p className="text-sm">{heldEffect.body}</p>
            </section>
          )}

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-xs uppercase tracking-wide text-muted mb-2">
              Where it grows
            </h2>
            {preferredBiomeTags.length === 0 ? (
              <p className="text-sm text-muted">
                Doesn&apos;t grow in the wild — you obtain this berry by
                crossing two parent berries on a sapling (mutation only).
              </p>
            ) : (
              <>
                <p className="text-xs text-muted mb-3">
                  Wild bushes spawn in these biomes:
                </p>
                <ul className="space-y-3">
                {preferredBiomeTags.map((tag) => {
                  const biomes = biomesByTag.get(tag) ?? [];
                  return (
                    <li key={tag}>
                      <div className="mb-1">
                        <span className="text-sm font-medium capitalize">
                          {shortBiomeLabel(tag)}
                        </span>
                        {biomes.length > 0 && (
                          <span className="text-[10px] text-muted ml-1.5">
                            ({biomes.length} biome{biomes.length > 1 ? "s" : ""})
                          </span>
                        )}
                      </div>
                      {biomes.length === 0 ? (
                        <p className="text-xs text-muted">
                          No concrete biome listed for this tag.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {biomes.slice(0, 12).map((b) => (
                            <Link
                              key={b}
                              href={`/biome/${encodeURIComponent(b)}`}
                              className={`text-[10px] px-1.5 py-0.5 rounded border capitalize transition-colors hover:opacity-80 ${biomeBadgeClasses(b)}`}
                              title={b}
                            >
                              {b.replace(/^[^:]+:/, "").replace(/_/g, " ")}
                            </Link>
                          ))}
                          {biomes.length > 12 && (
                            <span
                              title={biomes.slice(12).join(", ")}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-subtle text-muted"
                            >
                              +{biomes.length - 12}
                            </span>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
                </ul>
              </>
            )}
          </section>
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

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-xs uppercase tracking-wide text-muted mb-2">
              Dropped by Pokémon ({droppedBy.length})
            </h2>
            {droppedBy.length === 0 ? (
              <p className="text-sm text-muted">
                No Pokémon drops this berry — grow it from a sapling instead.
              </p>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {droppedBy.map((d) => (
                  <li key={d.speciesId}>
                    <Link
                      href={`/pokemon/${d.slug}`}
                      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-subtle text-xs"
                    >
                      <span className="font-mono text-[10px] text-muted tabular-nums">
                        #{String(d.dexNo).padStart(3, "0")}
                      </span>
                      <span className="capitalize truncate flex-1">{d.name}</span>
                      <span className="font-mono text-[10px] text-muted tabular-nums shrink-0">
                        {d.percentage != null
                          ? `${d.percentage % 1 === 0 ? d.percentage : d.percentage.toFixed(1)}%`
                          : d.quantityRange ?? "drop"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
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
