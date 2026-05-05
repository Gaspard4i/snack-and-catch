import {
  pgTable,
  serial,
  bigserial,
  integer,
  text,
  real,
  jsonb,
  boolean,
  timestamp,
  uniqueIndex,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";

export const bucketEnum = pgEnum("bucket", ["common", "uncommon", "rare", "ultra-rare"]);
export const sourceKindEnum = pgEnum("source_kind", ["mod", "wiki", "derived", "addon"]);

/**
 * Authored content — every relation below is keyed on the upstream id
 * (`minecraft:overworld`, `#cobblemon:is_lush`, `minecraft:village`) so
 * the join with the spawn table needs no translation.
 */
export const mods = pgTable(
  "mods",
  {
    /** Upstream namespace, e.g. "cobblemon", "minecraft". */
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    /** Lower comes first in the dropdown. */
    sortOrder: integer("sort_order").notNull().default(100),
    /** Locked = the user can't unselect it (cobblemon + minecraft). */
    locked: boolean("locked").notNull().default(false),
  },
);

export const dimensions = pgTable(
  "dimensions",
  {
    id: text("id").primaryKey(),
    modId: text("mod_id")
      .notNull()
      .references(() => mods.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    hasDayCycle: boolean("has_day_cycle").notNull().default(true),
    hasWeather: boolean("has_weather").notNull().default(true),
    hasMoon: boolean("has_moon").notNull().default(true),
    hasSky: boolean("has_sky").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(100),
  },
  (t) => [index("dimensions_mod_idx").on(t.modId)],
);

/**
 * One row per Cobblemon biome tag (e.g. `#cobblemon:is_lush`,
 * `#cobblemon:nether/is_basalt`). `dimension_id` is null for transverse
 * tags (`has_block/*`, `evolution/*`, `space/*`, `is_sky`, `is_magical`)
 * — those tags don't pin a dimension.
 *
 * `section` groups tags in the UI: "Forests", "Wetlands", "Nether",
 * "Has block", etc.
 */
export const biomeTags = pgTable(
  "biome_tags",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    dimensionId: text("dimension_id").references(() => dimensions.id, {
      onDelete: "set null",
    }),
    section: text("section"),
    sortOrder: integer("sort_order").notNull().default(100),
  },
  (t) => [index("biome_tags_dim_idx").on(t.dimensionId)],
);

/**
 * Tag → biome ids: the values listed in
 * `data/cobblemon/tags/worldgen/biome/*.json`. We use this to resolve a
 * spawn that lists a direct biome (`minecraft:plains`) into the tags
 * it belongs to, and from there into a dimension.
 */
export const biomeTagMembers = pgTable(
  "biome_tag_members",
  {
    tagId: text("tag_id")
      .notNull()
      .references(() => biomeTags.id, { onDelete: "cascade" }),
    /** Either a direct biome id (`minecraft:plains`) or a `#tag` reference. */
    biomeId: text("biome_id").notNull(),
  },
  (t) => [
    uniqueIndex("biome_tag_members_idx").on(t.tagId, t.biomeId),
    index("biome_tag_members_biome_idx").on(t.biomeId),
  ],
);

export const structures = pgTable(
  "structures",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(100),
  },
);

/**
 * Which structures appear in which biome tag's territory. Populated at
 * ingest time both from a curated map AND by auto-discovery: every
 * structure that a spawn pins via `condition.structures[]` is linked
 * to the tag(s) the spawn lists.
 */
