/**
 * Pure formatter for bait seasoning effects.
 *
 * Cobblemon stores effects as JSON objects like:
 *   { "type": "cobblemon:iv", "value": 5, "chance": 1, "subcategory": "cobblemon:atk" }
 * This module turns each effect into a short English sentence close to what
 * the official wiki shows, and also exposes a computed tier tag so UIs can
 * colour them consistently.
 *
 * Source of truth: `data/cobblemon/spawn_bait_effects/**.json` in the mod +
 * the wiki page at https://wiki.cobblemon.com/index.php/Seasoning.
 */

export type RawBaitEffect = {
  type?: string;
  value?: number;
  chance?: number;
  subcategory?: string;
  [k: string]: unknown;
};

/**
 * Faithful port of Cobblemon's `SpawnBaitUtils.mergeEffects`. When several
 * bait seasonings sit in the pot, effects sharing the same (type, subcategory)
 * stack: their chances add (capped at 100%) and their values add then round
 * UP (ceil). So three Star-Piece-like berries each granting "shiny ×4" merge
 * into a single "shiny ×12" effect rather than three separate ×4 chips.
 *
 * Grouping is on the raw upstream `type`/`subcategory` strings (namespaced),
 * exactly like the mod — we don't normalise before grouping so two effects
 * only merge when the mod would merge them.
 */
export function mergeRawBaitEffects(effects: RawBaitEffect[]): RawBaitEffect[] {
  const groups = new Map<string, RawBaitEffect>();
  const order: string[] = [];
  for (const e of effects) {
    const key = `${e.type ?? ""}|${e.subcategory ?? ""}`;
    const existing = groups.get(key);
    if (existing) {
      existing.chance = (existing.chance ?? 0) + (e.chance ?? 0);
      existing.value = (existing.value ?? 0) + (e.value ?? 0);
    } else {
      groups.set(key, { ...e, chance: e.chance ?? 0, value: e.value ?? 0 });
      order.push(key);
    }
  }
  return order.map((key) => {
    const g = groups.get(key)!;
    return {
      ...g,
      chance: Math.min(1, g.chance ?? 0),
      value: Math.ceil(g.value ?? 0),
    };
  });
}

export type BaitEffectKind =
  | "bite_time"
  | "rarity_bucket"
  | "shiny_reroll"
  | "ha_chance"
  | "drops_reroll"
  | "level_raise"
  | "ev"
  | "iv"
  | "nature"
  | "egg_group"
  | "typing"
  | "gender_chance"
  | "friendship"
  | "mark_chance"
  | "unknown";

export type FormattedBaitEffect = {
  kind: BaitEffectKind;
  title: string;
  description: string;
  chance: number;
  tone: "healing" | "friendship" | "defense" | "buff" | "offense" | "utility";
  /** Raw numeric value from the bait effect (points added, multiplier, etc.). */
  value: number;
  /** Normalised subcategory (e.g. 'fire' for typing, 'spa' for nature/iv/ev,
   *  'monster' for egg_group, 'female' for gender). Empty string when n/a. */
  subcategory: string;
};

function cleanSubcategory(sc: string | undefined): string {
  if (!sc) return "";
  return sc.replace(/^cobblemon:/, "");
}

const STAT_LABEL: Record<string, string> = {
  hp: "HP",
  atk: "Attack",
  def: "Defence",
  spa: "Special Attack",
  spd: "Special Defence",
  spe: "Speed",
  speed: "Speed",
};

const EGG_GROUP_LABEL: Record<string, string> = {
  monster: "Monster",
  human_like: "Human-Like",
  water_1: "Water 1",
  water_2: "Water 2",
  water_3: "Water 3",
  bug: "Bug",
  mineral: "Mineral",
  flying: "Flying",
  amorphous: "Amorphous",
  field: "Field",
  fairy: "Fairy",
  grass: "Grass",
  dragon: "Dragon",
  ditto: "Ditto",
  undiscovered: "Undiscovered",
};

function prettyStat(sub: string): string {
  const key = cleanSubcategory(sub).toLowerCase();
  return STAT_LABEL[key] ?? key;
}

function prettyEggGroup(sub: string): string {
  const key = cleanSubcategory(sub).toLowerCase();
  return EGG_GROUP_LABEL[key] ?? key.replace(/_/g, " ");
}

function prettyType(sub: string): string {
  return cleanSubcategory(sub).toLowerCase();
}

function chancePct(chance: number | undefined): number {
  return Math.round((chance ?? 0) * 100);
}

