import { describe, it, expect } from "vitest";
import {
  showdownSlug,
  pokespriteSlug,
  spriteCandidates,
} from "@/lib/sprites/pokemon-sprite";

describe("showdownSlug", () => {
  it("returns the base slug as-is", () => {
    expect(showdownSlug({ name: "Vulpix", baseSlug: "vulpix" })).toBe("vulpix");
  });

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

  it("passes mega/gmax through unchanged", () => {
    expect(
      showdownSlug({ name: "Charizard", baseSlug: "charizard", variantLabel: "mega-x" }),
    ).toBe("charizard-mega-x");
    expect(
      showdownSlug({ name: "Charizard", baseSlug: "charizard", variantLabel: "gmax" }),
    ).toBe("charizard-gmax");
  });
});

describe("pokespriteSlug", () => {
  it("returns the base slug as-is", () => {
    expect(pokespriteSlug({ name: "Vulpix", baseSlug: "vulpix" })).toBe("vulpix");
  });

  it("uses the short regional form (alola/galar/hisui/paldea)", () => {
    expect(
      pokespriteSlug({ name: "Vulpix", baseSlug: "vulpix", variantLabel: "alolan" }),
    ).toBe("vulpix-alola");
    expect(
      pokespriteSlug({
        name: "Slowpoke",
        baseSlug: "slowpoke",
        variantLabel: "galarian",
      }),
    ).toBe("slowpoke-galar");
    expect(
      pokespriteSlug({
        name: "Tauros",
        baseSlug: "tauros",
        variantLabel: "paldean-combat",
      }),
    ).toBe("tauros-paldea-combat");
  });

  it("passes mega/gmax through unchanged", () => {
    expect(
      pokespriteSlug({ name: "Charizard", baseSlug: "charizard", variantLabel: "mega-x" }),
    ).toBe("charizard-mega-x");
    expect(
      pokespriteSlug({ name: "Charizard", baseSlug: "charizard", variantLabel: "gmax" }),
    ).toBe("charizard-gmax");
  });
});

describe("spriteCandidates", () => {
  it("base species cascade: pokesprite → Showdown → PokeAPI sprite → official artwork", () => {
    const c = spriteCandidates({ dexNo: 6, name: "Charizard", baseSlug: "charizard" });
    expect(c[0]).toContain("pokesprite/master/pokemon-gen8/regular/charizard.png");
    expect(c[1]).toContain("pokemonshowdown.com/sprites/dex/charizard.png");
    expect(c[2]).toContain("PokeAPI/sprites@master/sprites/pokemon/6.png");
    expect(c[3]).toContain("official-artwork/6.png");
    expect(c).toHaveLength(4);
    // No Cobblemon URL anywhere in the cascade.
    for (const url of c) {
      expect(url).not.toContain("cobblemon.tools");
    }
  });

  it("variant cascade stops at Showdown — never falls back to the base sprite", () => {
    const c = spriteCandidates({
      dexNo: 37,
      name: "Vulpix",
      baseSlug: "vulpix",
      variantLabel: "alolan",
    });
    expect(c[0]).toContain("pokesprite/master/pokemon-gen8/regular/vulpix-alola.png");
    expect(c[1]).toContain("pokemonshowdown.com/sprites/dex/vulpix-alolan.png");
    expect(c).toHaveLength(2);
    for (const url of c) {
      // No dex-number PokeAPI URL → would render the base species.
      expect(url).not.toMatch(/sprites\/pokemon\/(?:shiny\/)?37\.png/);
      // No Cobblemon URL.
      expect(url).not.toContain("cobblemon.tools");
    }
  });

  it("routes shiny base species to shiny paths in every source", () => {
    const c = spriteCandidates({
      dexNo: 6,
      name: "Charizard",
      baseSlug: "charizard",
      shiny: true,
    });
    expect(c[0]).toContain("pokemon-gen8/shiny/charizard.png");
    expect(c[1]).toContain("dex-shiny/charizard.png");
    expect(c[2]).toContain("/shiny/6.png");
  });

  it("routes shiny variants to shiny paths and still stops at Showdown", () => {
    const c = spriteCandidates({
      dexNo: 37,
      name: "Vulpix",
      baseSlug: "vulpix",
      variantLabel: "alolan",
      shiny: true,
    });
    expect(c[0]).toContain("pokemon-gen8/shiny/vulpix-alola.png");
    expect(c[1]).toContain("dex-shiny/vulpix-alolan.png");
    expect(c).toHaveLength(2);
  });
});
