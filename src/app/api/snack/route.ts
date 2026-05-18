import { NextRequest } from "next/server";
import {
  listAllSeasonings,
  listBaitEffects,
  listBerries,
  listSpawnsWithSpecies,
} from "@/lib/db/queries";
import {
  cakeDominantFlavour,
  cakeEffectTags,
  EFFECT_TAG_LABELS,
  filterSpawns,
  type CakeComposition,
  type SpawnFilter,
} from "@/lib/recommend/snack";
import {
  BAIT_VANILLA_ITEMS,
  formatBaitEffects,
  type FormattedBaitEffect,
  type RawBaitEffect,
} from "@/lib/recommend/bait-effects";
import {
  rankSnackAttractions,
  type SnackSpawnCandidate,
} from "@/lib/recommend/snack-spawn";
import type { Berry } from "@/lib/db/schema";

type IncomingFilter = Partial<SpawnFilter> & {
  biome?: string;
  timeRange?: string;
};

type Body = {
  composition?: CakeComposition;
  filter?: IncomingFilter;
};

function normalizeFilter(raw: IncomingFilter | undefined): SpawnFilter {
  const out: SpawnFilter = {};
  if (raw?.biomes && raw.biomes.length > 0) out.biomes = raw.biomes;
  else if (raw?.biome) out.biomes = [raw.biome];
  if (raw?.timeRanges && raw.timeRanges.length > 0) out.timeRanges = raw.timeRanges;
  else if (raw?.timeRange) out.timeRanges = [raw.timeRange];
  if (typeof raw?.minY === "number") out.minY = raw.minY;
  if (typeof raw?.maxY === "number") out.maxY = raw.maxY;
  if (raw?.weather) out.weather = raw.weather;
  if (raw?.sources && raw.sources.length > 0) out.sources = raw.sources;
  if (raw?.contexts && raw.contexts.length > 0) out.contexts = raw.contexts;
  if (raw?.structures && raw.structures.length > 0) out.structures = raw.structures;
  if (raw?.dimensions && raw.dimensions.length > 0) out.dimensions = raw.dimensions;
  if (typeof raw?.lightLevel === "number") out.lightLevel = raw.lightLevel;
  if (typeof raw?.skyLightLevel === "number") out.skyLightLevel = raw.skyLightLevel;
  if (typeof raw?.moonPhase === "number") out.moonPhase = raw.moonPhase;
  if (typeof raw?.canSeeSky === "boolean") out.canSeeSky = raw.canSeeSky;
  if (typeof raw?.baseBlock === "string") out.baseBlock = raw.baseBlock;
  if (raw?.nearbyBlocks && raw.nearbyBlocks.length > 0) out.nearbyBlocks = raw.nearbyBlocks;
  if (typeof raw?.fluid === "string") out.fluid = raw.fluid;
  if (raw?.requireDimension === true) out.requireDimension = true;
  return out;
}

type SeasoningDTO = {
  slug: string;
  itemId: string;
  kind: "berry" | "other";
  /**
   * Whether this item can actually sit in a Poké Snack / Poké Bait seasoning
   * slot. Corresponds to `cobblemon:recipe_filters/bait_seasoning` upstream —
   * any berry OR one of 7 vanilla items (apple, golden apple, enchanted golden
   * apple, glistering melon slice, golden carrot, sweet berries, glow berries).
   */
  snackValid: boolean;
  category: string;
  colour: string | null;
  flavours: Record<string, number>;
  dominantFlavour: string | null;
  description: string | null;
  effectTags: string[];
  /** Cooked raw JSON from spawn_bait_effects/; empty when not a bait item. */
  rawBaitEffects: RawBaitEffect[];
  /** Human-readable effects ready for UI display. */
  baitEffects: FormattedBaitEffect[];
  /** Bedrock 3D model name (without extension). Null for non-berries. */
  fruitModel: string | null;
  /** Fruit texture name (without extension). Null for non-berries. */
  fruitTexture: string | null;
  /** Up to 3 placements on the snack top face (pixel units). */
  snackPositionings: Array<{
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
  }>;
};

