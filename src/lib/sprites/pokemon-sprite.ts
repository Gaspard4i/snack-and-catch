/**
 * Sprite cascade for every Pokémon — base or variant.
 *
 * For a **base species**:
 *   1. cobblemon.tools (3D portrait) → 2. Showdown dex →
 *   3. pokesprite Gen 8 → 4. PokeAPI dex sprite →
 *   5. PokeAPI official-artwork → silhouette badge.
 *
 * For a **variant** (alolan / galarian / hisuian / paldean / mega / gmax / …):
 *   1. cobblemon.tools variant URL (when Cobblemon ships that variant) →
 *   2. Showdown dex with the variant slug →
 *   3. pokesprite by variant slug (Gen 8 spritesheet covers most variants) →
 *      silhouette badge.
 *
 *   We DO NOT fall back to the base species sprite for variants — a
 *   variant that has no sprite anywhere should show the silhouette
 *   so the user doesn't think Vulpix-Alolan looks like Vulpix.
 */
const REGIONAL_REWRITES: Record<string, string> = {
  alolan: "alola",
  galarian: "galar",
  hisuian: "hisui",
  paldean: "paldea",
};

function variantSegment(variantLabel: string, target: "cobblemon" | "showdown" | "pokesprite"): string {
  const v = variantLabel.toLowerCase().replace(/_/g, "-").replace(/^-|-$/g, "");
  if (target === "cobblemon" || target === "pokesprite") {
    // cobblemon.tools and pokesprite both spell regional families with
    // the short form (`alola`, `galar`, `hisui`, `paldea`).
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

export function cobblemonToolsSlug(opts: {
  name: string;
  baseSlug?: string | null;
  variantLabel?: string | null;
}): string {
  const base = basenameSlug(opts.name, opts.baseSlug ?? undefined);
  if (!opts.variantLabel) return base;
  return `${base}-${variantSegment(opts.variantLabel, "cobblemon")}`;
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
  const cobble = cobblemonToolsSlug(opts);
  const sd = showdownSlug(opts);
  const ps = pokespriteSlug(opts);
  const shinyDex = opts.shiny ? "dex-shiny" : "dex";
  const shinyPokesprite = opts.shiny ? "shiny" : "regular";
  const shinyPokeApi = opts.shiny ? "shiny/" : "";
  const isVariant = !!opts.variantLabel;
  const out: string[] = [];

  // 1. Cobblemon-rendered portrait of the exact form.
  out.push(`https://cobblemon.tools/pokedex/pokemon/${cobble}/sprite.png`);

  // 2. Pokemon Showdown variant-aware pixel sprite.
  out.push(`https://play.pokemonshowdown.com/sprites/${shinyDex}/${sd}.png`);

  // 3. pokesprite Gen 8 spritesheet (msikma/pokesprite, public). Covers
  //    every Gen 1-8 form including mega/gmax/regional and most Gen 9.
  out.push(
    `https://raw.githubusercontent.com/msikma/pokesprite/master/pokemon-gen8/${shinyPokesprite}/${ps}.png`,
  );

  // For variants we stop here — falling back to the base species would
  // be visually misleading (Vulpix-Alolan would render as Vulpix). The
  // <PokemonSprite /> component renders a silhouette badge instead.
  if (isVariant) return out;

  // 4. PokeAPI dex-number fallback for the base species.
  out.push(
    `https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/${shinyPokeApi}${opts.dexNo}.png`,
  );

  // 5. PokeAPI official artwork — last network attempt.
  out.push(
    `https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/${opts.dexNo}.png`,
  );

  return out;
}
