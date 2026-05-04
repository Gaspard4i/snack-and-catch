/**
 * Sprite cascade — pokesprite Gen 8 → Pokémon Showdown → PokeAPI.
 *
 * Cobblemon's variant labels follow its own form-aspect grammar; the
 * rest of the Pokémon community (pokesprite, Showdown, PokeAPI) uses
 * shorter, well-known slugs. This module maps Cobblemon labels onto
 * those slugs so the cascade actually resolves.
 *
 * The mapping is rule-driven (suffix-stripping, regional rewrites)
 * with explicit overrides where the rule is ambiguous (e.g. Tauros'
 * `paldean` is the combat breed; Wooper's `paldean` is just Paldea).
 *
 * For the small set of forms that no public sprite source serves by
 * slug, `POKEAPI_EXTENDED_IDS` provides the numeric id PokeAPI uses
 * so we can still reach the official sprite via URL.
 *
 * Base species:
 *   1. pokesprite Gen 8     → 2. Showdown dex →
 *   3. PokeAPI sprite by dex → 4. PokeAPI official-artwork by dex →
 *   silhouette badge (rendered by <PokemonSprite />).
 *
 * Variant:
 *   1. pokesprite Gen 8 by variant slug →
 *   2. Showdown dex by variant slug →
 *   3. PokeAPI sprite by extended id (when known) →
 *   silhouette badge. We never fall back to the base species' sprite —
 *   Vulpix-Alolan should not look like Vulpix.
 */
const REGIONAL_REWRITES: Record<string, string> = {
  alolan: "alola",
  galarian: "galar",
  hisuian: "hisui",
  paldean: "paldea",
};

/**
 * Cobblemon-baseSlug → community-baseSlug. Cobblemon stores
 * `farfetch-d` (apostrophe-derived dash); the rest of the world uses
 * `farfetchd`. Same family for sirfetch'd / mr-mime / mime-jr / mr-rime.
 */
const BASE_SLUG_ALIASES: Record<string, string> = {
  "farfetch-d": "farfetchd",
  "sirfetch-d": "sirfetchd",
};

/**
 * (baseSlug, variantLabel) → fully overridden variant segment.
 * Used when the rule-driven simplifier picks the wrong slug for a
 * specific species (e.g. Tauros' `paldean` is the combat breed; Wooper's
 * `paldean` is just Paldea).
 */