export function formatBaitEffect(raw: RawBaitEffect): FormattedBaitEffect {
  const type = (raw.type ?? "").replace(/^cobblemon:/, "");
  const value = raw.value ?? 0;
  const chance = raw.chance ?? 0;
  const sub = raw.subcategory ?? "";
  const cleanedSub = cleanSubcategory(sub).toLowerCase();
  const base = { value, subcategory: cleanedSub };

  switch (type) {
    case "bite_time": {
      const pct = Math.round(value * 100);
      return {
        kind: "bite_time",
        title: `Bite Time −${pct}%`,
        description: `Reduces bite time by ${pct}%.`,
        chance,
        tone: "utility",
        ...base,
      };
    }
    case "rarity_bucket": {
      return {
        kind: "rarity_bucket",
        title: `Rarity +${value} tier${value > 1 ? "s" : ""}`,
        description: `Boosts rarity bucket by ${value} tier(s).`,
        chance,
        tone: "buff",
        ...base,
      };
    }
    case "shiny_reroll": {
      const v = value || 1;
      return {
        kind: "shiny_reroll",
        title: `Shiny ×${v}`,
        description: `Increases shiny chance by ${v}×.`,
        chance,
        tone: "buff",
        ...base,
      };
    }
    case "ha_chance": {
      return {
        kind: "ha_chance",
        title: "Hidden Ability",
        description: "Attracts Cobblemon with their hidden ability.",
        chance,
        tone: "buff",
        ...base,
      };
    }
    case "drops_reroll": {
      return {
        kind: "drops_reroll",
        title: `Drops reroll ×${value || 1}`,
        description: "Rerolls drops once.",
        chance,
        tone: "utility",
        ...base,
      };
    }
    case "level_raise": {
      return {
        kind: "level_raise",
        title: `Level +${value}`,
        description: `Boosts lured Cobblemon level by ${value}.`,
        chance,
        tone: "buff",
        ...base,
      };
    }
    case "ev": {
      const stat = prettyStat(sub);
      return {
        kind: "ev",
        title: `${stat} EV yield`,
        description: `Attracts Cobblemon with ${stat} EV yield.`,
        chance,
        tone: "offense",
        ...base,
      };
    }
    case "iv": {
      const stat = prettyStat(sub);
      return {
        kind: "iv",
        title: `${stat} IV +${value}`,
        description: `Boosts lured Cobblemon ${stat} IV by ${value}.`,
        chance,
        tone: "offense",
        ...base,
      };
    }
    case "nature": {
      const stat = prettyStat(sub);
      return {
        kind: "nature",
        title: `${stat}-nature`,
        description: `Attracts Cobblemon with ${stat}-boosting natures.`,
        chance,
        tone: "offense",
        ...base,
      };
    }
    case "egg_group": {
      const eg = prettyEggGroup(sub);
      return {
        kind: "egg_group",
        title: `${eg} egg group ×10`,
        description: `Increases chance of ${eg} Egg Group Cobblemon by 10×.`,
        chance,
        tone: "utility",
        ...base,
      };
    }
    case "typing": {
      const t = prettyType(sub);
      return {
        kind: "typing",
        title: `${t}-type ×10`,
        description: `Increases chance of ${t}-type Cobblemon by 10×.`,
        chance,
        tone: "offense",
        ...base,
      };
    }
    case "gender_chance": {
      const which = sub.toLowerCase() === "female" ? "female" : "male";
      return {
        kind: "gender_chance",
        title: `${which} Cobblemon`,
        description: `Attracts ${which} Cobblemon.`,
        chance,
        tone: "utility",
        ...base,
      };
    }
    case "friendship": {
      return {
        kind: "friendship",
        title: `Friendship +${value}`,
        description: `Boosts lured Cobblemon's friendship by ${value}.`,
        chance,
        tone: "friendship",
        ...base,
      };
    }
    case "mark_chance": {
      return {
        kind: "mark_chance",
        title: "Mark chance",
        description: "Attracts Cobblemon with special marks.",
        chance,
        tone: "utility",
        ...base,
      };
    }
    default:
      return {
        kind: "unknown",
        title: type || "unknown",
        description: JSON.stringify(raw),
        chance,
        tone: "utility",
        ...base,
      };
  }
}

export function formatBaitEffects(effects: RawBaitEffect[]): FormattedBaitEffect[] {
  return effects.map(formatBaitEffect);
}

/**
 * IDs in the upstream `bait_seasoning` tag file. Source of truth is
 * `data/cobblemon/tags/item/recipe_filters/bait_seasoning.json` (values =
 * all of `#cobblemon:berries` plus these 7 vanilla items). Used client-side
 * to filter the pantry to bait-only when needed.
 */
export const BAIT_VANILLA_ITEMS = new Set([
  "minecraft:apple",
  "minecraft:enchanted_golden_apple",
  "minecraft:glistering_melon_slice",
  "minecraft:glow_berries",
  "minecraft:golden_apple",
  "minecraft:golden_carrot",
  "minecraft:sweet_berries",
]);
