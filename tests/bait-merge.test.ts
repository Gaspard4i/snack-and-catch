import { describe, it, expect } from "vitest";
import { mergeRawBaitEffects } from "@/lib/recommend/bait-effects";

describe("mergeRawBaitEffects (SpawnBaitUtils.mergeEffects port)", () => {
  it("stacks the value of three identical shiny effects (×4 → ×12)", () => {
    const star = {
      type: "cobblemon:shiny_reroll",
      subcategory: "",
      chance: 0.05,
      value: 4,
    };
    const merged = mergeRawBaitEffects([star, star, star]);
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe(12);
    // 0.05 * 3 = 0.15
    expect(merged[0].chance).toBeCloseTo(0.15, 5);
  });

  it("caps the summed chance at 100%", () => {
    const e = { type: "cobblemon:ha_chance", subcategory: "", chance: 0.6, value: 1 };
    const merged = mergeRawBaitEffects([e, e]);
    expect(merged[0].chance).toBe(1);
  });

  it("rounds the summed value UP (ceil)", () => {
    const a = { type: "cobblemon:bite_time", subcategory: "", chance: 1, value: 0.3 };
    const b = { type: "cobblemon:bite_time", subcategory: "", chance: 1, value: 0.5 };
    const merged = mergeRawBaitEffects([a, b]);
    // 0.3 + 0.5 = 0.8 → ceil = 1
    expect(merged[0].value).toBe(1);
  });

  it("groups by (type, subcategory) — different subcategories stay separate", () => {
    const ivAtk = { type: "cobblemon:iv", subcategory: "cobblemon:atk", chance: 1, value: 5 };
    const ivDef = { type: "cobblemon:iv", subcategory: "cobblemon:def", chance: 1, value: 5 };
    const merged = mergeRawBaitEffects([ivAtk, ivAtk, ivDef]);
    expect(merged).toHaveLength(2);
    const atk = merged.find((m) => m.subcategory === "cobblemon:atk");
    const def = merged.find((m) => m.subcategory === "cobblemon:def");
    expect(atk?.value).toBe(10);
    expect(def?.value).toBe(5);
  });

  it("preserves first-seen order of distinct groups", () => {
    const merged = mergeRawBaitEffects([
      { type: "b", subcategory: "", chance: 1, value: 1 },
      { type: "a", subcategory: "", chance: 1, value: 1 },
      { type: "b", subcategory: "", chance: 1, value: 1 },
    ]);
    expect(merged.map((m) => m.type)).toEqual(["b", "a"]);
  });

  it("defaults missing chance/value to 0", () => {
    const merged = mergeRawBaitEffects([{ type: "x", subcategory: "" }]);
    expect(merged[0].chance).toBe(0);
    expect(merged[0].value).toBe(0);
  });

  it("returns an empty list for no effects", () => {
    expect(mergeRawBaitEffects([])).toEqual([]);
  });
});
