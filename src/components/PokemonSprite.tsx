"use client";

import { useMemo, useState } from "react";
import { spriteCandidates } from "@/lib/sprites/pokemon-sprite";

/**
 * Variant-aware Pokémon sprite. Cascades through pokesprite Gen 8 →
 * Pokémon Showdown dex → PokeAPI dex sprite → official artwork →
 * silhouette badge. Variants stop after Showdown so they never render
 * the base species' sprite.
 *
 * Plain <img>, not next/image — variant sprites change frequently and
 * Next's optimizer is overkill for 60-pixel pixel-art assets.
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
  /** Base species slug — used to build the variant URLs. */
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
  // Every cascade source is pixel art (pokesprite, Showdown, PokeAPI
  // sprites). Official-artwork is high-res so it doesn't hurt to be
  // pixelated either.
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
      className={`inline-block object-contain shrink-0 pixel ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
