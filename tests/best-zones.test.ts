import { describe, it, expect } from "vitest";
import { bestZonesForSpecies, pickBestCake } from "@/lib/recommend/best-zones";
import type { SpawnWithSpecies } from "@/lib/db/queries";

function spawn(
  speciesId: number,
  primary: string,
  bucket: SpawnWithSpecies["bucket"],
  weight: number,
  biomes: string[],
  overrides: Partial<SpawnWithSpecies> = {},
): SpawnWithSpecies {
  return {
    spawnId: Math.floor(Math.random() * 1e6),
    speciesId,
    bucket,
    weight,
    levelMin: 1,
    levelMax: 50,
    biomes,
    condition: { biomes } as unknown,
    anticondition: null as unknown,
    context: "grounded",
    conditionDimensions: [],
    conditionBiomeTags: biomes,
    conditionStructures: [],
    sourceKind: "mod",
    sourceName: "cobblemon",
    slug: `species-${speciesId}`,
    name: `Species ${speciesId}`,
    dexNo: speciesId,
    primaryType: primary,
    secondaryType: null,
    preferredFlavours: null,
    variantOfSpeciesId: null,
    variantLabel: null,
    eggGroups: [],
    ...overrides,
  };
}

describe("pickBestCake", () => {
  it("picks the berry whose typing bait boosts the target", () => {
    // Pool: target fire mon (rare) + competing water mon (common, much heavier).
    // Without bait, the heavy water mon dominates the pool. A fire-typing berry
    // should swing the probability towards the target.
    const pool: SpawnWithSpecies[] = [
      spawn(1, "fire", "rare", 1, ["#cobblemon:nether/is_basalt"]),
      spawn(2, "water", "common", 100, ["#cobblemon:nether/is_basalt"]),
    ];
    const berries = [
      {
        slug: "tamato",
        effects: [
          { type: "cobblemon:typing", subcategory: "fire", chance: 1, value: 5 },
        ],
      },
      {
        slug: "oran",
        effects: [
          { type: "cobblemon:typing", subcategory: "water", chance: 1, value: 5 },
        ],
      },
    ];
    const out = pickBestCake(pool, 1, berries);
    expect(out.berrySlugs).toContain("tamato");
    expect(out.probability).toBeGreaterThan(out.baseline);
  });

  it("does not stack berries that hurt the target", () => {
    const pool: SpawnWithSpecies[] = [
      spawn(1, "fire", "common", 5, ["#cobblemon:overworld/is_plains"]),
      spawn(2, "water", "common", 5, ["#cobblemon:overworld/is_plains"]),
    ];
    const berries = [
      {
        slug: "oran",
        effects: [
          { type: "cobblemon:typing", subcategory: "water", chance: 1, value: 10 },
        ],
      },
    ];
    const out = pickBestCake(pool, 1, berries);
    // The only candidate berry boosts the wrong type; greedy must keep the cake empty.
    expect(out.berrySlugs).toEqual([]);
    expect(out.probability).toBe(out.baseline);
  });
});

describe("bestZonesForSpecies", () => {
  it("returns one entry per zone the species spawns in, sorted by probability", () => {
    const speciesId = 7;
    const spawns: SpawnWithSpecies[] = [
      // Zone 1: Nether basalt — easy zone (lone fire mon).
      spawn(speciesId, "fire", "rare", 1, ["#cobblemon:nether/is_basalt"]),
      spawn(99, "fire", "common", 1, ["#cobblemon:nether/is_basalt"]),
      // Zone 2: Overworld plains — saturated with competing water mons.
      spawn(speciesId, "fire", "rare", 1, ["#cobblemon:overworld/is_plains"]),
      spawn(101, "water", "common", 100, ["#cobblemon:overworld/is_plains"]),
      spawn(102, "water", "common", 100, ["#cobblemon:overworld/is_plains"]),
    ];
    const recos = bestZonesForSpecies({ speciesId, spawns, berries: [] });
    expect(recos).toHaveLength(2);
    // Best zone should be the empty Nether — less competition.
    // Best zone is the Nether basalt — its zone title is the curated
    // "Nether" section.
    expect(recos[0].zoneTitle).toBe("Nether");
    expect(recos[0].primaryBiome).toBe("#cobblemon:nether/is_basalt");
    expect(recos[0].probability).toBeGreaterThan(recos[1].probability);
  });

  it("returns at most 3 zones even if the mon spawns everywhere", () => {
    const speciesId = 11;
    const spawns: SpawnWithSpecies[] = Array.from({ length: 6 }, (_, i) =>
      spawn(speciesId, "normal", "common", 1, [`#cobblemon:zone-${i}`]),
    );
    const recos = bestZonesForSpecies({ speciesId, spawns, berries: [] });
    expect(recos.length).toBeLessThanOrEqual(3);
  });

  it("returns an empty list when the species has no spawn", () => {
    const recos = bestZonesForSpecies({
      speciesId: 999,
      spawns: [spawn(1, "normal", "common", 1, ["#cobblemon:plains"])],
      berries: [],
    });
    expect(recos).toEqual([]);
  });
});
