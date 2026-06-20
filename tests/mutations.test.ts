import { describe, it, expect } from "vitest";
import { mutationsProducing, type BerrySource } from "@/lib/recommend/mutations";

const berries: BerrySource[] = [
  {
    slug: "cheri_berry",
    itemId: "cobblemon:cheri_berry",
    mutations: {
      "cobblemon:oran_berry": "cobblemon:lum_berry",
      "cobblemon:persim_berry": "cobblemon:figy_berry",
    },
  },
  {
    slug: "oran_berry",
    itemId: "cobblemon:oran_berry",
    // Upstream lists the reverse cross too — same unordered pair.
    mutations: { "cobblemon:cheri_berry": "cobblemon:lum_berry" },
  },
  {
    slug: "pecha_berry",
    itemId: "cobblemon:pecha_berry",
    mutations: { "cobblemon:oran_berry": "cobblemon:lum_berry" },
  },
  { slug: "lum_berry", itemId: "cobblemon:lum_berry", mutations: null },
];

describe("mutationsProducing", () => {
  it("collects the parent pairs that mutate into the target", () => {
    const pairs = mutationsProducing("cobblemon:lum_berry", berries);
    const asKeys = pairs.map((p) => p.parents.join("+")).sort();
    expect(asKeys).toEqual([
      "cobblemon:cheri_berry+cobblemon:oran_berry",
      "cobblemon:oran_berry+cobblemon:pecha_berry",
    ]);
  });

  it("de-duplicates the reverse A+B / B+A ordering", () => {
    const pairs = mutationsProducing("cobblemon:lum_berry", berries);
    // cheri+oran is declared on both cheri and oran — must appear once.
    const cheriOran = pairs.filter(
      (p) =>
        p.parents.includes("cobblemon:cheri_berry") &&
        p.parents.includes("cobblemon:oran_berry"),
    );
    expect(cheriOran).toHaveLength(1);
  });

  it("sorts the parents for stable display", () => {
    const pairs = mutationsProducing("cobblemon:figy_berry", berries);
    expect(pairs).toEqual([
      { parents: ["cobblemon:cheri_berry", "cobblemon:persim_berry"] },
    ]);
  });

  it("returns empty for a berry no cross produces", () => {
    expect(mutationsProducing("cobblemon:cheri_berry", berries)).toEqual([]);
  });

  it("tolerates berries with null/undefined mutations", () => {
    const sparse: BerrySource[] = [
      { slug: "a", itemId: "cobblemon:a", mutations: undefined },
      { slug: "b", itemId: "cobblemon:b", mutations: null },
    ];
    expect(mutationsProducing("cobblemon:x", sparse)).toEqual([]);
  });
});
