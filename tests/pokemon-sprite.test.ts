import { describe, it, expect } from "vitest";
import {
  cobblemonToolsSlug,
  showdownSlug,
  pokespriteSlug,
  spriteCandidates,
} from "@/lib/sprites/pokemon-sprite";

describe("cobblemonToolsSlug", () => {
  it("returns the base slug as-is", () => {
    expect(cobblemonToolsSlug({ name: "Vulpix", baseSlug: "vulpix" })).toBe("vulpix");
  });

  it("rewrites regional aspects to cobblemon.tools' convention", () => {
    expect(
      cobblemonToolsSlug({ name: "Vulpix", baseSlug: "vulpix", variantLabel: "alolan" }),
    ).toBe("vulpix-alola");
    expect(
      cobblemonToolsSlug({
        name: "Slowpoke",
        baseSlug: "slowpoke",
        variantLabel: "galarian",
      }),
    ).toBe("slowpoke-galar");
    expect(
      cobblemonToolsSlug({
        name: "Tauros",
        baseSlug: "tauros",
        variantLabel: "paldean-combat",
      }),
    ).toBe("tauros-paldea-combat");
  });

  it("passes mega/gmax through unchanged", () => {
    expect(
      cobblemonToolsSlug({ name: "Charizard", baseSlug: "charizard", variantLabel: "mega-x" }),
    ).toBe("charizard-mega-x");
    expect(
      cobblemonToolsSlug({ name: "Charizard", baseSlug: "charizard", variantLabel: "gmax" }),
    ).toBe("charizard-gmax");
  });
});

describe("showdownSlug", () => {
  it("keeps the regional `-n` suffix", () => {
    expect(
      showdownSlug({ name: "Vulpix", baseSlug: "vulpix", variantLabel: "alolan" }),
    ).toBe("vulpix-alolan");
  });

  it("re-spells `paldean` to `paldea`", () => {
    expect(
      showdownSlug({
        name: "Tauros",
        baseSlug: "tauros",
        variantLabel: "paldean-combat",
      }),
    ).toBe("tauros-paldea-combat");
  });
});

describe("pokespriteSlug", () => {
  it("uses the short regional form (alola/galar/hisui/paldea)", () => {
    expect(
      pokespriteSlug({ name: "Vulpix", baseSlug: "vulpix", variantLabel: "alolan" }),
    ).toBe("vulpix-alola");
    expect(
      pokespriteSlug({
        name: "Tauros",
        baseSlug: "tauros",
        variantLabel: "paldean-combat",
      }),
    ).toBe("tauros-paldea-combat");
  });
});

describe("spriteCandidates", () => {
  it("base species cascade: Cobblemon → Showdown → pokesprite → PokeAPI sprite → official artwork", () => {
    const c = spriteCandidates({ dexNo: 6, name: "Charizard", baseSlug: "charizard" });
    expect(c[0]).toContain("cobblemon.tools/pokedex/pokemon/charizard/sprite.png");
    expect(c[1]).toContain("pokemonshowdown.com/sprites/dex/charizard.png");
    expect(c[2]).toContain("pokesprite/master/pokemon-gen8/regular/charizard.png");
    expect(c[3]).toContain("PokeAPI/sprites@master/sprites/pokemon/6.png");
    expect(c[4]).toContain("official-artwork/6.png");
    expect(c).toHaveLength(5);
  });

  it("variant cascade stops at pokesprite — never falls back to the base sprite", () => {
    const c = spriteCandidates({
      dexNo: 37,
      name: "Vulpix",
      baseSlug: "vulpix",
      variantLabel: "alolan",
    });
    expect(c[0]).toContain("cobblemon.tools/pokedex/pokemon/vulpix-alola/sprite.png");
    expect(c[1]).toContain("pokemonshowdown.com/sprites/dex/vulpix-alolan.png");
    expect(c[2]).toContain("pokesprite/master/pokemon-gen8/regular/vulpix-alola.png");
    expect(c).toHaveLength(3);
    // No PokeAPI dex-number nor base-form Cobblemon URL — would render
    // the wrong species.
    for (const url of c) {
      expect(url).not.toContain("PokeAPI/sprites@master/sprites/pokemon/37.png");
      expect(url).not.toContain("/pokemon/vulpix/sprite.png");
    }
  });

  it("routes shiny base species to shiny paths in every source", () => {
    const c = spriteCandidates({
      dexNo: 6,
      name: "Charizard",
      baseSlug: "charizard",
      shiny: true,
    });
    expect(c[0]).toContain("cobblemon.tools/pokedex/pokemon/charizard/sprite.png");
    expect(c[1]).toContain("dex-shiny/charizard.png");
    expect(c[2]).toContain("pokemon-gen8/shiny/charizard.png");
    expect(c[3]).toContain("/shiny/6.png");
  });

  it("routes shiny variants to shiny paths and still stops at pokesprite", () => {
    const c = spriteCandidates({
      dexNo: 37,
      name: "Vulpix",
      baseSlug: "vulpix",
      variantLabel: "alolan",
      shiny: true,
    });
    expect(c[0]).toContain("cobblemon.tools/pokedex/pokemon/vulpix-alola/sprite.png");
    expect(c[1]).toContain("dex-shiny/vulpix-alolan.png");
    expect(c[2]).toContain("pokemon-gen8/shiny/vulpix-alola.png");
    expect(c).toHaveLength(3);
  });
});