const VARIANT_OVERRIDES: Record<string, { showdown?: string; pokesprite?: string }> = {
  "tauros|paldean": { showdown: "paldea-combat", pokesprite: "paldea-combat-breed" },
  "tauros|blaze-breed": { showdown: "paldea-blaze", pokesprite: "paldea-blaze-breed" },
  "tauros|aqua-breed": { showdown: "paldea-aqua", pokesprite: "paldea-aqua-breed" },
  "maushold|maushold-family-four": { showdown: "four", pokesprite: "family-of-four" },
  "maushold|maushold-family-three": { showdown: "three", pokesprite: "family-of-three" },
  // Cobblemon-only labels for which a sprite exists under a different
  // canonical name in the community sources.
  "greninja|bond": { showdown: "ash", pokesprite: "ash" },
  "magearna|original-color": { showdown: "original", pokesprite: "original" },
  "kyurem|black-fusion": { showdown: "black", pokesprite: "black" },
  "kyurem|white-fusion": { showdown: "white", pokesprite: "white" },
  "necrozma|dusk-fusion": { showdown: "dusk", pokesprite: "dusk" },
  "necrozma|dawn-fusion": { showdown: "dawn", pokesprite: "dawn" },
  "necrozma|ultra-fusion": { showdown: "ultra", pokesprite: "ultra" },
  // Florges/Floette/Flabébé colours — `flower-X` → `X`.
  "flabebe|flower-blue": { showdown: "blue", pokesprite: "blue" },
  "flabebe|flower-orange": { showdown: "orange", pokesprite: "orange" },
  "flabebe|flower-yellow": { showdown: "yellow", pokesprite: "yellow" },
  "flabebe|flower-white": { showdown: "white", pokesprite: "white" },
  "flabebe|flower-eternal": { showdown: "eternal", pokesprite: "eternal" },
  "floette|flower-blue": { showdown: "blue", pokesprite: "blue" },
  "floette|flower-orange": { showdown: "orange", pokesprite: "orange" },
  "floette|flower-yellow": { showdown: "yellow", pokesprite: "yellow" },
  "floette|flower-white": { showdown: "white", pokesprite: "white" },
  "floette|flower-eternal": { showdown: "eternal", pokesprite: "eternal" },
  "florges|flower-blue": { showdown: "blue", pokesprite: "blue" },
  "florges|flower-orange": { showdown: "orange", pokesprite: "orange" },
  "florges|flower-yellow": { showdown: "yellow", pokesprite: "yellow" },
  "florges|flower-white": { showdown: "white", pokesprite: "white" },
  // Pumpkaboo / Gourgeist size labels.
  "pumpkaboo|pumpkin-size-small": { showdown: "small", pokesprite: "small" },
  "pumpkaboo|pumpkin-size-large": { showdown: "large", pokesprite: "large" },
  "pumpkaboo|pumpkin-size-super": { showdown: "super", pokesprite: "super" },
  "gourgeist|pumpkin-size-small": { showdown: "small", pokesprite: "small" },
  "gourgeist|pumpkin-size-large": { showdown: "large", pokesprite: "large" },
  "gourgeist|pumpkin-size-super": { showdown: "super", pokesprite: "super" },
  // Tatsugiri texture labels.
  "tatsugiri|tatsugiri-texture-droopy": { showdown: "droopy", pokesprite: "droopy" },
  "tatsugiri|tatsugiri-texture-stretchy": { showdown: "stretchy", pokesprite: "stretchy" },
  // Squawkabilly colour labels.
  "squawkabilly|squawkabilly-color-blue": { showdown: "blue", pokesprite: "blue" },
  "squawkabilly|squawkabilly-color-yellow": { showdown: "yellow", pokesprite: "yellow" },
  "squawkabilly|squawkabilly-color-gray": { showdown: "white", pokesprite: "white" },
  // Female-aspect species — Showdown spells them `-f`, pokesprite `-female`.
  "meowstic|female": { showdown: "f", pokesprite: "female" },
  "indeedee|female": { showdown: "f", pokesprite: "female" },
  "basculegion|female": { showdown: "f", pokesprite: "female" },
  "oinkologne|female": { showdown: "f", pokesprite: "female" },
  // Pikachu cosplay-like alternative captures.
  "pikachu|original-cap": { showdown: "original", pokesprite: "original" },
  // Eiscue noice.
  "eiscue|noice_face": { showdown: "noice", pokesprite: "noice" },
  // Zygarde forms. The 50% form is the published default; both pokesprite
  // and Showdown serve it under the bare `zygarde` slug, so we drop the
  // segment entirely (an empty string would still produce `zygarde-`).
  "zygarde|10-percent": { showdown: "10", pokesprite: "10" },
  "zygarde|50-percent": { showdown: "", pokesprite: "" },
  "zygarde|power-construct": { showdown: "complete", pokesprite: "complete" },
  // Urshifu single-strike is the default, rapid-strike is a separate form
  // that pokesprite/Showdown both spell `urshifu-rapidstrikegmax` etc.;
  // the base sprite is enough for our compact pixel display.
  "urshifu|rapid_strike-style": { showdown: "rapidstrike", pokesprite: "rapidstrike" },
  // Toxtricity forms — Showdown serves the amped form as the default;
  // the low-key form lives at `toxtricity-lowkey`.
  "toxtricity|low_key-form": { showdown: "lowkey", pokesprite: "lowkey" },
  // Sinistea / Polteageist / Sinistcha / Poltchageist — only the base
  // sprite is available; antique / counterfeit aspects render as base.
  "sinistea|antique": { showdown: "", pokesprite: "" },
  "polteageist|antique": { showdown: "", pokesprite: "" },
  "poltchageist|counterfeit": { showdown: "", pokesprite: "" },
  "sinistcha|counterfeit": { showdown: "", pokesprite: "" },
  // Dudunsparce three-segment form is published by Showdown only as the
  // species base; pokesprite has the variant.
  "dudunsparce|three-segment-form": { showdown: "", pokesprite: "three-segment" },
  // Terapagos forms — Showdown only serves the base sprite.
  "terapagos|terastal-form": { showdown: "", pokesprite: "" },
  "terapagos|stellar-form": { showdown: "", pokesprite: "" },
  // Ogerpon embody is a default-color variant; the masked forms have
  // their own slug.
  "ogerpon|embody-aspect": { showdown: "", pokesprite: "" },
  // Appletun has no real Gmax sprite anywhere; render as base.
  "appletun|gmax": { showdown: "", pokesprite: "" },
  // Flabébé/Floette/Florges also accept their flower colour passed alone
  // (already covered above).
  // Tauros / Maushold already above. Generic mega_x/_y rewrites are
  // handled by underscore→dash normalisation, so they don't need
  // overrides.
};

