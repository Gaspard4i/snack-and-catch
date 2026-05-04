/**
 * Per-species "best zones to find this Pokémon" recommender.
 *
 * For each spawn rule of the target species we:
 *   1. Group spawns by zone (= dimension + biome family). A zone with
 *      multiple matching spawns keeps the best-scoring one.
 *   2. Restrict the world spawn pool to spawns that share the zone
 *      (dimension match + biome overlap).
 *   3. Greedy-search up to 3 berry-only bait slots that maximise the
 *      target species' `finalProbability` in that pool.
 *   4. Return the top N zones sorted by best probability.
 *
 * Berry-only on purpose: the bait_effects table already covers berries
 * with their full `effects[]`; restricting the search space keeps the
 * recommendation cheap (few hundred simulations per species) and the
 * result actionable for the player.
 */

import type { RawBaitEffect } from "./bait-effects";
import {
  rankSnackAttractions,
  type SnackSpawnCandidate,
} from "./snack-spawn";
import type { SpawnWithSpecies } from "../db/queries";

const MAX_SLOTS = 3;
const TOP_ZONES = 3;

export type ZoneRecommendation = {
  /** Stable identifier so the UI can key on it. */
  key: string;
  /** Vanilla dimension key, e.g. `minecraft:overworld`. */
  dimension: string;
  /**
   * Most-specific biome tag the spawn declares for this zone, e.g.
   * `#cobblemon:nether/is_basalt` or `minecraft:plains`. May be `null`
   * if the spawn carries no biome constraint at all.
   */
  biome: string | null;
  /** Probability of attracting the target species with the cake below. */
  probability: number;
  /** Probability of attracting the species in this zone with NO bait. */
  baselineProbability: number;
  /** Up to 3 berry slugs forming the optimal cake. May be empty. */
  berrySlugs: string[];
  /** How many spawns of the target species fall in this zone. */
  spawnCount: number;
};

type BerryBait = {
  slug: string;
  /** All bait_effects rows for this berry (multiple effects per item). */
  effects: RawBaitEffect[];
};

/**
 * Build the lightweight candidate DTO `rankSnackAttractions` needs out
 * of the heavier `listSpawnsWithSpecies` row.
 */
function toCandidate(s: SpawnWithSpecies): SnackSpawnCandidate {
  return {
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
  };
}

/**
 * Resolve the dimension a spawn belongs to. Prefer the explicit
 * `condition_dimensions` column; fall back to the cleaner first biome
 * tag (we only need a stable key).
 */
function spawnDimension(s: SpawnWithSpecies): string {
  const explicit = s.conditionDimensions?.[0];
  if (explicit) return explicit;
  const biome = (s.biomes ?? [])[0] ?? "";
  if (/nether/i.test(biome)) return "minecraft:the_nether";
  if (/end\b/i.test(biome) || /the_end/.test(biome)) return "minecraft:the_end";
  return "minecraft:overworld";
}

function spawnBiomeKey(s: SpawnWithSpecies): string | null {
  // The first biome on the spawn IS the most specific descriptor — the
  // ingest preserves the order Cobblemon serialises (specific tag first,
  // generic ones afterwards).
  return (s.biomes ?? [])[0] ?? null;
}

function sameZone(target: SpawnWithSpecies, candidate: SpawnWithSpecies): boolean {
  if (spawnDimension(target) !== spawnDimension(candidate)) return false;
  const tBio = new Set(target.biomes ?? []);
  if (tBio.size === 0) return true; // dim-only target: any same-dim spawn pools in
  const cBio = candidate.biomes ?? [];
  if (cBio.length === 0) return true;
  return cBio.some((b) => tBio.has(b));
}

function speciesKey(s: SpawnWithSpecies): number {
  return s.speciesId;
}

function probabilityOfTarget(
  pool: SpawnWithSpecies[],
  targetSpeciesId: number,
  baits: RawBaitEffect[],
): number {
  if (pool.length === 0) return 0;
  const candidates = pool.map(toCandidate);
  const ranked = rankSnackAttractions(candidates, {}, baits, { limit: pool.length });
  // Sum probabilities across every spawn entry of the target species —
  // multiple spawns of the same mon in the same zone all contribute to
  // the chance of seeing it in a roll.
  let p = 0;
  for (const r of ranked) {
    if (r.speciesId === targetSpeciesId) p += r.finalProbability;
  }
  return p;
}

/**
 * Greedy: at each slot pick the berry that yields the highest target
 * probability, until the increment stops being worth a slot. Stops
 * early when adding any berry would *decrease* the probability — which
 * happens when the new bait boosts a competing typing.
 */
