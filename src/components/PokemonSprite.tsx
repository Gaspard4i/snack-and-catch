"use client";

import { useMemo, useState } from "react";
import { spriteCandidates } from "@/lib/sprites/pokemon-sprite";

/**
 * Variant-aware Pokémon sprite. Cascades through:
 *   cobblemon.tools (3D portrait) → Showdown → pokesprite Gen 8 →
 *   PokeAPI dex sprite (base species only) → official artwork (base
 *   species only) → silhouette badge.
 *
 * cobblemon.tools serves a 96×96 transparent placeholder (HTTP 200) for
 * Pokémon they haven't pre-rendered yet (e.g. Togepi). The real renders
 * are 256×256, so we treat anything smaller from that origin as a miss
 * and advance the cascade.
 *
 * The sprite is a plain <img>, not next/image, because variant
 * sprites change frequently and Next's optimizer is overkill for
 * 60-pixel art assets — keeping it simple avoids the
 * `remotePatterns` config + the deopt of `unoptimized`.
 */
export function PokemonSprite({
  dexNo,
  name,
  baseSlug,
  variantLabel,
  size = 64,
  shiny = false,
  className = "",
}: {
  dexNo: number;
  name: string;
  /** Base species slug — used to build the Showdown URL. */
  baseSlug?: string | null;
  variantLabel?: string | null;
  size?: number;
  shiny?: boolean;
  className?: string;
}) {
  const candidates = useMemo(
    () => spriteCandidates({ dexNo, name, baseSlug, variantLabel, shiny }),
    [dexNo, name, baseSlug, variantLabel, shiny],
  );
  const [idx, setIdx] = useState(0);
  const exhausted = idx >= candidates.length;

  if (exhausted) {
    return (
      <span
        title={name}
        aria-label={name}
        className={`inline-flex items-center justify-center rounded-full bg-subtle border border-border font-mono text-[10px] text-muted shrink-0 ${className}`}
        style={{ width: size, height: size }}
      >
        {String(dexNo).padStart(4, "0")}
      </span>
    );
  }

  const currentUrl = candidates[idx];
  const isCobblemon = currentUrl.includes("cobblemon.tools");
  // Cobblemon portraits are anti-aliased 3D renders — applying the
  // `.pixel` class would crisp-edge them into something ugly. Only
  // pixel-art sources (Showdown / pokesprite / PokeAPI) wear it.
  const isPixelArt = !isCobblemon;

  return (
    <img
      key={currentUrl}
      src={currentUrl}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setIdx((i) => i + 1)}
      onLoad={(e) => {
        // cobblemon.tools 200s with a 96×96 transparent placeholder
        // for missing Pokémon; the real renders are 256×256. Anything
        // smaller from that origin is a miss → advance the cascade.
        if (!isCobblemon) return;
        const img = e.currentTarget;
        if (img.naturalWidth < 200 || img.naturalHeight < 200) {
          setIdx((i) => i + 1);
        }
      }}
      className={`inline-block object-contain shrink-0 ${
        isPixelArt ? "pixel" : ""
      } ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