export const biomeTagStructures = pgTable(
  "biome_tag_structures",
  {
    biomeTagId: text("biome_tag_id")
      .notNull()
      .references(() => biomeTags.id, { onDelete: "cascade" }),
    structureId: text("structure_id")
      .notNull()
      .references(() => structures.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("biome_tag_structures_idx").on(t.biomeTagId, t.structureId),
    index("biome_tag_structures_struct_idx").on(t.structureId),
  ],
);

export const species = pgTable(
  "species",
  {
    id: serial("id").primaryKey(),
    dexNo: integer("dex_no").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    primaryType: text("primary_type").notNull(),
    secondaryType: text("secondary_type"),
    baseStats: jsonb("base_stats").$type<Record<string, number>>().notNull(),
    abilities: jsonb("abilities").$type<string[]>().notNull(),
    catchRate: integer("catch_rate").notNull(),
    baseFriendship: integer("base_friendship"),
    preferredFlavours: jsonb("preferred_flavours").$type<string[]>(),
    labels: jsonb("labels").$type<string[]>().notNull(),
    /**
     * Regional variants are stored as their own `species` rows. When
     * non-null, `variantOfSpeciesId` points at the base species (e.g.
     * vulpix-alolan → vulpix), and `variantLabel` carries the aspect
     * (`"alolan"`, `"galarian"`, `"hisuian"`, `"paldean"`, …).
     * Sharing the table keeps the spawn FK simple — every spawn
     * references one species row, base or variant alike.
     */
    /**
     * Self-FK to the base species row. The constraint is enforced at
     * the SQL level (see migration 0012) — Drizzle's `references()`
     * helper can't express a self-reference at type-check time without
     * tripping the "implicit any" on the surrounding `species` const,
     * so we model it as a plain integer here and rely on the DB.
     */
    variantOfSpeciesId: integer("variant_of_species_id"),
    variantLabel: text("variant_label"),
    raw: jsonb("raw").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("species_slug_idx").on(t.slug),
    index("species_dex_idx").on(t.dexNo),
    index("species_variant_of_idx").on(t.variantOfSpeciesId),
  ],
);

/**
 * Spawn entries flattened for SQL filtering. Conditions/anticonditions
 * are kept verbatim in JSONB (for the species page rendering), and the
 * filter axes are extracted into typed columns + GIN-indexable text
 * arrays. One SELECT against this table is all the matcher needs.
 */
export const spawns = pgTable(
  "spawns",
  {
    id: serial("id").primaryKey(),
    speciesId: integer("species_id")
      .notNull()
      .references(() => species.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    bucket: bucketEnum("bucket").notNull(),
    weight: real("weight").notNull(),
    /** Cobblemon `percentage`. Phase 1 of selection — see `BestSpawner`. */
    percentage: real("percentage"),
    levelMin: integer("level_min").notNull(),
    levelMax: integer("level_max").notNull(),

    // ── Filter axes — populated at ingest time ─────────────────────
    positionType: text("position_type"),
    /** Dimensions matching the spawn (resolved from biome tags too). */
    conditionDimensions: jsonb("condition_dimensions").$type<string[]>().notNull().default([]),
    /** Tags listed by the spawn directly + tags a direct biome belongs to. */
    conditionBiomeTags: jsonb("condition_biome_tags").$type<string[]>().notNull().default([]),
    /** Structures pinned by the spawn (`condition.structures`). */
    conditionStructures: jsonb("condition_structures").$type<string[]>().notNull().default([]),
    fluid: text("fluid"),
    fluidIsSource: boolean("fluid_is_source"),
    minDepth: integer("min_depth"),
    maxDepth: integer("max_depth"),
    requiresRain: boolean("requires_rain"),
    requiresThunder: boolean("requires_thunder"),
    requiresCanSeeSky: boolean("requires_can_see_sky"),
    minSkyLight: integer("min_sky_light"),
    maxSkyLight: integer("max_sky_light"),
    minLight: integer("min_light"),
    maxLight: integer("max_light"),
    minMoonPhase: integer("min_moon_phase"),
    maxMoonPhase: integer("max_moon_phase"),
    timeRange: text("time_range"),
    minY: integer("min_y"),
    maxY: integer("max_y"),

    // ── Verbatim payloads kept for the species page ────────────────
    /** Raw `condition.biomes[]` strings, before tag resolution. */
    biomes: jsonb("biomes").$type<string[]>().notNull(),
    condition: jsonb("condition"),
    anticondition: jsonb("anticondition"),
    weightMultipliers: jsonb("weight_multipliers"),
    compositeCondition: jsonb("composite_condition"),
    presets: jsonb("presets").$type<string[]>().notNull(),
    sourceKind: sourceKindEnum("source_kind").notNull().default("mod"),
    sourceName: text("source_name").notNull().default("cobblemon"),
    sourceUrl: text("source_url"),
  },
  (t) => [
    uniqueIndex("spawns_external_idx").on(t.externalId, t.sourceName),
    index("spawns_species_idx").on(t.speciesId),
    index("spawns_source_idx").on(t.sourceKind, t.sourceName),
  ],
);

export const spawnPresets = pgTable(
  "spawn_presets",
  {
    name: text("name").primaryKey(),
    condition: jsonb("condition"),
    anticondition: jsonb("anticondition"),
    context: text("context"),
    raw: jsonb("raw").notNull(),
    sourceUrl: text("source_url"),
  },
);

export const dataSources = pgTable(
  "data_sources",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    kind: sourceKindEnum("kind").notNull(),
    url: text("url").notNull(),
    commitSha: text("commit_sha"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("data_sources_entity_idx").on(t.entityType, t.entityId)],
);

export const recipeKindEnum = pgEnum("recipe_kind", [
  "cake",
  "bait",
  "snack",
  "aprijuice",
  "other",
]);

export const recipes = pgTable(
  "recipes",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    kind: recipeKindEnum("kind").notNull(),
    resultId: text("result_id").notNull(),
    resultCount: integer("result_count").notNull().default(1),
    shape: text("shape").notNull(),
    grid: jsonb("grid"),
    ingredients: jsonb("ingredients"),
    seasoningTag: text("seasoning_tag"),
    seasoningProcessors: jsonb("seasoning_processors").$type<string[]>().notNull(),
    raw: jsonb("raw").notNull(),
  },
  (t) => [uniqueIndex("recipes_slug_idx").on(t.slug), index("recipes_kind_idx").on(t.kind)],
);

export const seasonings = pgTable(
  "seasonings",
  {
    id: serial("id").primaryKey(),
    itemId: text("item_id").notNull(),
    slug: text("slug").notNull(),
    colour: text("colour"),
    raw: jsonb("raw").notNull(),
  },
  (t) => [uniqueIndex("seasonings_slug_idx").on(t.slug)],
);

export const baitEffects = pgTable(
  "bait_effects",
  {
    id: serial("id").primaryKey(),
    itemId: text("item_id").notNull(),
    slug: text("slug").notNull(),
    effects: jsonb("effects").$type<Array<Record<string, unknown>>>().notNull(),
    raw: jsonb("raw").notNull(),
  },
  (t) => [uniqueIndex("bait_effects_slug_idx").on(t.slug)],
);

export const berries = pgTable(
  "berries",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    itemId: text("item_id").notNull(),
    flavours: jsonb("flavours").$type<Record<string, number>>().notNull(),
    dominantFlavour: text("dominant_flavour"),
    colour: text("colour"),
    weight: real("weight"),
    description: text("description"),
    effectTags: jsonb("effect_tags").$type<string[]>().notNull().default([]),
    snackPositionings: jsonb("snack_positionings")
      .$type<
        Array<{
          position: { x: number; y: number; z: number };
          rotation: { x: number; y: number; z: number };
        }>
      >()
      .notNull()
      .default([]),
    fruitModel: text("fruit_model"),
    fruitTexture: text("fruit_texture"),
    raw: jsonb("raw").notNull(),
  },
  (t) => [uniqueIndex("berries_slug_idx").on(t.slug)],
);