/**
 * Variant labels that no public sprite source carries — they're
 * Cobblemon-only flavour. Returning `null` from the segment helper
 * forces the cascade to silhouette directly instead of fetching 404s.
 */
const SILHOUETTE_ONLY = new Set<string>([
  // The "region bias" aspects exist only inside Cobblemon's spawn
  // probabilities; they are not separate species and have no sprite.
  // Examples: pikachu-region-bias-alola, oshawott-region-bias-hisui.
  "region-bias-alola",
  "region-bias-galar",
  "region-bias-hisui",
  "region-bias-paldea",
  "region-bias-kanto",
  "region-bias-johto",
  "region-bias-hoenn",
  "region-bias-sinnoh",
  "region-bias-unova",
  "region-bias-kalos",
]);

/**
 * (baseSlug, label) entries the public sources do not carry under any
 * known slug. Listed here to skip the cascade and render the silhouette
 * straight away (avoids 5 wasted HTTP HEADs per card).
 */
const SILHOUETTE_KEY_PAIRS = new Set<string>([
  // Cobblemon-only Furfrou trims (`-trim` suffix); the sprite repos only
  // ship the canon Gen 6 trims (heart, star, diamond, debutante, …) which
  // already pass through the suffix-stripper.
  "furfrou|cinnamon-trim",
  "furfrou|crusader-trim",
  "furfrou|lavender-trim",
  "furfrou|matcha-trim",
  "furfrou|mourner-trim",
  "furfrou|rocker-trim",
  // Rockruff has no in-game `dusk` form — Cobblemon stages the Lycanroc
  // dusk evolution as a Rockruff aspect, but no sprite source matches it.
  "rockruff|dusk-form",
  // Mime Jr. galarian region-bias — Cobblemon-only
  "mime-jr|region-bias-galar",
]);

/**
 * Suffixes Cobblemon adds that the rest of the community drops. Order
 * matters: the longest suffix wins (`-cloak` before `-clo`). Each
 * suffix is matched with a leading dash so it's always a full segment.
 */
const COBBLEMON_SUFFIX_PATTERN =
  /-(forme|form|cloak|drive|plate|memory|fusion|appliance|mode|style|trim|mask|cape|face|breed|sea)$/;

/**
 * Cobblemon (baseSlug, variantLabel) → PokeAPI extended species id.
 * Used to reach the official sprite by URL when neither pokesprite nor
 * Showdown carries the variant. Add entries as we discover gaps.
 */
