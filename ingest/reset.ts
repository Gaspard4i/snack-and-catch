/**
 * One-shot ingest that wipes spawn-side data and rebuilds it from the
 * authoritative Cobblemon GitLab repo. Vanilla Cobblemon + vanilla
 * Minecraft only — addons / datapacks are out of scope for this pass.
 *
 * Order matters because of FKs:
 *   data_sources, species_wiki, spawns, spawn_presets, species,
 *   biome_tag_structures, biome_tag_members, biome_tags, structures,
 *   dimensions, mods.
 *
 * The script then re-seeds in dependency order:
 *   mods → dimensions → biome_tags + biome_tag_members → structures
 *   → spawn_presets → species (+ regional variants) → spawns
 *
 * Each spawn entry carries pre-extracted scalar columns
 * (condition_dimensions[], condition_biome_tags[], …) so the matcher
 * needs only one SELECT.
 */
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { readdir } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db, schema } from "../src/lib/db/client";
import {
  cloneRepo,
  dataPath,
  gitlabBlobUrl,
  listJsonFiles,
  readJson,
  relativeDataPath,
  type RepoClone,
} from "../src/lib/sources/gitlab";
import { speciesSchema, type SpeciesForm } from "../src/lib/parsers/species";
import {
  spawnFileSchema,
  parseLevelRange,
  presetFileSchema,
  applyPresets,
  type PresetFile,
  type SpawnEntry,
  type SpawnCondition,
} from "../src/lib/parsers/spawn";
import {
  seasoningSchema,
  baitEffectSchema,
  berrySchema,
  dominantFlavour,
} from "../src/lib/parsers/seasoning";
import { cookingRecipeSchema, shapedToGrid, classifyRecipe } from "../src/lib/parsers/recipe";
import { ingestBerryDrops } from "../src/lib/ingest/berry-drops";
import { relative } from "node:path";

const CACHE_DIR = join(tmpdir(), "snack-and-catch-cobblemon");

const ALLOWED_NAMESPACES = new Set(["minecraft", "cobblemon", "c"]);

/**
 * `species.forms[]` covers regional variants (alolan, galarian, …) AND
 * a long tail of cosmetic / mechanic forms (mega, gmax, plate, drive,
 * costume…). Only the prefixes below count as "regional" for the
 * Cobbledex filter.
 */
const REGIONAL_VARIANT_PREFIXES = [
  "alolan",
  "galarian",
  "hisuian",
  "paldean",
];

function slugify(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
}

