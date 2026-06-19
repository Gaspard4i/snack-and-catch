import { describe, it, expect } from "vitest";
import { extractBerryDrops } from "@/lib/parsers/drops";

describe("extractBerryDrops", () => {
  it("pulls percentage berry drops from the base species", () => {
    const drops = extractBerryDrops({
      drops: {
        amount: 3,
        entries: [
          { item: "minecraft:ender_pearl", quantityRange: "0-1" },
          { item: "cobblemon:twisted_spoon", percentage: 2.5 },
          { item: "cobblemon:kasib_berry", percentage: 2.5 },
        ],
      },
    });
    expect(drops).toEqual([
      { berryItemId: "cobblemon:kasib_berry", percentage: 2.5, quantityRange: null },
    ]);
  });

  it("keeps quantity-range berry drops with a null percentage", () => {
    const drops = extractBerryDrops({
      drops: { entries: [{ item: "cobblemon:oran_berry", quantityRange: "0-2" }] },
    });
    expect(drops).toEqual([
      { berryItemId: "cobblemon:oran_berry", percentage: null, quantityRange: "0-2" },
    ]);
  });

  it("treats an entry with neither field as a guaranteed drop", () => {
    const drops = extractBerryDrops({
      drops: { entries: [{ item: "cobblemon:oran_berry" }] },
    });
    expect(drops).toEqual([
      { berryItemId: "cobblemon:oran_berry", percentage: null, quantityRange: null },
    ]);
  });

  it("collects drops from forms and attributes them to the same species", () => {
    const drops = extractBerryDrops({
      drops: { entries: [{ item: "cobblemon:cheri_berry", percentage: 5 }] },
      forms: [
        { name: "Alolan", drops: { entries: [{ item: "cobblemon:rawst_berry", percentage: 10 }] } },
      ],
    });
    expect(drops).toHaveLength(2);
    expect(drops.map((d) => d.berryItemId).sort()).toEqual([
      "cobblemon:cheri_berry",
      "cobblemon:rawst_berry",
    ]);
  });

  it("de-duplicates a berry across base + forms, keeping the highest percentage", () => {
    const drops = extractBerryDrops({
      drops: { entries: [{ item: "cobblemon:cheri_berry", percentage: 5 }] },
      forms: [{ drops: { entries: [{ item: "cobblemon:cheri_berry", percentage: 10 }] } }],
    });
    expect(drops).toEqual([
      { berryItemId: "cobblemon:cheri_berry", percentage: 10, quantityRange: null },
    ]);
  });

  it("keeps the first drop when a later duplicate is less generous", () => {
    const drops = extractBerryDrops({
      drops: { entries: [{ item: "cobblemon:cheri_berry", percentage: 10 }] },
      forms: [{ drops: { entries: [{ item: "cobblemon:cheri_berry", percentage: 5 }] } }],
    });
    expect(drops).toEqual([
      { berryItemId: "cobblemon:cheri_berry", percentage: 10, quantityRange: null },
    ]);
  });

  it("prefers a percentage drop over a duplicate quantity-range drop", () => {
    const drops = extractBerryDrops({
      drops: { entries: [{ item: "cobblemon:oran_berry", quantityRange: "0-1" }] },
      forms: [{ drops: { entries: [{ item: "cobblemon:oran_berry", percentage: 5 }] } }],
    });
    expect(drops).toEqual([
      { berryItemId: "cobblemon:oran_berry", percentage: 5, quantityRange: null },
    ]);
  });

  it("keeps a percentage drop over a later quantity-range duplicate", () => {
    const drops = extractBerryDrops({
      drops: { entries: [{ item: "cobblemon:oran_berry", percentage: 5 }] },
      forms: [{ drops: { entries: [{ item: "cobblemon:oran_berry", quantityRange: "0-1" }] } }],
    });
    expect(drops).toEqual([
      { berryItemId: "cobblemon:oran_berry", percentage: 5, quantityRange: null },
    ]);
  });

  it("ignores non-berry items", () => {
    const drops = extractBerryDrops({
      drops: {
        entries: [
          { item: "minecraft:diamond", percentage: 1 },
          { item: "cobblemon:rare_candy", percentage: 1 },
          { item: "cobblemon:blueberry_seeds", percentage: 1 },
        ],
      },
    });
    expect(drops).toEqual([]);
  });

  it("returns an empty list for missing / malformed input", () => {
    expect(extractBerryDrops(null)).toEqual([]);
    expect(extractBerryDrops(undefined)).toEqual([]);
    expect(extractBerryDrops("nope")).toEqual([]);
    expect(extractBerryDrops({})).toEqual([]);
    expect(extractBerryDrops({ drops: {} })).toEqual([]);
    expect(extractBerryDrops({ drops: { entries: "bad" } })).toEqual([]);
    expect(extractBerryDrops({ drops: { entries: [null, 3, {}] } })).toEqual([]);
    expect(extractBerryDrops({ forms: [null, { drops: null }] })).toEqual([]);
  });
});