const POKEAPI_EXTENDED_IDS: Record<string, number> = {
  "tauros|paldean": 10250,
  "tauros|blaze-breed": 10251,
  "tauros|aqua-breed": 10252,
  "farfetch-d|galarian": 10166,
  "maushold|maushold-family-three": 10257,
  // Urshifu rapid-strike — pokesprite/Showdown don't carry it under a
  // straightforward slug; PokeAPI does at id 10191.
  "urshifu|rapid_strike-style": 10191,
  // Dudunsparce three-segment — extended id from PokeAPI.
  "dudunsparce|three-segment-form": 10255,
  // Ogerpon masked forms.
  "ogerpon|wellspring-mask": 10273,
  "ogerpon|hearthflame-mask": 10274,
  "ogerpon|cornerstone-mask": 10275,
  // Terapagos forms — pokesprite/Showdown stop at the base.
  "terapagos|terastal-form": 10276,
  "terapagos|stellar-form": 10277,
  // Apple gigantamax forms.
  "appletun|gmax": 10217,
  "flapple|gmax": 10216,
};

function normaliseLabel(label: string): string {
  // Underscore to dash; drop apostrophes (typographic and ASCII) so
  // `pa'u-style` becomes `pau-style`. Lowercase. Trim outer dashes.
  return label
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/['']/g, "")
    .replace(/^-|-$/g, "");
}

function applyRegionalRewrite(seg: string, target: "showdown" | "pokesprite"): string {
  // pokesprite uses the short forms (alola/galar/hisui/paldea); Showdown
  // keeps the regional `-n` ending except for `paldean` which is also
  // shortened.
  if (target === "pokesprite") {
    return seg.replace(/^([a-z]+)/, (m) => REGIONAL_REWRITES[m] ?? m);
  }
  return seg.replace(/^paldean/, "paldea");
}

function variantSegment(
  baseSlug: string,
  rawLabel: string,
  target: "showdown" | "pokesprite",
): string | null {
  const label = normaliseLabel(rawLabel);
  if (SILHOUETTE_ONLY.has(label)) return null;
  if (SILHOUETTE_KEY_PAIRS.has(`${baseSlug}|${label}`)) return null;

  // 1. Explicit override per (base, label). May map to "" to reach the
  //    base species sprite (e.g. Zygarde 50% renders as plain `zygarde`).
  const override = VARIANT_OVERRIDES[`${baseSlug}|${label}`];
  if (override) return override[target] ?? label;

  // 2. Unown's per-letter aspect: Cobblemon stores `character-x`,
  //    Showdown / pokesprite use `unown-x`. The `!` and `?` glyphs map
  //    to `exclamation` / `question` in both repos.
  if (baseSlug === "unown" && label.startsWith("character-")) {
    const ch = label.slice("character-".length);
    if (ch === "!") return "exclamation";
    if (ch === "?") return "question";
    return ch;
  }

  // 3. Alcremie cream/swirl labels — Cobblemon stores only the cream
  //    flavour (`cream-ruby`); the public sprites need the sweet
  //    appended (`alcremie-ruby-cream-strawberry` is the published
  //    default sweet on pokesprite). For Showdown there is no per-cream
  //    sprite, so map to "" and render the base Alcremie sprite.
  if (baseSlug === "alcremie" && label.startsWith("cream-")) {
    const flavour = label.slice("cream-".length);
    if (target === "pokesprite") {
      // `caramel_swirl`, `ruby_swirl`, `rainbow_swirl` map to
      // `<flavour>-swirl-strawberry`; pure `<flavour>` maps to
      // `<flavour>-cream-strawberry`.
      const isSwirl = flavour.endsWith("-swirl");
      return isSwirl
        ? `${flavour}-strawberry`
        : `${flavour}-cream-strawberry`;
    }
    return "";
  }

  // 4. Strip a known Cobblemon trailing suffix (`-form`, `-mode`, `-plate`, …).
  let simplified = label.replace(COBBLEMON_SUFFIX_PATTERN, "");
  // Some labels are ALL suffix (e.g. `dusk-form` -> `dusk`); some are
  // multi-segment with the suffix in the middle (`flower-eternal`,
  // already handled by overrides). The remaining shape is the segment
  // we want.
  simplified = simplified || label;
  // 5. Regional family rewrite for the leading word.
  return applyRegionalRewrite(simplified, target);
}