export const speciesWiki = pgTable(
  "species_wiki",
  {
    id: serial("id").primaryKey(),
    speciesId: integer("species_id")
      .notNull()
      .references(() => species.id, { onDelete: "cascade" }),
    pageTitle: text("page_title").notNull(),
    pageUrl: text("page_url").notNull(),
    summary: text("summary"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("species_wiki_species_idx").on(t.speciesId)],
);

/**
 * Aggregated site-wide counters — single-row table (id=1). Kept as a
 * row instead of Redis to avoid an infrastructure dependency.
 */
export const siteStats = pgTable("site_stats", {
  id: integer("id").primaryKey().default(1),
  visits: integer("visits").notNull().default(0),
  ratingCount: integer("rating_count").notNull().default(0),
  ratingSum: integer("rating_sum").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const siteRatings = pgTable(
  "site_ratings",
  {
    id: serial("id").primaryKey(),
    stars: integer("stars").notNull(),
    comment: text("comment"),
    locale: text("locale"),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("site_ratings_created_idx").on(t.createdAt)],
);

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: text("type").notNull(),
    route: text("route"),
    sessionId: text("session_id"),
    ipHash: text("ip_hash"),
    locale: text("locale"),
    referrer: text("referrer"),
    userAgent: text("user_agent"),
    props: jsonb("props").$type<Record<string, unknown>>().notNull().default({}),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("analytics_events_created_idx").on(t.createdAt),
    index("analytics_events_type_idx").on(t.type),
    index("analytics_events_route_idx").on(t.route),
  ],
);

export type Species = typeof species.$inferSelect;
export type NewSpecies = typeof species.$inferInsert;
export type Spawn = typeof spawns.$inferSelect;
export type NewSpawn = typeof spawns.$inferInsert;
export type Seasoning = typeof seasonings.$inferSelect;
export type BaitEffect = typeof baitEffects.$inferSelect;
export type Recipe = typeof recipes.$inferSelect;
export type SpeciesWiki = typeof speciesWiki.$inferSelect;
export type Berry = typeof berries.$inferSelect;
export type SpawnPreset = typeof spawnPresets.$inferSelect;
export type NewSpawnPreset = typeof spawnPresets.$inferInsert;
export type Mod = typeof mods.$inferSelect;
export type Dimension = typeof dimensions.$inferSelect;
export type BiomeTag = typeof biomeTags.$inferSelect;
export type BiomeTagMember = typeof biomeTagMembers.$inferSelect;
export type Structure = typeof structures.$inferSelect;
export type BiomeTagStructure = typeof biomeTagStructures.$inferSelect;