function stripHash(s: string): string {
  return s.replace(/^#/, "");
}

function namespaceOf(id: string): string {
  const stripped = stripHash(id);
  const i = stripped.indexOf(":");
  return i >= 0 ? stripped.slice(0, i) : "";
}

function isAllowedNamespace(id: string): boolean {
  const ns = namespaceOf(id);
  return !ns || ALLOWED_NAMESPACES.has(ns);
}

/* ────────────────────────────────────────────────────────────────
 *  TRUNCATE
 * ──────────────────────────────────────────────────────────────── */

async function truncateSpawnSide() {
  console.log("[reset] truncating spawn-side tables");
  await db.execute(sql`
    TRUNCATE TABLE
      "berry_drops",
      "data_sources",
      "species_wiki",
      "spawns",
      "spawn_presets",
      "species",
      "biome_tag_structures",
      "biome_tag_members",
      "biome_tags",
      "structures",
      "dimensions",
      "mods"
    RESTART IDENTITY CASCADE
  `);
}

/* ────────────────────────────────────────────────────────────────
 *  MODS + DIMENSIONS (hard-coded vanilla)
 * ──────────────────────────────────────────────────────────────── */

const SEED_MODS: Array<typeof schema.mods.$inferInsert> = [
  { id: "cobblemon", label: "Cobblemon", sortOrder: 0, locked: true },
  { id: "minecraft", label: "Minecraft", sortOrder: 1, locked: true },
];

const SEED_DIMENSIONS: Array<typeof schema.dimensions.$inferInsert> = [
  {
    id: "minecraft:overworld",
    modId: "minecraft",
    label: "Overworld",
    hasDayCycle: true,
    hasWeather: true,
    hasMoon: true,
    hasSky: true,
    sortOrder: 0,
  },
  {
    id: "minecraft:the_nether",
    modId: "minecraft",
    label: "Nether",
    hasDayCycle: false,
    hasWeather: false,
    hasMoon: false,
    hasSky: false,
    sortOrder: 10,
  },
  {
    id: "minecraft:the_end",
    modId: "minecraft",
    label: "End",
    hasDayCycle: false,
    hasWeather: false,
    hasMoon: false,
    hasSky: true,
    sortOrder: 20,
  },
];

async function seedModsAndDimensions() {
  console.log("[reset] seeding mods + dimensions");
  await db.insert(schema.mods).values(SEED_MODS);
  await db.insert(schema.dimensions).values(SEED_DIMENSIONS);
}

/* ────────────────────────────────────────────────────────────────
 *  BIOME TAGS
 * ──────────────────────────────────────────────────────────────── */

/**
 * Decide the dimension a tag pins to from its directory layout in
 * `data/cobblemon/tags/worldgen/biome/`. Root-level tags
 * (`is_arid.json`, `is_overworld.json`) are Overworld; everything
 * under `nether/` is Nether; everything under `space/`, `has_xxx/`,
 * `evolution/` is transverse (no dimension).
 *
 * `is_overworld`, `is_sky`, `is_magical` carry a dimension-defining
 * meaning even though they're at the root — they're explicitly
 * Overworld. `is_end` is similarly Overworld-rooted in upstream but
 * we map it to The End.
 */
function tagDimension(relPath: string): string | null {
  const segments = relPath.split("/");
  if (segments.length > 1) {
    if (segments[0] === "nether") return "minecraft:the_nether";
    // space, has_xxx, evolution → transverse
    return null;
  }
  const tagName = segments[0].replace(/\.json$/, "");
  if (tagName === "is_end") return "minecraft:the_end";
  return "minecraft:overworld";
}

function tagSection(relPath: string): string {
  const segments = relPath.split("/");
  if (segments.length > 1) {
    const folder = segments[0];
    if (folder === "nether") return "Nether";
    if (folder === "space") return "Space";
    if (folder === "has_block") return "Has block";
    if (folder === "has_feature") return "Has feature";
    if (folder === "has_ore") return "Has ore";
    if (folder === "has_density") return "Has density";
    if (folder === "has_season") return "Has season";
    if (folder === "has_structure") return "Has structure";
    if (folder === "evolution") return "Evolution";
    return folder;
  }
  // Group root-level tags by keyword for the dropdown's sections.
  const name = segments[0].replace(/\.json$/, "").replace(/^is_/, "");
  if (/forest|taiga|jungle|bamboo|cherry|mushroom|spooky/.test(name)) return "Forests";
  if (/plain|grassland|floral|shrubland|temperate|meadow/.test(name)) return "Plains";
  if (/savanna|arid|desert|badlands|sandy/.test(name)) return "Arid";
  if (/swamp|river|freshwater|beach|coast|island|stony_beach/.test(name)) return "Wetlands";
  if (/mountain|peak|highlands|hills|plateau/.test(name)) return "Mountains";
  if (/cold|snowy|freezing|tundra|glacial|frozen/.test(name)) return "Cold";
  if (/ocean|warm|lukewarm|deep_ocean|temperate_ocean|cold_ocean/.test(name)) return "Ocean";
  if (/cave|lush|dripstone|deep_dark|thermal|volcanic/.test(name)) return "Underground";
  if (name === "end") return "End";
  if (name === "overworld") return "Overworld (catch-all)";
  if (name === "sky" || name === "magical" || name === "mirage_island") return "Sky & magical";
  return "Other";
}

function tagLabel(tagId: string): string {
  return tagId
    .replace(/^#?[a-z0-9_]+:/, "")
    .replace(/^nether\//, "")
    .replace(/^space\//, "")
    .replace(/^evolution\//, "")
    .replace(/^has_[a-z_]+\//, "")
    .replace(/^is_/, "")
    .replace(/_/g, " ");
}

async function ingestBiomeTags(clone: RepoClone): Promise<void> {
  const dir = dataPath(clone, "tags", "worldgen", "biome");
  const files = await listJsonFiles(dir);
  const tagRows: Array<typeof schema.biomeTags.$inferInsert> = [];
  const memberRows: Array<typeof schema.biomeTagMembers.$inferInsert> = [];
  const seenTags = new Set<string>();
  let sortOrder = 0;

  for (const file of files) {
    const rel = file.slice(dir.length + 1).replaceAll("\\", "/");
    const tagId = "#cobblemon:" + rel.replace(/\.json$/, "");
    if (seenTags.has(tagId)) continue;
    seenTags.add(tagId);

    const dimension = tagDimension(rel);
    const section = tagSection(rel);
    const label = tagLabel(tagId);
    tagRows.push({ id: tagId, label, dimensionId: dimension, section, sortOrder: sortOrder++ });

    try {
      const raw = (await readJson(file)) as { values?: unknown[] };
      const values = Array.isArray(raw.values) ? raw.values : [];
      for (const entry of values) {
        const id =
          typeof entry === "string"
            ? entry
            : typeof entry === "object" && entry !== null && "id" in entry
              ? String((entry as { id: unknown }).id)
              : null;
        if (!id) continue;
        if (!isAllowedNamespace(id)) continue;
        memberRows.push({ tagId, biomeId: id });
      }
    } catch (err) {
      console.warn(`[reset] tag parse skip ${tagId}:`, err instanceof Error ? err.message : err);
    }
  }

  // Synthetic End tag — Cobblemon doesn't ship `is_end_*` files but
  // spawn entries reference vanilla End biomes directly. We register
  // them under `#cobblemon:is_end` so the dimension gate routes
  // `minecraft:end_highlands` → The End.
  const endTagId = "#cobblemon:is_end";
  if (!seenTags.has(endTagId)) {
    tagRows.push({
      id: endTagId,
      label: "end",
      dimensionId: "minecraft:the_end",
      section: "End",
      sortOrder: sortOrder++,
    });
    seenTags.add(endTagId);
  }
  for (const id of [
    "minecraft:the_end",
    "minecraft:end_highlands",
    "minecraft:end_midlands",
    "minecraft:end_barrens",
    "minecraft:small_end_islands",
  ]) {
    memberRows.push({ tagId: endTagId, biomeId: id });
  }

  // Modded biome tags — load from data/custom-biomes.json so the user
  // can extend the dex with Terralith, BiomesOPlenty, etc. without
  // touching the ingest code. File is optional.
  const customAdded = await loadCustomBiomeTags(tagRows, memberRows, seenTags, sortOrder);

  await db.insert(schema.biomeTags).values(tagRows);
  // Insert members in chunks to avoid postgres parameter limits.
  for (let i = 0; i < memberRows.length; i += 500) {
    const chunk = memberRows.slice(i, i + 500);
    await db.insert(schema.biomeTagMembers).values(chunk).onConflictDoNothing();
  }
  console.log(
    `[reset] biome_tags=${tagRows.length} biome_tag_members=${memberRows.length}` +
      (customAdded > 0 ? ` (incl. ${customAdded} custom)` : ""),
  );
}

/**
 * Optional `data/custom-biomes.json` lets the user wire in modded biome
 * tags (Terralith, BiomesOPlenty, Oh The Biomes You'll Go, …). Format:
 *
 * {
 *   "tags": [
 *     { "id": "#terralith:is_overworld", "label": "Terralith Overworld",
 *       "dimension": "minecraft:overworld", "section": "Modded biomes" }
 *   ],
 *   "members": [
 *     { "tagId": "#terralith:is_overworld",
 *       "biomes": ["terralith:alpha_islands", "terralith:cloud_forest"] }
 *   ]
 * }
 *
 * Returns the number of new tags appended (0 if file is missing).
 */
async function loadCustomBiomeTags(
  tagRows: Array<typeof schema.biomeTags.$inferInsert>,
  memberRows: Array<typeof schema.biomeTagMembers.$inferInsert>,
  seenTags: Set<string>,
  baseSortOrder: number,
): Promise<number> {
  const path = `${process.cwd()}/data/custom-biomes.json`;
  let raw: unknown;
  try {
    raw = await readJson(path);
  } catch {
    return 0;
  }
  const parsed = raw as {
    tags?: Array<{ id: string; label?: string; dimension?: string; section?: string }>;
    members?: Array<{ tagId: string; biomes: string[] }>;
  };

  // Auto-register dimensions referenced by custom tags but missing from
  // the world graph (aether:the_aether, the_bumblezone:the_bumblezone, …).
  // Without this the FK on biome_tags.dimension_id rejects the insert.
  const knownDimensions = await db.select({ id: schema.dimensions.id }).from(schema.dimensions);
  const knownDimSet = new Set(knownDimensions.map((d) => d.id));
  const newDims = new Map<string, { modId: string; label: string }>();
  for (const t of parsed.tags ?? []) {
    const dim = t.dimension ?? "minecraft:overworld";
    if (knownDimSet.has(dim) || newDims.has(dim)) continue;
    const modId = dim.split(":", 1)[0];
    newDims.set(dim, {
      modId,
      label: dim
        .split(":")[1]
        .replace(/_/g, " ")
        .replace(/^the /, "The "),
    });
  }
  if (newDims.size > 0) {
    // Modded mods may not exist in the mods table — insert them on the
    // fly with a stable sort order so the dropdown groups them last.
    const modIds = new Set([...newDims.values()].map((d) => d.modId));
    const knownMods = await db.select({ id: schema.mods.id }).from(schema.mods);
    const knownModSet = new Set(knownMods.map((m) => m.id));
    const modsToInsert = [...modIds]
      .filter((id) => !knownModSet.has(id))
      .map((id) => ({
        id,
        label: id.charAt(0).toUpperCase() + id.slice(1).replace(/_/g, " "),
        sortOrder: 500,
      }));
    if (modsToInsert.length > 0) {
      await db.insert(schema.mods).values(modsToInsert).onConflictDoNothing();
    }
    await db
      .insert(schema.dimensions)
      .values(
        [...newDims.entries()].map(([id, info]) => ({
          id,
          label: info.label,
          modId: info.modId,
          sortOrder: 500,
        })),
      )
      .onConflictDoNothing();
    for (const id of newDims.keys()) knownDimSet.add(id);
  }

  let added = 0;
  let order = baseSortOrder;
  for (const t of parsed.tags ?? []) {
    if (!t.id || seenTags.has(t.id)) continue;
    seenTags.add(t.id);
    const dim = t.dimension ?? "minecraft:overworld";
    tagRows.push({
      id: t.id,
      label: t.label ?? t.id.replace(/^#?[^:]+:/, "").replace(/_/g, " "),
      dimensionId: knownDimSet.has(dim) ? dim : "minecraft:overworld",
      section: t.section ?? "Modded biomes",
      sortOrder: order++,
    });
    added++;
  }
  for (const m of parsed.members ?? []) {
    if (!m.tagId || !Array.isArray(m.biomes)) continue;
    for (const biomeId of m.biomes) {
      if (typeof biomeId !== "string" || !biomeId.includes(":")) continue;
      memberRows.push({ tagId: m.tagId, biomeId });
    }
  }
  return added;
}

/* ────────────────────────────────────────────────────────────────
 *  PRESETS
 * ──────────────────────────────────────────────────────────────── */

async function ingestSpawnPresets(clone: RepoClone): Promise<Map<string, PresetFile>> {
  const dir = dataPath(clone, "spawn_detail_presets");
  const files = await listJsonFiles(dir);
  const map = new Map<string, PresetFile>();
  let ok = 0;
  let failed = 0;
  for (const file of files) {
    try {
      const parsed = presetFileSchema.parse(await readJson(file));
      const name = basename(file, ".json");
      const rel = relativeDataPath(clone, file);
      map.set(name, parsed);
      await db
        .insert(schema.spawnPresets)
        .values({
          name,
          condition: parsed.condition ?? null,
          anticondition: parsed.anticondition ?? null,
          context: parsed.context ?? parsed.spawnablePositionType ?? null,
          raw: parsed,
          sourceUrl: gitlabBlobUrl(clone.commitSha, rel),
        })
        .onConflictDoUpdate({
          target: schema.spawnPresets.name,
          set: {
            condition: parsed.condition ?? null,
            anticondition: parsed.anticondition ?? null,
            context: parsed.context ?? parsed.spawnablePositionType ?? null,
            raw: parsed,
            sourceUrl: gitlabBlobUrl(clone.commitSha, rel),
          },
        });
      ok++;
    } catch (err) {
      failed++;
      console.warn(`[reset] preset skip ${file}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`[reset] spawn_presets ok=${ok} failed=${failed}`);
  return map;
}

/* ────────────────────────────────────────────────────────────────
 *  SPECIES + REGIONAL VARIANTS
 * ──────────────────────────────────────────────────────────────── */

type SpeciesIndexEntry = { id: number; slug: string };

interface SpeciesIndex {
  /** Look up by base slug ("vulpix") or by `${baseSlug} ${variant}` ("vulpix alolan"). */
  bySpawnKey: Map<string, SpeciesIndexEntry>;
  /** Look up by stored DB slug (eg `vulpix-alolan`). */
  bySlug: Map<string, SpeciesIndexEntry>;
}

function pickType(form: SpeciesForm, base: string, fallback?: string): string {
  return form.primaryType ?? base ?? fallback ?? "normal";
}

async function ingestSpecies(clone: RepoClone): Promise<SpeciesIndex> {
  const dir = dataPath(clone, "species");
  const files = await listJsonFiles(dir);
  const bySpawnKey = new Map<string, SpeciesIndexEntry>();
  const bySlug = new Map<string, SpeciesIndexEntry>();
  let ok = 0;
  let failed = 0;
  let variants = 0;

  for (const file of files) {
    try {
      const raw = await readJson(file);
      const parsed = speciesSchema.parse(raw);
      const baseSlug = slugify(parsed.name);
      const rel = relativeDataPath(clone, file);

      const [baseRow] = await db
        .insert(schema.species)
        .values({
          dexNo: parsed.nationalPokedexNumber,
          slug: baseSlug,
          name: parsed.name,
          primaryType: parsed.primaryType,
          secondaryType: parsed.secondaryType ?? null,
          baseStats: parsed.baseStats,
          abilities: parsed.abilities,
          catchRate: parsed.catchRate,
          baseFriendship: parsed.baseFriendship ?? null,
          preferredFlavours: parsed.preferredFlavours ?? null,
          labels: parsed.labels,
          variantOfSpeciesId: null,
          variantLabel: null,
          raw: parsed,
        })
        .returning({ id: schema.species.id });

      const baseEntry: SpeciesIndexEntry = { id: baseRow.id, slug: baseSlug };
      bySpawnKey.set(parsed.name.toLowerCase(), baseEntry);
      bySpawnKey.set(baseSlug, baseEntry);
      bySlug.set(baseSlug, baseEntry);

      await db.insert(schema.dataSources).values({
        entityType: "species",
        entityId: baseRow.id,
        kind: "mod",
        url: gitlabBlobUrl(clone.commitSha, rel),
        commitSha: clone.commitSha,
      });

      // Regional variants — every form with a non-empty aspect list
      // becomes its own species row pointing back at the base.
      for (const form of parsed.forms ?? []) {
        if (!form.aspects || form.aspects.length === 0) continue;
        const variantLabel = form.aspects[0];
        const variantSlug = `${baseSlug}-${slugify(variantLabel)}`;
        if (bySlug.has(variantSlug)) continue;
        const variantName = `${parsed.name} (${variantLabel})`;

        const [vRow] = await db
          .insert(schema.species)
          .values({
            dexNo: parsed.nationalPokedexNumber,
            slug: variantSlug,
            name: variantName,
            primaryType: pickType(form, form.primaryType ?? "", parsed.primaryType),
            secondaryType: form.secondaryType ?? parsed.secondaryType ?? null,
            baseStats: { ...parsed.baseStats, ...(form.baseStats ?? {}) },
            abilities: form.abilities ?? parsed.abilities,
            catchRate: form.catchRate ?? parsed.catchRate,
            baseFriendship: form.baseFriendship ?? parsed.baseFriendship ?? null,
            preferredFlavours:
              form.preferredFlavours ?? parsed.preferredFlavours ?? null,
            // Push synthetic labels so the Cobbledex filters can
            // pick this row up:
            //   - `variant`: any non-base form (alolan, mega, gmax, …)
            //   - `regional`: alolan / galarian / hisuian / paldean
            //     and their sub-forms (paldean-combat, paldean-aqua,
            //     paldean-blaze)
            // The form's own labels (e.g. "alolan_form") stay intact.
            labels: Array.from(
              new Set([
                ...(form.labels ?? parsed.labels),
                "variant",
                ...(REGIONAL_VARIANT_PREFIXES.some((p) =>
                  variantLabel.toLowerCase().startsWith(p),
                )
                  ? ["regional"]
                  : []),
              ]),
            ),
            variantOfSpeciesId: baseRow.id,
            variantLabel,
            raw: form,
          })
          .returning({ id: schema.species.id });

        const ve: SpeciesIndexEntry = { id: vRow.id, slug: variantSlug };
        // Spawn JSONs use `pokemon: "vulpix alolan"` — index that key.
        bySpawnKey.set(`${baseSlug} ${variantLabel}`.toLowerCase(), ve);
        bySpawnKey.set(`${parsed.name.toLowerCase()} ${variantLabel.toLowerCase()}`, ve);
        bySpawnKey.set(variantSlug, ve);
        bySlug.set(variantSlug, ve);
        variants++;
      }
      ok++;
    } catch (err) {
      failed++;
      console.warn(`[reset] species skip ${file}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`[reset] species ok=${ok} variants=${variants} failed=${failed}`);
  return { bySpawnKey, bySlug };
}

/* ────────────────────────────────────────────────────────────────
 *  SPAWNS — extraction des axes scalaires
 * ──────────────────────────────────────────────────────────────── */

interface BiomeIndex {
  /** biome_id (with or without `#`) → tag ids it belongs to. */
  biomeToTags: Map<string, string[]>;
  /** tag_id → dimension_id (or null). */
  tagToDimension: Map<string, string | null>;
}

async function buildBiomeIndex(): Promise<BiomeIndex> {
  const tags = await db.select().from(schema.biomeTags);
  const members = await db.select().from(schema.biomeTagMembers);
  const tagToDimension = new Map<string, string | null>();
  for (const t of tags) tagToDimension.set(t.id, t.dimensionId ?? null);
  const biomeToTags = new Map<string, string[]>();
  // Tags reference each other as `#cobblemon:is_x`. Each tag is its
  // own member too (so a spawn that lists `#cobblemon:is_lush` matches
  // anywhere `is_lush` resolves) — register the identity link.
  for (const t of tags) {
    const arr = biomeToTags.get(t.id) ?? [];
    arr.push(t.id);
    biomeToTags.set(t.id, arr);
  }
  for (const m of members) {
    const key = m.biomeId;
    const arr = biomeToTags.get(key) ?? [];
    arr.push(m.tagId);
    biomeToTags.set(key, arr);
    // Stripped form too (some spawns list `cobblemon:is_lush` without #).
    const stripped = stripHash(key);
    if (stripped !== key) {
      const arr2 = biomeToTags.get(stripped) ?? [];
      arr2.push(m.tagId);
      biomeToTags.set(stripped, arr2);
    }
  }
  return { biomeToTags, tagToDimension };
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

/**
 * Resolve the `condition.biomes[]` of a spawn into:
 *   - the union of tags referenced (direct + inferred via tag membership)
 *   - the union of dimensions inferred from those tags (transverse-only
 *     spawns default to Overworld, matching Cobblemon's behaviour)
 */
function resolveBiomes(
  rawBiomes: string[] | undefined,
  index: BiomeIndex,
): { tags: string[]; dimensions: string[] } {
  if (!rawBiomes || rawBiomes.length === 0) {
    return { tags: [], dimensions: [] };
  }
  const tags = new Set<string>();
  for (const b of rawBiomes) {
    const found = index.biomeToTags.get(b) ?? index.biomeToTags.get(stripHash(b));
    if (found) for (const t of found) tags.add(t);
    else if (b.startsWith("#")) tags.add(b); // unknown tag, keep verbatim
  }
  const dims = new Set<string>();
  let hasDimensionalTag = false;
  for (const t of tags) {
    const d = index.tagToDimension.get(t);
    if (d) {
      hasDimensionalTag = true;
      dims.add(d);
    }
  }
  if (!hasDimensionalTag && tags.size > 0) {
    // Spawn lists only transverse tags (has_*, is_sky, is_magical, …).
    // Fall back to Overworld — the vanilla default.
    dims.add("minecraft:overworld");
  }
  return { tags: [...tags].sort(), dimensions: [...dims].sort() };
}

interface ExtractedScalars {
  positionType: string | null;
  fluid: string | null;
  fluidIsSource: boolean | null;
  minDepth: number | null;
  maxDepth: number | null;
  requiresRain: boolean | null;
  requiresThunder: boolean | null;
  requiresCanSeeSky: boolean | null;
  minSkyLight: number | null;
  maxSkyLight: number | null;
  minLight: number | null;
  maxLight: number | null;
  minMoonPhase: number | null;
  maxMoonPhase: number | null;
  timeRange: string | null;
  minY: number | null;
  maxY: number | null;
}

function moonPhaseRange(value: unknown): { min: number; max: number } | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { min: value, max: value };
  }
  if (typeof value !== "string") return null;
  const named: Record<string, [number, number]> = {
    full: [0, 0],
    waning_gibbous: [1, 1],
    third_quarter: [2, 2],
    waning_crescent: [3, 3],
    new: [4, 4],
    waxing_crescent: [5, 5],
    first_quarter: [6, 6],
    waxing_gibbous: [7, 7],
    waning: [1, 3],
    crescent: [3, 5],
    quarter: [2, 6],
    waxing: [5, 7],
    gibbous: [1, 7],
  };
  const m = named[value.toLowerCase()];
  if (m) return { min: m[0], max: m[1] };
  // Range like "0-3" or single number string.
  const single = Number.parseInt(value, 10);
  if (Number.isFinite(single)) return { min: single, max: single };
  const range = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(value);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  return null;
}

function extractScalars(
  cond: SpawnCondition | undefined,
  positionType: string | null,
): ExtractedScalars {
  const c = (cond ?? {}) as Record<string, unknown>;
  const moon = moonPhaseRange(c.moonPhase);
  return {
    positionType,
    fluid: typeof c.fluid === "string" ? c.fluid : null,
    fluidIsSource: typeof c.fluidIsSource === "boolean" ? c.fluidIsSource : null,
    minDepth: typeof c.minDepth === "number" ? c.minDepth : null,
    maxDepth: typeof c.maxDepth === "number" ? c.maxDepth : null,
    requiresRain: typeof c.isRaining === "boolean" ? c.isRaining : null,
    requiresThunder: typeof c.isThundering === "boolean" ? c.isThundering : null,
    requiresCanSeeSky: typeof c.canSeeSky === "boolean" ? c.canSeeSky : null,
    minSkyLight: typeof c.minSkyLight === "number" ? c.minSkyLight : null,
    maxSkyLight: typeof c.maxSkyLight === "number" ? c.maxSkyLight : null,
    minLight: typeof c.minLight === "number" ? c.minLight : null,
    maxLight: typeof c.maxLight === "number" ? c.maxLight : null,
    minMoonPhase: moon?.min ?? null,
    maxMoonPhase: moon?.max ?? null,
    timeRange: typeof c.timeRange === "string" ? c.timeRange : null,
    minY: typeof c.minY === "number" ? c.minY : null,
    maxY: typeof c.maxY === "number" ? c.maxY : null,
  };
}

/**
 * Keep a spawn whose condition references AT LEAST ONE allowed-namespace
 * value (or no biome/dim/structure constraint at all). Cobblemon ships
 * spawns that list both vanilla biomes and modded ones (Aether, Bumblezone,
 * …) on the same entry — rejecting the whole spawn if a foreign biome
 * appears was throwing out 1000+ legitimate vanilla spawns (Beedrill,
 * Raichu-Alolan, every Aether-friendly mon …). The hostile namespace
 * tokens are filtered later at persistence time.
 */
function spawnReferencesAllowedNamespaces(entry: SpawnEntry): boolean {
  const cond = entry.condition;
  const dims = (cond?.dimensions ?? []) as string[];
  const biomes = (cond?.biomes ?? []) as string[];
  const structures = (cond?.structures ?? []) as string[];
  const tokens = [...dims, ...biomes, ...structures];
  if (tokens.length === 0) return true;
  // Accept the spawn if any constraint token belongs to a namespace we
  // ingest. Foreign-only spawns (e.g. Bumblezone-only) are still skipped.
  return tokens.some((v) => isAllowedNamespace(v));
}

/**
 * Strip non-allowed-namespace tokens from a constraint list before we
 * persist the spawn. We keep the spawn meaningful for the namespaces we
 * support without leaking modded biomes our world graph can't resolve.
 */
function filterAllowedTokens(tokens: string[]): string[] {
  return tokens.filter((v) => isAllowedNamespace(v));
}

/**
 * Returns a copy of the spawn condition (or anticondition) where every
 * `biomes`/`structures`/`dimensions` array is restricted to the
 * namespaces we ingest. The columnar fields are already filtered upstream;
 * we mirror the filtering in the JSONB shadow so downstream matchers
 * (snack filter, dimension gate) can't see foreign tokens that wouldn't
 * have a counterpart in the world graph.
 */
function sanitiseCondition(
  cond: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!cond) return cond ?? null;
  const out: Record<string, unknown> = { ...cond };
  if (Array.isArray(cond.biomes)) {
    out.biomes = filterAllowedTokens(cond.biomes as string[]);
  }
  if (Array.isArray(cond.structures)) {
    out.structures = filterAllowedTokens(cond.structures as string[]);
  }
  if (Array.isArray(cond.dimensions)) {
    out.dimensions = filterAllowedTokens(cond.dimensions as string[]);
  }
  return out;
}

async function ingestSpawnsFromDir(opts: {
  clone: RepoClone;
  dir: string;
  speciesIndex: SpeciesIndex;
  presetMap: Map<string, PresetFile>;
  biomeIndex: BiomeIndex;
}): Promise<{ ok: number; skipped: number; failed: number; structures: Set<string>; biomeStructureLinks: Set<string> }> {
  const files = await listJsonFiles(opts.dir);
  const structures = new Set<string>();
  const biomeStructureLinks = new Set<string>();
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  let unmappedSpecies = new Set<string>();

  for (const file of files) {
    try {
      const rawJson = (await readJson(file)) as { enabled?: boolean };
      if (rawJson.enabled === false) {
        skipped++;
        continue;
      }
      const parsed = spawnFileSchema.parse(rawJson);
      const rel = relativeDataPath(opts.clone, file);
      const sourceUrl = gitlabBlobUrl(opts.clone.commitSha, rel);

      for (const rawEntry of parsed.spawns) {
        if (rawEntry.type !== "pokemon") {
          skipped++;
          continue;
        }
        if (!spawnReferencesAllowedNamespaces(rawEntry)) {
          skipped++;
          continue;
        }
        const entry = applyPresets(rawEntry, opts.presetMap);
        const pokemonKey = entry.pokemon.toLowerCase();
        const speciesEntry =
          opts.speciesIndex.bySpawnKey.get(pokemonKey) ??
          opts.speciesIndex.bySpawnKey.get(slugify(entry.pokemon.split(" ")[0]));
        if (!speciesEntry) {
          unmappedSpecies.add(entry.pokemon);
          skipped++;
          continue;
        }

        const { min, max } = parseLevelRange(entry.level);
        const positionType =
          entry.context ?? entry.spawnablePositionType ?? null;
        const scalars = extractScalars(entry.condition, positionType);
        // Filter out modded-namespace biomes we don't model. The spawn
        // is still meaningful for the namespaces we keep — the foreign
        // biomes were the reason a Beedrill listing both `#cobblemon:is_forest`
        // and `aether:skyroot_forest` was being rejected wholesale.
        const biomesRaw = filterAllowedTokens(
          (entry.condition?.biomes ?? []) as string[],
        );
        const { tags, dimensions: dimsFromBiomes } = resolveBiomes(
          biomesRaw,
          opts.biomeIndex,
        );
        const explicitDims = filterAllowedTokens(
          (entry.condition?.dimensions as string[] | undefined) ?? [],
        );
        const conditionDimensions = uniq([...explicitDims, ...dimsFromBiomes]);
        const conditionBiomeTags = tags;
        const conditionStructures = filterAllowedTokens(
          (entry.condition?.structures ?? []) as string[],
        );

        // Auto-discover structures used by spawns.
        for (const s of conditionStructures) {
          structures.add(s);
          for (const tagId of conditionBiomeTags) {
            biomeStructureLinks.add(`${tagId}::${s}`);
          }
        }

        const weightMultipliers = entry.weightMultipliers
          ? entry.weightMultipliers
          : entry.weightMultiplier
            ? [entry.weightMultiplier]
            : null;

        const externalId = entry.id;

        await db
          .insert(schema.spawns)
          .values({
            speciesId: speciesEntry.id,
            externalId,
            bucket: entry.bucket,
            weight: entry.weight,
            percentage: entry.percentage ?? null,
            levelMin: min,
            levelMax: max,
            positionType,
            conditionDimensions,
            conditionBiomeTags,
            conditionStructures,
            fluid: scalars.fluid,
            fluidIsSource: scalars.fluidIsSource,
            minDepth: scalars.minDepth,
            maxDepth: scalars.maxDepth,
            requiresRain: scalars.requiresRain,
            requiresThunder: scalars.requiresThunder,
            requiresCanSeeSky: scalars.requiresCanSeeSky,
            minSkyLight: scalars.minSkyLight,
            maxSkyLight: scalars.maxSkyLight,
            minLight: scalars.minLight,
            maxLight: scalars.maxLight,
            minMoonPhase: scalars.minMoonPhase,
            maxMoonPhase: scalars.maxMoonPhase,
            timeRange: scalars.timeRange,
            minY: scalars.minY,
            maxY: scalars.maxY,
            biomes: biomesRaw,
            // Persist a sanitised condition JSONB so downstream matchers
            // (snack filter, dimension gate) can't see modded biomes we
            // dropped from the columnar fields above. Otherwise the JSONB
            // shadow would re-introduce the foreign tokens via spawn.condition.
            condition: sanitiseCondition(entry.condition),
            anticondition: sanitiseCondition(entry.anticondition),
            weightMultipliers,
            compositeCondition: entry.compositeCondition ?? null,
            presets: entry.presets,
            sourceKind: "mod",
            sourceName: "cobblemon",
            sourceUrl,
          })
          .onConflictDoNothing();
        ok++;
      }
    } catch (err) {
      failed++;
      console.warn(`[reset] spawn skip ${file}:`, err instanceof Error ? err.message : err);
    }
  }
  if (unmappedSpecies.size > 0) {
    console.warn(
      `[reset] dropped spawns for ${unmappedSpecies.size} unknown species: ${[...unmappedSpecies].slice(0, 10).join(", ")}${unmappedSpecies.size > 10 ? "…" : ""}`,
    );
  }
  console.log(`[reset] spawns ok=${ok} skipped=${skipped} failed=${failed}`);
  return { ok, skipped, failed, structures, biomeStructureLinks };
}

function structureLabel(id: string): string {
  return id.replace(/^#?[a-z0-9_]+:/, "").replace(/\//g, " / ").replace(/_/g, " ");
}

async function persistStructures(
  ids: Set<string>,
  links: Set<string>,
): Promise<void> {
  if (ids.size === 0) {
    console.log("[reset] structures none");
    return;
  }
  const rows = [...ids].sort().map((id, i) => ({
    id,
    label: structureLabel(id),
    sortOrder: i,
  }));
  for (let i = 0; i < rows.length; i += 200) {
    await db.insert(schema.structures).values(rows.slice(i, i + 200)).onConflictDoNothing();
  }
  const linkRows = [...links].map((joined) => {
    const [tag, struct] = joined.split("::");
    return { biomeTagId: tag, structureId: struct };
  });
  for (let i = 0; i < linkRows.length; i += 200) {
    await db
      .insert(schema.biomeTagStructures)
      .values(linkRows.slice(i, i + 200))
      .onConflictDoNothing();
  }
  console.log(
    `[reset] structures=${rows.length} biome_tag_structures=${linkRows.length}`,
  );
}

/* ────────────────────────────────────────────────────────────────
 *  Reuse the existing seasonings / berries / recipes / bait pipeline
 *  so we don't lose data on those untouched tables.
 * ──────────────────────────────────────────────────────────────── */

async function ingestSeasonings(clone: RepoClone) {
  const dir = dataPath(clone, "seasonings");
  const files = await listJsonFiles(dir);
  let ok = 0;
  let failed = 0;
  for (const file of files) {
    try {
      const parsed = seasoningSchema.parse(await readJson(file));
      const item = parsed.ingredient ?? parsed.item;
      if (!item) continue;
      const slug = basename(file, ".json");
      await db
        .insert(schema.seasonings)
        .values({
          itemId: item,
          slug,
          colour: parsed.colour ?? parsed.color ?? null,
          raw: parsed,
        })
        .onConflictDoUpdate({
          target: schema.seasonings.slug,
          set: { itemId: item, colour: parsed.colour ?? parsed.color ?? null, raw: parsed },
        });
      ok++;
    } catch (err) {
      failed++;
      console.warn(`[reset] seasoning skip ${file}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`[reset] seasonings ok=${ok} failed=${failed}`);
}

const EFFECT_TAG_WHITELIST = new Set([
  "hp_recovery",
  "status_recovery",
  "pp_recovery",
  "nature_recovery",
  "friendship",
  "damage_reduction",
  "stat_buff",
  "damaging",
  "non_battle",
]);

async function loadEffectTags(clone: RepoClone): Promise<Map<string, string[]>> {
  const dir = dataPath(clone, "tags", "item", "berries");
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => `${dir}/${e.name}`);
  const map = new Map<string, string[]>();
  for (const file of files) {
    try {
      const name = basename(file, ".json");
      if (!EFFECT_TAG_WHITELIST.has(name)) continue;
      const raw = (await readJson(file)) as { values?: string[] };
      if (!raw.values) continue;
      for (const v of raw.values) {
        if (v.startsWith("#")) continue;
        const arr = map.get(v) ?? [];
        if (!arr.includes(name)) arr.push(name);
        map.set(v, arr);
      }
    } catch {
      /* tolerate */
    }
  }
  return map;
}

async function ingestBerries(clone: RepoClone) {
  const dir = dataPath(clone, "berries");
  const files = await listJsonFiles(dir);
  const effectTagsByItem = await loadEffectTags(clone);
  let ok = 0;
  let failed = 0;
  for (const file of files) {
    try {
      const raw = (await readJson(file)) as Record<string, unknown>;
      const parsed = berrySchema.parse(raw);
      const slug = basename(file, ".json");
      const itemId = parsed.identifier ?? `cobblemon:${slug}`;
      const dom = dominantFlavour(parsed.flavours);
      const effectTags = effectTagsByItem.get(itemId) ?? [];
      const snackPositionings =
        (raw.pokeSnackPositionings as Array<{
          position: { x: number; y: number; z: number };
          rotation: { x: number; y: number; z: number };
        }> | undefined) ?? [];
      const fruitModel =
        ((raw.fruitModel as string | undefined) ?? null)
          ?.replace(/^cobblemon:/, "")
          .replace(/\.geo$/, "") ?? null;
      const fruitTexture =
        ((raw.fruitTexture as string | undefined) ?? null)?.replace(/^cobblemon:/, "") ?? null;
      await db
        .insert(schema.berries)
        .values({
          slug,
          itemId,
          flavours: parsed.flavours,
          dominantFlavour: dom,
          colour: parsed.colour ?? null,
          weight: parsed.weight ?? null,
          effectTags,
          snackPositionings,
          fruitModel,
          fruitTexture,
          raw: parsed,
        })
        .onConflictDoUpdate({
          target: schema.berries.slug,
          set: {
            itemId,
            flavours: parsed.flavours,
            dominantFlavour: dom,
            colour: parsed.colour ?? null,
            weight: parsed.weight ?? null,
            effectTags,
            snackPositionings,
            fruitModel,
            fruitTexture,
            raw: parsed,
          },
        });
      ok++;
    } catch (err) {
      failed++;
      console.warn(`[reset] berry skip ${file}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`[reset] berries ok=${ok} failed=${failed}`);
}

async function ingestRecipes(clone: RepoClone) {
  const dir = dataPath(clone, "recipe", "campfire_pot");
  const files = await listJsonFiles(dir);
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const file of files) {
    try {
      const raw = (await readJson(file)) as { type?: string };
      if (raw.type !== "cobblemon:cooking_pot" && raw.type !== "cobblemon:cooking_pot_shapeless") {
        skipped++;
        continue;
      }
      const parsed = cookingRecipeSchema.parse(raw);
      const slug = basename(file, ".json");
      const resultId = parsed.result.id;
      const kind = classifyRecipe(resultId);
      const shape = parsed.type === "cobblemon:cooking_pot" ? "shaped" : "shapeless";
      const values = {
        slug,
        kind,
        resultId,
        resultCount: parsed.result.count ?? 1,
        shape,
        grid: parsed.type === "cobblemon:cooking_pot" ? shapedToGrid(parsed) : null,
        ingredients:
          parsed.type === "cobblemon:cooking_pot_shapeless" ? parsed.ingredients : null,
        seasoningTag: parsed.seasoningTag ?? null,
        seasoningProcessors: parsed.seasoningProcessors,
        raw: parsed,
      } as const;
      await db
        .insert(schema.recipes)
        .values(values)
        .onConflictDoUpdate({ target: schema.recipes.slug, set: values });
      ok++;
    } catch (err) {
      failed++;
      console.warn(`[reset] recipe skip ${file}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`[reset] recipes ok=${ok} skipped=${skipped} failed=${failed}`);
}

async function ingestBaitEffects(clone: RepoClone) {
  const dir = dataPath(clone, "spawn_bait_effects");
  const files = await listJsonFiles(dir);
  let ok = 0;
  let failed = 0;
  for (const file of files) {
    try {
      const parsed = baitEffectSchema.parse(await readJson(file));
      const relativePath = relative(dir, file).replaceAll("\\", "/");
      const slug = relativePath.replace(/\.json$/, "").replaceAll("/", "-");
      await db
        .insert(schema.baitEffects)
        .values({ itemId: parsed.item, slug, effects: parsed.effects, raw: parsed })
        .onConflictDoUpdate({
          target: schema.baitEffects.slug,
          set: { itemId: parsed.item, effects: parsed.effects, raw: parsed },
        });
      ok++;
    } catch (err) {
      failed++;
      console.warn(`[reset] bait skip ${file}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`[reset] bait_effects ok=${ok} failed=${failed}`);
}

/* ────────────────────────────────────────────────────────────────
 *  MAIN
 * ──────────────────────────────────────────────────────────────── */

async function main() {
  console.log(`[reset] cloning Cobblemon into ${CACHE_DIR}`);
  const clone = await cloneRepo(CACHE_DIR);
  console.log(`[reset] commit ${clone.commitSha}`);

  await truncateSpawnSide();
  await seedModsAndDimensions();
  await ingestBiomeTags(clone);

  const presetMap = await ingestSpawnPresets(clone);
  const speciesIndex = await ingestSpecies(clone);
  const biomeIndex = await buildBiomeIndex();

  const result = await ingestSpawnsFromDir({
    clone,
    dir: dataPath(clone, "spawn_pool_world"),
    speciesIndex,
    presetMap,
    biomeIndex,
  });
  await persistStructures(result.structures, result.biomeStructureLinks);

  // Untouched data flows — keep them up to date so a single
  // ingest:reset is enough.
  await ingestSeasonings(clone);
  await ingestBaitEffects(clone);
  await ingestRecipes(clone);
  await ingestBerries(clone);
  const drops = await ingestBerryDrops();
  console.log(`[reset] berry_drops rows=${drops.rows} berries=${drops.berries}`);

  console.log("[reset] done");
}

// Only run the full reset when this file is the entry point. Importing it
// (e.g. ingest/berry_drops.ts reusing ingestBerryDrops) must not trigger it.
// Compare basenames — robust across Windows path/URL quirks.
const isEntryPoint = basename(process.argv[1] ?? "") === "reset.ts";
if (isEntryPoint) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