function basenameSlug(name: string, baseSlug?: string | null): string {
  const raw = baseSlug
    ? baseSlug
    : name
        .toLowerCase()
        .replace(/\s*\(.*\)\s*$/, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
  return BASE_SLUG_ALIASES[raw] ?? raw;
}

export function showdownSlug(opts: {
  name: string;
  baseSlug?: string | null;
  variantLabel?: string | null;
}): string {
  const base = basenameSlug(opts.name, opts.baseSlug ?? undefined);
  if (!opts.variantLabel) return base;
  const seg = variantSegment(opts.baseSlug ?? base, opts.variantLabel, "showdown");
  if (seg === null) return base;
  return seg ? `${base}-${seg}` : base;
}

export function pokespriteSlug(opts: {
  name: string;
  baseSlug?: string | null;
  variantLabel?: string | null;
}): string {
  const base = basenameSlug(opts.name, opts.baseSlug ?? undefined);
  if (!opts.variantLabel) return base;
  const seg = variantSegment(opts.baseSlug ?? base, opts.variantLabel, "pokesprite");
  if (seg === null) return base;
  return seg ? `${base}-${seg}` : base;
}

export function pokeApiVariantId(opts: {
  baseSlug?: string | null;
  variantLabel?: string | null;
}): number | undefined {
  if (!opts.baseSlug || !opts.variantLabel) return undefined;
  return POKEAPI_EXTENDED_IDS[`${opts.baseSlug}|${opts.variantLabel}`];
}

/**
 * Returns true when the Cobblemon variant has no public sprite anywhere
 * (region-bias and similar Cobblemon-only aspects). The component uses
 * this to skip every network attempt and render the silhouette badge
 * directly.
 */
export function isSilhouetteOnly(opts: {
  baseSlug?: string | null;
  variantLabel?: string | null;
}): boolean {
  if (!opts.variantLabel) return false;
  const label = normaliseLabel(opts.variantLabel);
  if (SILHOUETTE_ONLY.has(label)) return true;
  if (opts.baseSlug && SILHOUETTE_KEY_PAIRS.has(`${opts.baseSlug}|${label}`)) {
    return true;
  }
  return false;
}

export function spriteCandidates(opts: {
  dexNo: number;
  name: string;
  baseSlug?: string | null;
  variantLabel?: string | null;
  shiny?: boolean;
}): string[] {
  if (isSilhouetteOnly({ baseSlug: opts.baseSlug, variantLabel: opts.variantLabel })) return [];

  const sd = showdownSlug(opts);
  const ps = pokespriteSlug(opts);
  const shinyDex = opts.shiny ? "dex-shiny" : "dex";
  const shinyPokesprite = opts.shiny ? "shiny" : "regular";
  const shinyPokeApi = opts.shiny ? "shiny/" : "";
  const isVariant = !!opts.variantLabel;
  const out: string[] = [];

  // 1. pokesprite Gen 8 spritesheet — variant-aware by slug.
  out.push(
    `https://raw.githubusercontent.com/msikma/pokesprite/master/pokemon-gen8/${shinyPokesprite}/${ps}.png`,
  );

  // 2. Pokémon Showdown variant-aware pixel sprite.
  out.push(`https://play.pokemonshowdown.com/sprites/${shinyDex}/${sd}.png`);

  if (isVariant) {
    // 3. PokeAPI by extended id (when we have a mapping for the
    //    variant). Some Gen 9 forms are only reachable this way.
    const variantId = pokeApiVariantId(opts);
    if (variantId !== undefined) {
      out.push(
        `https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/${shinyPokeApi}${variantId}.png`,
      );
    }
    return out;
  }

  // 3. PokeAPI dex-number sprite for the base species.
  out.push(
    `https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/${shinyPokeApi}${opts.dexNo}.png`,
  );

  // 4. PokeAPI official artwork — high-res last resort.
  out.push(
    `https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/${opts.dexNo}.png`,
  );

  return out;
}