function classifySeasoning(
  slug: string,
  raw: Record<string, unknown>,
): {
  category: string;
  description: string;
} {
  const colour = (raw.colour as string) ?? (raw.color as string) ?? "unknown";

  let category = "other";
  if (/sweet$/.test(slug)) category = "Alcremie sweet";
  else if (slug === "chorus_flower" || slug === "chorus_fruit") category = "End";
  else if (
    slug.endsWith("_tulip") ||
    [
      "allium",
      "azure_bluet",
      "blue_orchid",
      "cornflower",
      "dandelion",
      "oxeye_daisy",
      "poppy",
      "sunflower",
      "torchflower",
      "lilac",
      "peony",
      "rose_bush",
      "lily_of_the_valley",
      "pink_petals",
      "spore_blossom",
      "pitcher_plant",
      "wildflowers",
      "wither_rose",
    ].includes(slug)
  )
    category = "flower";
  else if (slug.endsWith("_mushroom")) category = "mushroom";
  else if (slug.endsWith("_mint_leaf")) category = "mint";
  else if (
    [
      "apple",
      "carrot",
      "beetroot",
      "potato",
      "melon_slice",
      "glistening_melon_slice",
      "pumpkin",
      "honey_bottle",
      "dried_kelp",
      "sweet_berries",
      "glow_berries",
      "golden_apple",
      "enchanted_golden_apple",
      "golden_carrot",
      "poisonous_potato",
    ].includes(slug)
  )
    category = "food";
  else if (
    [
      "beef",
      "chicken",
      "cod",
      "egg",
      "mutton",
      "porkchop",
      "rabbit",
      "salmon",
      "rotten_flesh",
    ].includes(slug)
  )
    category = "mob drop";
  else if (
    [
      "big_root",
      "energy_root",
      "revival_herb",
      "mental_herb",
      "mirror_herb",
      "power_herb",
      "white_herb",
      "medicinal_leek",
      "pep_up_flower",
      "tasty_tail",
      "galarica_nuts",
      "vivichoke",
      "moomoo_milk",
      "milk_bucket",
      "sugar",
      "dead_bush",
    ].includes(slug)
  )
    category = "ingredient";

  const parts: string[] = [`Colour: ${colour}.`];
  return { category, description: parts.join(" ") };
}

type RawSeasoningRow = {
  slug: string;
  itemId: string;
  colour: string | null;
  raw: unknown;
};

type RawBaitEffectRow = {
  itemId: string;
  effects: RawBaitEffect[];
};

function buildPantry(
  berries: Berry[],
  rawSeasonings: RawSeasoningRow[],
  baitEffectsByItem: Map<string, RawBaitEffect[]>,
): SeasoningDTO[] {
  const berryBySlug = new Map(berries.map((b) => [b.slug, b]));
  const out: SeasoningDTO[] = [];

  for (const berry of berries) {
    const raw = baitEffectsByItem.get(berry.itemId) ?? [];
    out.push({
      slug: berry.slug,
      itemId: berry.itemId,
      kind: "berry",
      snackValid: true, // every berry is in #cobblemon:berries ⊂ bait_seasoning
      category: "berry",
      colour: berry.colour,
      flavours: berry.flavours,
      dominantFlavour: berry.dominantFlavour,
      description: berry.description,
      effectTags: berry.effectTags ?? [],
      rawBaitEffects: raw,
      baitEffects: formatBaitEffects(raw),
      fruitModel: berry.fruitModel ?? null,
      fruitTexture: berry.fruitTexture ?? null,
      snackPositionings: berry.snackPositionings ?? [],
    });
  }
  for (const s of rawSeasonings) {
    if (berryBySlug.has(s.slug)) continue;
    const rawJson = (s.raw ?? {}) as Record<string, unknown>;
    const meta = classifySeasoning(s.slug, rawJson);
    const baitRaw = baitEffectsByItem.get(s.itemId) ?? [];
    const isSnackValid = BAIT_VANILLA_ITEMS.has(s.itemId);
    out.push({
      slug: s.slug,
      itemId: s.itemId,
      kind: "other",
      snackValid: isSnackValid,
      category: meta.category,
      colour: s.colour,
      flavours: {},
      dominantFlavour: null,
      description: meta.description,
      effectTags: [],
      rawBaitEffects: baitRaw,
      baitEffects: formatBaitEffects(baitRaw),
      fruitModel: null,
      fruitTexture: null,
      snackPositionings: [],
    });
  }
  return out;
}