export function pickBestCake(
  pool: SpawnWithSpecies[],
  targetSpeciesId: number,
  berries: BerryBait[],
): { berrySlugs: string[]; probability: number; baseline: number } {
  const baseline = probabilityOfTarget(pool, targetSpeciesId, []);
  const chosen: BerryBait[] = [];
  let best = baseline;

  for (let slot = 0; slot < MAX_SLOTS; slot++) {
    let bestAdd: BerryBait | null = null;
    let bestNext = best;
    const used = new Set(chosen.map((b) => b.slug));
    for (const berry of berries) {
      if (used.has(berry.slug)) continue;
      const trial = [...chosen, berry];
      const baits = trial.flatMap((b) => b.effects);
      const p = probabilityOfTarget(pool, targetSpeciesId, baits);
      if (p > bestNext + 1e-9) {
        bestNext = p;
        bestAdd = berry;
      }
    }
    if (!bestAdd) break;
    chosen.push(bestAdd);
    best = bestNext;
  }

  return {
    berrySlugs: chosen.map((b) => b.slug),
    probability: best,
    baseline,
  };
}

/**
 * Rank the zones a species spawns in by best achievable target
 * probability and return up to 3.
 */
export function bestZonesForSpecies(opts: {
  speciesId: number;
  spawns: SpawnWithSpecies[];
  /** Full berry catalogue (slug + bait effects); only those carrying at
   *  least one effect are useful. */
  berries: BerryBait[];
}): ZoneRecommendation[] {
  const ownSpawns = opts.spawns.filter((s) => speciesKey(s) === opts.speciesId);
  if (ownSpawns.length === 0) return [];

  // Group own spawns by zone signature (dim + biome key). Multiple own
  // spawns in the same zone are merged; we only need the union for the
  // pool restriction step.
  const zoneMap = new Map<
    string,
    { samples: SpawnWithSpecies[]; dim: string; biome: string | null }
  >();
  for (const s of ownSpawns) {
    const dim = spawnDimension(s);
    const biome = spawnBiomeKey(s);
    const key = `${dim}|${biome ?? "*"}`;
    const prev = zoneMap.get(key);
    if (prev) prev.samples.push(s);
    else zoneMap.set(key, { samples: [s], dim, biome });
  }

  const recos: ZoneRecommendation[] = [];

  for (const [key, zone] of zoneMap) {
    // Pool = every world spawn that shares the zone with at least one
    // sample; lookups against the sample set keep the cost linear in
    // the spawn corpus regardless of how many samples a zone has.
    const pool = opts.spawns.filter((s) =>
      zone.samples.some((sample) => sameZone(sample, s)),
    );

    // Berries to consider: only those whose effects actually move the
    // target's odds (typing match, egg-group match, or rarity-bucket
    // for a non-common bucket). Keep all rarity baits in any case.
    const targetSpawn = zone.samples[0];
    const candidateBerries = filterRelevantBerries(opts.berries, targetSpawn);

    const { berrySlugs, probability, baseline } = pickBestCake(
      pool,
      opts.speciesId,
      candidateBerries,
    );

    recos.push({
      key,
      dimension: zone.dim,
      biome: zone.biome,
      probability,
      baselineProbability: baseline,
      berrySlugs,
      spawnCount: zone.samples.length,
    });
  }

  recos.sort((a, b) => b.probability - a.probability);
  return recos.slice(0, TOP_ZONES);
}

function filterRelevantBerries(
  berries: BerryBait[],
  targetSpawn: SpawnWithSpecies,
): BerryBait[] {
  const types = new Set(
    [targetSpawn.primaryType, targetSpawn.secondaryType]
      .filter((t): t is string => !!t)
      .map((t) => t.toLowerCase()),
  );
  const eggGroups = new Set((targetSpawn.eggGroups ?? []).map((g) => g.toLowerCase()));
  const bucketBoostMatters = targetSpawn.bucket !== "common";

  const out: BerryBait[] = [];
  for (const berry of berries) {
    let useful = false;
    for (const eff of berry.effects) {
      const type = String(eff.type ?? "").replace(/^cobblemon:/, "");
      const sub = String(eff.subcategory ?? "")
        .replace(/^cobblemon:/, "")
        .toLowerCase();
      if (type === "typing" && types.has(sub)) useful = true;
      else if (type === "egg_group" && eggGroups.has(sub)) useful = true;
      else if (type === "rarity_bucket" && bucketBoostMatters) useful = true;
      if (useful) break;
    }
    if (useful) out.push(berry);
  }
  return out;
}
