/**
 * Sprite cascade — PokeAPI / Showdown box sprites only. The Cobblemon
 * 3D portraits look ugly stretched to small sizes, so we stick to the
 * pixel-art family that everyone in the Pokémon community uses.
 *
 * Base species:
 *   1. pokesprite Gen 8 (msikma/pokesprite, public)        →
 *   2. Pokémon Showdown dex                                 →
 *   3. PokeAPI sprite by dex number                         →
 *   4. PokeAPI official-artwork by dex number               →
 *   5. silhouette badge (rendered by <PokemonSprite />).
 *
 * Variant (alolan / galarian / hisuian / paldean / mega / gmax / …):
 *   1. pokesprite Gen 8 by variant slug                     →
 *   2. Showdown dex by variant slug                         →
 *   3. silhouette badge.
 *
 *   We do NOT fall back to the base species' sprite for a variant —
 *   that would render Vulpix for Vulpix-Alolan, which is misleading.
 */
const REGIONAL_REWRITES: Record<string, string> = {
  alolan: "alola",
  galarian: "galar",
  hisuian: "hisui",
  paldean: "paldea",
};

function variantSegment(variantLabel: string, target: "showdown" | "pokesprite"): string {
  const v = variantLabel.toLowerCase().replace(/_/g, "-").replace(/^-|-$/g, "");
  if (target === "pokesprite") {
    // pokesprite spells regional families with the short form
    // (`alola`, `galar`, `hisui`, `paldea`).
    return v.replace(/^([a-z]+)/, (m) => REGIONAL_REWRITES[m] ?? m);
  }
  // Showdown keeps the `-n` ending we already have in the DB
  // (`vulpix-alolan`) but spells `paldean` as `paldea`.
  return v.replace(/^paldean/, "paldea");
}

function basenameSlug(name: string, baseSlug?: string | null): string {
  if (baseSlug) return baseSlug;
  return name
    .toLowerCase()
    .replace(/\s*\(.*\)\s*$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function showdownSlug(opts: {
  name: string;
  baseSlug?: string | null;
  variantLabel?: string | null;
}): string {
  const base = basenameSlug(opts.name, opts.baseSlug ?? undefined);
  if (!opts.variantLabel) return base;
  return `${base}-${variantSegment(opts.variantLabel, "showdown")}`;
}

export function pokespriteSlug(opts: {
  name: string;
  baseSlug?: string | null;
  variantLabel?: string | null;
}): string {
  const base = basenameSlug(opts.name, opts.baseSlug ?? undefined);
  if (!opts.variantLabel) return base;
  return `${base}-${variantSegment(opts.variantLabel, "pokesprite")}`;
}

export function spriteCandidates(opts: {
  dexNo: number;
  name: string;
  baseSlug?: string | null;
  variantLabel?: string | null;
  shiny?: boolean;
}): string[] {
  const sd = showdownSlug(opts);
  const ps = pokespriteSlug(opts);
  const shinyDex = opts.shiny ? "dex-shiny" : "dex";
  const shinyPokesprite = opts.shiny ? "shiny" : "regular";
  const shinyPokeApi = opts.shiny ? "shiny/" : "";
  const isVariant = !!opts.variantLabel;
  const out: string[] = [];

  // 1. pokesprite Gen 8 spritesheet — variant-aware by slug, covers
  //    every Gen 1-8 form including mega / gmax / regional and most
  //    Gen 9 names.
  out.push(
    `https://raw.githubusercontent.com/msikma/pokesprite/master/pokemon-gen8/${shinyPokesprite}/${ps}.png`,
  );

  // 2. Pokémon Showdown variant-aware pixel sprite (good Gen 9
  //    coverage where pokesprite hasn't caught up yet).
  out.push(`https://play.pokemonshowdown.com/sprites/${shinyDex}/${sd}.png`);

  // For variants we stop here — falling back to a dex-number sprite
  // would render the base species, which is visually misleading.
  if (isVariant) return out;

  // 3. PokeAPI dex-number fallback for the base species.
  out.push(
    `https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/${shinyPokeApi}${opts.dexNo}.png`,
  );

  // 4. PokeAPI official artwork — high-resolution last resort before
  //    the silhouette badge.
  out.push(
    `https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/${opts.dexNo}.png`,
  );

  return out;
}