function ok(data: unknown) {
  return Response.json(data, {
    headers: {
      "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

export async function GET() {
  const [berries, seasonings, rawBaits] = await Promise.all([
    listBerries(),
    listAllSeasonings(),
    listBaitEffects(),
  ]);
  const baitByItem = new Map<string, RawBaitEffect[]>();
  for (const b of rawBaits as RawBaitEffectRow[]) {
    baitByItem.set(b.itemId, b.effects as RawBaitEffect[]);
  }
  const pantry = buildPantry(berries, seasonings, baitByItem);
  return ok({
    seasonings: pantry,
    berries: pantry.filter((s) => s.kind === "berry"),
    // Everything legally usable in a Poké Snack / Poké Bait slot.
    snackSeasonings: pantry.filter((s) => s.snackValid),
  });
}

export async function POST(req: NextRequest) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const seasoningSlugs = (body.composition?.seasoningSlugs ?? []).slice(0, 3);
  const filter: SpawnFilter = normalizeFilter(body.filter);

  const [berries, allSeasonings, rawBaits] = await Promise.all([
    listBerries(),
    listAllSeasonings(),
    listBaitEffects(),
  ]);
  const byslug = new Map<string, Berry>(berries.map((b) => [b.slug, b]));
  // Map every seasoning slug (berry OR vanilla) to its upstream itemId,
  // so vanilla bait items (apple, golden_apple, glow_berries…) resolve too.
  const itemIdBySlug = new Map<string, string>();
  for (const b of berries) itemIdBySlug.set(b.slug, b.itemId);
  for (const s of allSeasonings) itemIdBySlug.set(s.slug, s.itemId);
  const baitByItem = new Map<string, RawBaitEffect[]>();
  for (const b of rawBaits as RawBaitEffectRow[]) {
    baitByItem.set(b.itemId, b.effects as RawBaitEffect[]);
  }

  // validSlugs = every slug we recognise (berry OR vanilla bait seasoning).
  const validSlugs = seasoningSlugs.filter((s) => itemIdBySlug.has(s));

  // The cake-flavour lookup only makes sense for berries (vanilla items have
  // no flavour profile). Keep that narrow for dominant + hold effects.
  const berrySlugsInCake = validSlugs.filter((s) => byslug.has(s));
  const dominant = cakeDominantFlavour({ seasoningSlugs: berrySlugsInCake }, byslug);
  const effectTags = cakeEffectTags({ seasoningSlugs: berrySlugsInCake }, byslug);
  const holdEffects = effectTags.map((t) => ({
    tag: t,
    ...(EFFECT_TAG_LABELS[t] ?? { title: t, description: "", tone: "utility" }),
  }));

  // Aggregate bait-seasoning effects across every placed slot (berries + vanilla).
  // Effects of the same (kind, title) are merged: their chances sum, capped at 100%.
  const baitEffects: FormattedBaitEffect[] = [];
  for (const slug of validSlugs) {
    const itemId = itemIdBySlug.get(slug);
    if (!itemId) continue;
    const raw = baitByItem.get(itemId) ?? [];
    baitEffects.push(...formatBaitEffects(raw));
  }
  const mergedBaitEffects: FormattedBaitEffect[] = [];
  for (const eff of baitEffects) {
    const key = `${eff.kind}:${eff.title}`;
    const existing = mergedBaitEffects.find((e) => `${e.kind}:${e.title}` === key);
    if (existing) {
      existing.chance = Math.min(1, existing.chance + eff.chance);
    } else {
      mergedBaitEffects.push({ ...eff });
    }
  }

  // Re-implement the actual Cobblemon Poké Snack attraction pipeline.
  // Gather candidates from the world pool, filter by SpawnRules (biome /
  // time / Y-range), then run them through `rankSnackAttractions` which
  // applies the bucket multipliers and bait influences faithfully.
  const spawns = await listSpawnsWithSpecies(10000);
  const matchingSpawns = filterSpawns(spawns, filter);

  const combinedRawEffects: RawBaitEffect[] = [];
  for (const slug of validSlugs) {
    const itemId = itemIdBySlug.get(slug);
    if (!itemId) continue;
    combinedRawEffects.push(...(baitByItem.get(itemId) ?? []));
  }

  const candidates: SnackSpawnCandidate[] = matchingSpawns.map((s) => ({
    spawnId: s.spawnId,
    speciesId: s.speciesId,
    slug: s.slug,
    name: s.name,
    dexNo: s.dexNo,
    primaryType: s.primaryType,
    secondaryType: s.secondaryType,
    variantLabel: s.variantLabel,
    eggGroups: s.eggGroups ?? [],
    bucket: s.bucket,
    weight: s.weight,
    levelMin: s.levelMin,
    levelMax: s.levelMax,
  }));

  const ranked = rankSnackAttractions(
    candidates,
    {
      biomes: filter.biomes,
      timeRanges: filter.timeRanges,
      minY: filter.minY,
      maxY: filter.maxY,
    },
    combinedRawEffects,
    { limit: 200 },
  );

  // Deduplicate by species (show the best-ranked spawn for each species).
  const bestBySpecies = new Map<number, (typeof ranked)[number]>();
  for (const r of ranked) {
    const prev = bestBySpecies.get(r.speciesId);
    if (!prev || r.finalProbability > prev.finalProbability) {
      bestBySpecies.set(r.speciesId, r);
    }
  }
  const uniqueRanked = [...bestBySpecies.values()].sort(
    (a, b) => b.finalProbability - a.finalProbability,
  );

  // Spawn entries already carry the condition payload; we index by
  // spawnId so we can hand them back to the UI without a second query.
  const spawnById = new Map<number, (typeof matchingSpawns)[number]>();
  for (const s of matchingSpawns) spawnById.set(s.spawnId, s);

  const attracted = uniqueRanked.slice(0, 100).map((r) => {
    const sourceSpawn = spawnById.get(r.spawnId);
    return {
      speciesId: r.speciesId,
      slug: r.slug,
      name: r.name,
      dexNo: r.dexNo,
      primaryType: r.primaryType,
      secondaryType: r.secondaryType,
      variantLabel: r.variantLabel ?? null,
      bucket: r.bucket,
      weight: r.weight,
      adjustedWeight: r.adjustedWeight,
      probability: r.finalProbability,
      reasons: r.reasons,
      levelMin: r.levelMin,
      levelMax: r.levelMax,
      context: sourceSpawn?.context ?? null,
      biomes: sourceSpawn?.biomes ?? [],
      condition: (sourceSpawn?.condition ?? null) as Record<string, unknown> | null,
      anticondition: (sourceSpawn?.anticondition ?? null) as Record<string, unknown> | null,
      // listSpawnsWithSpecies doesn't pull `presets`; the column is on
      // the spawns table though, so we just surface an empty array
      // here. The fiche page already shows the full preset chain.
      presets: [] as string[],
    };
  });

  return ok({
    cake: {
      dominantFlavour: dominant,
      seasoningSlugs: berrySlugsInCake,
      colorHint:
        berries.find((b) => b.slug === berrySlugsInCake[0])?.colour ?? null,
      effects: holdEffects,
    },
    snack: {
      seasoningSlugs: validSlugs,
      baitEffects: mergedBaitEffects,
    },
    filter,
    count: uniqueRanked.length,
    attracted,
  });
}
