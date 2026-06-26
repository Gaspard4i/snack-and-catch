import { describe, it, expect } from "vitest";
import {
  encodeSnackState,
  decodeSnackState,
  hasSnackState,
  EMPTY_SNACK_STATE,
  encodeJuiceState,
  decodeJuiceState,
  EMPTY_JUICE_STATE,
  type SnackShareState,
} from "@/lib/share-state";

describe("snack share state", () => {
  it("encodes nothing for the empty state", () => {
    expect(encodeSnackState(EMPTY_SNACK_STATE)).toBe("");
    expect(hasSnackState(EMPTY_SNACK_STATE)).toBe(false);
  });

  it("round-trips a full state", () => {
    const state: SnackShareState = {
      slots: ["cheri_berry", "oran_berry", "pecha_berry"],
      biomes: ["minecraft:plains", "#cobblemon:is_forest"],
      dimensions: ["minecraft:overworld"],
      contexts: ["grounded", "surface"],
      structures: ["minecraft:village"],
      sources: ["cobblemon"],
      times: ["day"],
      namespaces: ["cobblemon", "minecraft"],
      weather: "rain",
      skyExposure: "open",
      lightLevel: "bright",
      moonPhase: "full",
      minY: "0",
      maxY: "120",
      potColour: "red",
      attQuery: "char",
      attTypes: ["fire", "water"],
      attBuckets: ["common", "rare"],
      attSort: "dex",
      showShiny: true,
    };
    const decoded = decodeSnackState(encodeSnackState(state));
    expect(decoded).toEqual(state);
    expect(hasSnackState(state)).toBe(true);
  });

  it("preserves empty middle slots and trims trailing empties", () => {
    const state = { ...EMPTY_SNACK_STATE, slots: ["cheri_berry", null, "oran_berry"] };
    const qs = encodeSnackState(state);
    expect(qs).toContain("s=cheri_berry%2C%2Coran_berry");
    expect(decodeSnackState(qs).slots).toEqual(["cheri_berry", null, "oran_berry"]);

    const trailing = { ...EMPTY_SNACK_STATE, slots: ["cheri_berry", null, null] };
    expect(decodeSnackState(encodeSnackState(trailing)).slots).toEqual(["cheri_berry"]);
  });

  it("omits the default sort and falls back on an unknown one", () => {
    expect(encodeSnackState(EMPTY_SNACK_STATE)).not.toContain("asort");
    expect(decodeSnackState("asort=bogus").attSort).toBe("probability");
    expect(decodeSnackState("asort=bucket").attSort).toBe("bucket");
  });

  it("ignores unknown keys and tolerates an empty query", () => {
    expect(decodeSnackState("").slots).toEqual([]);
    expect(decodeSnackState("foo=bar&baz=1").biomes).toEqual([]);
  });

  it("accepts a URLSearchParams instance", () => {
    const sp = new URLSearchParams("shiny=1&at=fire");
    const d = decodeSnackState(sp);
    expect(d.showShiny).toBe(true);
    expect(d.attTypes).toEqual(["fire"]);
  });
});

describe("juice share state", () => {
  it("omits owned sets when the user owns everything", () => {
    const qs = encodeJuiceState(
      { ...EMPTY_JUICE_STATE, ownedBerries: ["a", "b"], ownedApricorns: ["RED"] },
      { ownsAllBerries: true, ownsAllApricorns: true },
    );
    expect(qs).not.toContain("own=");
    expect(qs).not.toContain("apr=");
  });

  it("round-trips owned sets, target and ignored stats", () => {
    const state = {
      ownedBerries: ["cheri_berry", "oran_berry"],
      ownedApricorns: ["RED", "BLUE"],
      target: { SPEED: 3, JUMP: 2 },
      ignoredStats: ["SKILL"],
    };
    const qs = encodeJuiceState(state, {
      ownsAllBerries: false,
      ownsAllApricorns: false,
    });
    const decoded = decodeJuiceState(qs);
    expect(decoded.ownedBerries).toEqual(["cheri_berry", "oran_berry"]);
    expect(decoded.ownedApricorns).toEqual(["RED", "BLUE"]);
    expect(decoded.target).toEqual({ SPEED: 3, JUMP: 2 });
    expect(decoded.ignoredStats).toEqual(["SKILL"]);
  });

  it("accepts a URLSearchParams instance", () => {
    const d = decodeJuiceState(new URLSearchParams("apr=RED&ignore=JUMP"));
    expect(d.ownedApricorns).toEqual(["RED"]);
    expect(d.ignoredStats).toEqual(["JUMP"]);
  });

  it("drops malformed or non-positive target entries", () => {
    const d = decodeJuiceState("target=SPEED:3,BAD,JUMP:0,SKILL:x,:5");
    expect(d.target).toEqual({ SPEED: 3 });
  });
});
