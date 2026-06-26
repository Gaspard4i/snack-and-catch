"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { RotateCcw, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { Spinner, TopProgress, AttractedCardSkeleton, Skeleton } from "./Loader";
import {
  availableValues,
  type AxisFilter,
  type SpawnAxis,
} from "@/lib/recommend/spawn-axes";
import type { WorldGraph } from "@/app/api/world-graph/route";
import {
  BIOME_SECTIONS,
  biomeLabel,
  aggregateTraits,
} from "@/lib/recommend/biome-sections";
import { ItemIcon } from "./ItemIcon";
import { PokemonSprite } from "./PokemonSprite";
import { TypePair } from "./TypeBadge";
import { Snack3D, type BerryPlacement } from "./Snack3D";
import { NameRecipeModal } from "./NameRecipeModal";
import { SeasoningPickerSheet } from "./SeasoningPickerSheet";
import { MultiSelect, type MultiSelectOption } from "./MultiSelect";
import { SnackEffectsSummary } from "./SnackEffectsSummary";
import { ShareRecipeButton } from "./ShareRecipeButton";
import {
  encodeSnackState,
  decodeSnackState,
  type SnackShareState,
  type SnackSort,
} from "@/lib/share-state";
import type { FormattedBaitEffect } from "@/lib/recommend/bait-effects";

type BaitEffect = FormattedBaitEffect;

type Seasoning = {
  slug: string;
  itemId: string;
  kind: "berry" | "other";
  snackValid: boolean;
  category: string;
  colour: string | null;
  flavours: Record<string, number>;
  dominantFlavour: string | null;
  description: string | null;
  effectTags: string[];
  baitEffects: BaitEffect[];
  fruitModel?: string | null;
  fruitTexture?: string | null;
  snackPositionings?: Array<{
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
  }>;
};

const EFFECT_TONE_STYLES: Record<BaitEffect["tone"], string> = {
  healing: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  friendship: "bg-pink-500/15 text-pink-700 dark:text-pink-300",
  defense: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  buff: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  offense: "bg-red-500/15 text-red-700 dark:text-red-300",
  utility: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
};

/**
 * Cobblemon pot colour variants. In-game the pot tint is cosmetic, but the
 * cooked item inherits the pale FoodColourComponent palette, so we reuse
 * those pastel hex values here for a plausible-looking cake override.
 */
const POT_COLOURS = [
  { slug: null, label: "Default", hex: "#c9b89e" },
  { slug: "white", label: "White", hex: "#ffffff" },
  { slug: "black", label: "Black", hex: "#555555" },
  { slug: "red", label: "Red", hex: "#ffafd7" },
  { slug: "blue", label: "Blue", hex: "#78a5ff" },
  { slug: "green", label: "Green", hex: "#afffb4" },
  { slug: "pink", label: "Pink", hex: "#e1a0ff" },
  { slug: "yellow", label: "Yellow", hex: "#ffe1af" },
] as const;

type AttractedEntry = {
  slug: string;
  name: string;
  dexNo: number;
  primaryType: string;
  secondaryType: string | null;
  variantLabel?: string | null;
  bucket: "common" | "uncommon" | "rare" | "ultra-rare";
  weight: number;
  adjustedWeight: number;
  probability: number;
  reasons: string[];
  levelMin: number;
  levelMax: number;
  /**
   * Spawn rule fingerprint for the entry that won the dedup pass. Used
   * by the card to surface "needs structure X" / "moon phase 0" /
   * "raining only" so a player doesn't waste a snack expecting
   * Charcadet in the open Overworld when it actually only spawns next
   * to a ruined portal.
   */
  context: string | null;
  biomes: string[];
  condition: Record<string, unknown> | null;
  anticondition: Record<string, unknown> | null;
  presets: string[];
};

/**
 * Compact spawn-rule summary shown on each Attracted card. We only emit
 * what's likely to surprise the player given their current filters: a
 * structure requirement, a weather/time/moon constraint, a light-level
 * range, an anticondition. The full payload still lives on the species
 * Cobbledex page; this is just the "you can't catch Charcadet by
 * standing in a plain Overworld field" hint.
 */
function summarizeSpawnRules(p: AttractedEntry): {
  structures: string[];
  prettyId: (s: string) => string;
  badges: { kind: "warn" | "info"; text: string }[];
} {
  const prettyId = (s: string) =>
    s.replace(/^#?[a-z0-9_]+:/, "").replace(/^is_/, "").replace(/_/g, " ");
  const cond = p.condition ?? {};
  const anti = p.anticondition ?? {};
  const badges: { kind: "warn" | "info"; text: string }[] = [];
  const structures = (cond as { structures?: unknown }).structures;
  const structList = Array.isArray(structures) ? (structures as string[]) : [];
  // Structure constraints are the #1 thing people miss — flag them
  // loud (Charcadet only spawns next to ruined portals etc).
  if (structList.length > 0) {
    badges.push({
      kind: "warn",
      text: `Near ${structList.map(prettyId).slice(0, 2).join(" / ")}${structList.length > 2 ? "…" : ""}`,
    });
  }
  if ((cond as { isRaining?: unknown }).isRaining === true) {
    badges.push({ kind: "info", text: "Rain only" });
  }
  if ((cond as { isThundering?: unknown }).isThundering === true) {
    badges.push({ kind: "info", text: "Thunder only" });
  }
  const tr = (cond as { timeRange?: unknown }).timeRange;
  if (typeof tr === "string" && tr !== "any") {
    badges.push({ kind: "info", text: tr.charAt(0).toUpperCase() + tr.slice(1) });
  }
  const moon = (cond as { moonPhase?: unknown }).moonPhase;
  if (moon !== undefined) {
    const phase =
      typeof moon === "number" ? moon : Number.parseInt(String(moon), 10);
    if (Number.isFinite(phase)) {
      const labels = [
        "full moon",
        "waning gibbous",
        "last quarter",
        "waning crescent",
        "new moon",
        "waxing crescent",
        "first quarter",
        "waxing gibbous",
      ];
      badges.push({ kind: "info", text: labels[phase] ?? `moon ${phase}` });
    }
  }
  if ((cond as { canSeeSky?: unknown }).canSeeSky === true) {
    badges.push({ kind: "info", text: "Open sky" });
  } else if ((cond as { canSeeSky?: unknown }).canSeeSky === false) {
    badges.push({ kind: "info", text: "Covered" });
  }
  const minL = (cond as { minLight?: unknown }).minLight;
  const maxL = (cond as { maxLight?: unknown }).maxLight;
  if (typeof minL === "number" || typeof maxL === "number") {
    badges.push({
      kind: "info",
      text: `Light ${typeof minL === "number" ? minL : 0}–${
        typeof maxL === "number" ? maxL : 15
      }`,
    });
  }
  // Anticondition surfaces are usually subtle ("not in village"), but
  // worth a footnote so the player knows the constraint exists.
  const antiBiomes = (anti as { biomes?: unknown }).biomes;
  if (Array.isArray(antiBiomes) && antiBiomes.length > 0) {
    badges.push({
      kind: "warn",
      text: `Not in ${(antiBiomes as string[]).map(prettyId).slice(0, 2).join(" / ")}`,
    });
  }
  const antiStructs = (anti as { structures?: unknown }).structures;
  if (Array.isArray(antiStructs) && antiStructs.length > 0) {
    badges.push({
      kind: "warn",
      text: `Not near ${(antiStructs as string[]).map(prettyId).slice(0, 2).join(" / ")}`,
    });
  }
  return { structures: structList, prettyId, badges };
}

/** Pretty group label shown in the multi-select dropdown per namespace. */
const NS_LABEL: Record<string, string> = {
  cobblemon: "Cobblemon tags",
  minecraft: "Minecraft vanilla",
  terralith: "Terralith",
  biomesoplenty: "Biomes O' Plenty",
  byg: "Oh The Biomes You'll Go",
  aether: "The Aether",
  incendium: "Incendium",
  nullscape: "Nullscape",
  the_bumblezone: "The Bumblezone",
};

const TIME_OPTIONS: MultiSelectOption[] = [
  { value: "day", label: "Day" },
  { value: "night", label: "Night" },
  { value: "morning", label: "Morning" },
  { value: "noon", label: "Noon" },
  { value: "dusk", label: "Dusk" },
];

/**
 * Cobblemon spawn conditions evaluate `isRaining` / `isThundering`
 * booleans. We expose three mutually exclusive choices the user can
 * pick from; "any" is the default and means we don't constrain weather.
 */
const WEATHER_OPTIONS: MultiSelectOption[] = [
  { value: "clear", label: "Clear" },
  { value: "rain", label: "Rain" },
  { value: "thunder", label: "Thunder" },
];

/**
 * Spawnable position contexts. Bait recommendations always force water
 * contexts client-side, but the snack maker exposes the full set so the
 * user can simulate where the snack/bait will be placed.
 */
const CONTEXT_OPTIONS: MultiSelectOption[] = [
  { value: "grounded", label: "On the ground" },
  { value: "surface", label: "Water/lava surface" },
  { value: "submerged", label: "Underwater" },
  { value: "seafloor", label: "Sea floor" },
  { value: "lavafloor", label: "Lava floor" },
];

/**
 * Combined sky-light + canSeeSky question, mapped onto the underlying
 * filter fields when sent to the API. "Any" (no selection) keeps the
 * spawn list untouched.
 */
const SKY_EXPOSURE_OPTIONS: MultiSelectOption[] = [
  { value: "open", label: "Open sky" },
  { value: "covered", label: "Covered (no sky)" },
  { value: "cave", label: "Cave / underground" },
];

/**
 * Vanilla moon phase ids match Cobblemon's `moonPhase` condition (0–7).
 * 0 is full moon, 4 is new moon — mirrors Minecraft's MoonPhase enum.
 */
const MOON_PHASE_OPTIONS: MultiSelectOption[] = [
  { value: "0", label: "Full moon" },
  { value: "1", label: "Waning gibbous" },
  { value: "2", label: "Last quarter" },
  { value: "3", label: "Waning crescent" },
  { value: "4", label: "New moon" },
  { value: "5", label: "Waxing crescent" },
  { value: "6", label: "First quarter" },
  { value: "7", label: "Waxing gibbous" },
];

const DIMENSION_OPTIONS: MultiSelectOption[] = [
  { value: "minecraft:overworld", label: "Overworld" },
  { value: "minecraft:the_nether", label: "Nether" },
  { value: "minecraft:the_end", label: "End" },
];

const TYPE_OPTIONS: MultiSelectOption[] = [
  "normal", "fire", "water", "electric", "grass", "ice", "fighting",
  "poison", "ground", "flying", "psychic", "bug", "rock", "ghost",
  "dragon", "dark", "steel", "fairy",
].map((t) => ({ value: t, label: t }));

const BUCKET_OPTIONS: MultiSelectOption[] = [
  { value: "common", label: "Common" },
  { value: "uncommon", label: "Uncommon" },
  { value: "rare", label: "Rare" },
  { value: "ultra-rare", label: "Ultra-rare" },
];

/**
 * Locked-in namespaces — Cobblemon and Minecraft vanilla are always
 * part of the snack maker's view. They cannot be removed by the user.
 */
const LOCKED_NAMESPACES = ["cobblemon", "minecraft"] as const;

const NAMESPACE_OPTIONS: MultiSelectOption[] = [
  { value: "cobblemon", label: "Cobblemon (tags)", group: "Default" },
  { value: "minecraft", label: "Minecraft vanilla", group: "Default" },
  { value: "terralith", label: "Terralith", group: "Mods" },
  { value: "biomesoplenty", label: "Biomes O' Plenty", group: "Mods" },
  { value: "byg", label: "Oh The Biomes You'll Go", group: "Mods" },
  { value: "aether", label: "The Aether", group: "Mods" },
  { value: "incendium", label: "Incendium", group: "Mods" },
  { value: "nullscape", label: "Nullscape", group: "Mods" },
  { value: "the_bumblezone", label: "The Bumblezone", group: "Mods" },
];

const FLAVOURS = ["SWEET", "SPICY", "DRY", "BITTER", "SOUR"] as const;
const KINDS = ["all", "berry", "vanilla"] as const;

/** Query keys the share-state owns, used to detect a shareable URL. */
const SHARE_KEYS = new Set([
  "s", "biome", "dim", "ctx", "struct", "src", "time", "ns", "weather",
  "sky", "light", "moon", "minY", "maxY", "pot", "aq", "at", "ab", "asort",
  "shiny",
]);

const FLAVOUR_COLORS: Record<string, string> = {
  SWEET: "#f8b3d7",
  SPICY: "#e85a3a",
  DRY: "#7fb3d5",
  BITTER: "#735a8a",
  SOUR: "#f4d35e",
};

type SlotState = [Seasoning | null, Seasoning | null, Seasoning | null];

type BiomeApiEntry = { value: string; label: string; namespace: string };

/**
 * Poké Snack base recipe preview (3x3 grid of required non-seasoning
 * ingredients). Extracted so the snack page can mount it in the top-right
 * of the hero header, next to the title, rather than inside the cooking pot
 * column. Alternates between Cobblemon moomoo milk and vanilla milk buckets
 * on an interval to make the preview a little more lively.
 */
export function SnackBaseRecipe({ size = 48 }: { size?: number }) {
  const t = useTranslations("snack");
  const [useVanillaMilk, setUseVanillaMilk] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => setUseVanillaMilk((v) => !v), 2500);
    return () => window.clearInterval(id);
  }, []);
  const milkId = useVanillaMilk ? "minecraft:milk_bucket" : "cobblemon:moomoo_milk";
  const ids = [
    milkId,
    milkId,
    milkId,
    "minecraft:honey_bottle",
    "cobblemon:vivichoke",
    "minecraft:honey_bottle",
    "cobblemon:hearty_grains",
    "cobblemon:hearty_grains",
    "cobblemon:hearty_grains",
  ];
  return (
    <div className="inline-flex flex-col items-center gap-1">
      <div className="grid grid-cols-3 gap-1 p-2 rounded-lg bg-subtle border border-border">
        {ids.map((id, i) => (
          <div
            key={i}
            className="rounded bg-card border border-border flex items-center justify-center"
            style={{ width: size, height: size }}
            title={id}
          >
            <ItemIcon id={id} size={Math.round(size * 0.7)} />
          </div>
        ))}
      </div>
      <div className="text-[10px] text-muted uppercase">{t("baseRecipe")}</div>
    </div>
  );
}

export type PotMode = "snack" | "bait";

export function CampfirePot({ mode = "snack" }: { mode?: PotMode } = {}) {
  const t = useTranslations("snack");
  const tc = useTranslations("common");
  const isBait = mode === "bait";
  const [seasonings, setSeasonings] = useState<Seasoning[]>([]);
  const [slots, setSlots] = useState<SlotState>([null, null, null]);
  const [biomes, setBiomes] = useState<string[]>([]);
  const [biomeCatalog, setBiomeCatalog] = useState<BiomeApiEntry[]>([]);
  const [allowedNamespaces, setAllowedNamespaces] = useState<string[]>([
    "cobblemon",
    "minecraft",
  ]);
  const [times, setTimes] = useState<string[]>([]);
  const [minY, setMinY] = useState<string>("");
  const [maxY, setMaxY] = useState<string>("");
  const [sourcesCatalog, setSourcesCatalog] = useState<string[]>([]);
  /**
   * Spawn-pool sources selected by the user. We DEFAULT to ["cobblemon"]
   * so first-time visitors only see vanilla mod spawns — the dropdown
   * lets them opt in to addons. An empty array still means "all sources"
   * downstream, but the UI never starts there.
   */
  const [sources, setSources] = useState<string[]>(["cobblemon"]);
  // Extended Cobblemon spawn conditions (see audit §3).
  const [weather, setWeather] = useState<string>("");
  const [contexts, setContexts] = useState<string[]>(
    isBait ? ["surface", "submerged", "seafloor"] : [],
  );
  const [skyExposure, setSkyExposure] = useState<string>("");
  const [lightLevel, setLightLevel] = useState<string>("");
  const [moonPhase, setMoonPhase] = useState<string>("");
  const [dimensions, setDimensions] = useState<string[]>([]);
  // Pinned by `condition.structures` on a spawn; only meaningful once a
  // dimension+biome are chosen (otherwise the picker fills with every
  // structure across vanilla, which is mostly useless noise).
  const [structures, setStructures] = useState<string[]>([]);
  const [attracted, setAttracted] = useState<AttractedEntry[]>([]);
  const [attractedVisible, setAttractedVisible] = useState(24);
  const attractedSentinelRef = useRef<HTMLDivElement>(null);
  const [attQuery, setAttQuery] = useState("");
  const [attTypes, setAttTypes] = useState<string[]>([]);
  const [attBuckets, setAttBuckets] = useState<string[]>([]);
  const [attSort, setAttSort] = useState<
    "probability" | "dex" | "dex_desc" | "name" | "name_desc" | "bucket"
  >("probability");
  const [showShiny, setShowShiny] = useState(false);
  const [snackBaitEffects, setSnackBaitEffects] = useState<BaitEffect[]>([]);
  const [potColour, setPotColour] = useState<typeof POT_COLOURS[number]>(POT_COLOURS[0]);
  const [loading, setLoading] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [activeFlavours, setActiveFlavours] = useState<Set<string>>(new Set());
  const [kindFilter, setKindFilter] = useState<(typeof KINDS)[number]>("all");
  // Always restrict the pantry to bait-valid seasonings — non-valid items
  // can't be placed in a snack slot anyway, so the toggle was a footgun.
  const [pantryLoading, setPantryLoading] = useState(true);
  /** Adaptive 3D snack size: ~180px on phones, 220px on desktop. */
  const [snack3DSize, setSnack3DSize] = useState(220);
  /** Mobile-only picker sheet. When open, holds the slot index the user
   *  tapped so the chosen seasoning lands in the right slot. */
  const [pickerSlotIndex, setPickerSlotIndex] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setSnack3DSize(window.innerWidth < 640 ? 180 : 220);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Compact projection of every spawn used to drive the cross-axis filter
  // cascade — picking a dimension narrows the biome list, picking a biome
  // narrows the time list, etc. Loaded once, cached on the server side.
  const [spawnAxes, setSpawnAxes] = useState<SpawnAxis[]>([]);
  // Authored mod → dimension → biome → structure graph. The cascade
  // dropdowns derive their options from this graph so picking
  // Overworld can never offer a Nether biome (the previous code derived
  // the biome list from spawn conditions, which were too sparse to
  // cover the dimension axis cleanly).
  const [worldGraph, setWorldGraph] = useState<WorldGraph | null>(null);

  useEffect(() => {
    setPantryLoading(true);
    fetch("/api/snack")
      .then((r) => r.json())
      .then((d: { seasonings: Seasoning[] }) => setSeasonings(d.seasonings ?? []))
      .catch(() => setSeasonings([]))
      .finally(() => setPantryLoading(false));
    fetch("/api/biomes")
      .then((r) => r.json())
      .then((d: { biomes: BiomeApiEntry[] }) => setBiomeCatalog(d.biomes ?? []))
      .catch(() => setBiomeCatalog([]));
    fetch("/api/sources")
      .then((r) => r.json())
      .then((d: { sources: string[] }) => setSourcesCatalog(d.sources ?? []))
      .catch(() => setSourcesCatalog([]));
    fetch("/api/spawn-axes")
      .then((r) => r.json())
      .then((d: { axes: SpawnAxis[] }) => setSpawnAxes(d.axes ?? []))
      .catch(() => setSpawnAxes([]));
    fetch("/api/world-graph")
      .then((r) => r.json())
      .then((d: WorldGraph) => setWorldGraph(d))
      .catch(() => setWorldGraph(null));
  }, []);

  // Hydrate slots from `?load=<savedId>` so the Saved-recipes page can
  // deep-link a stored snack into the maker. Runs once seasonings have
  // loaded so we can resolve slugs to full Seasoning objects.
  useEffect(() => {
    if (seasonings.length === 0) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("load");
    if (!id) return;
    import("@/lib/saved-recipes").then(({ listSavedSnacks }) => {
      const saved = listSavedSnacks().find((s) => s.id === id);
      if (!saved) return;
      const next: SlotState = [null, null, null];
      saved.seasoningSlugs.slice(0, 3).forEach((slug, i) => {
        const s = seasonings.find((x) => x.slug === slug);
        if (s) next[i] = s;
      });
      setSlots(next);
      if (saved.potColour) {
        const match = POT_COLOURS.find((c) => c.hex === saved.potColour);
        if (match) setPotColour(match);
      }
      // Clean the URL so a refresh doesn't re-trigger this.
      const url = new URL(window.location.href);
      url.searchParams.delete("load");
      window.history.replaceState({}, "", url.toString());
    });
  }, [seasonings]);

  /**
   * Hydrate the maker from a `/snack?dimension=...&biome=...&seasoning=...`
   * deep-link, used by the per-species "best zones" cards on
   * /pokemon/[slug]. Runs once the seasoning catalog is loaded so we can
   * resolve slug → Seasoning. The URL is then stripped so a refresh
   * doesn't re-apply (mirrors the `?load=` flow above).
   *
   * Wrapped in `requestAnimationFrame` to push the slot/biome/dim updates
   * past the first <Canvas> mount of <Snack3D>: setting all three
   * synchronously inside the effect body races with R3F's pointer-event
   * connect path, which throws `target is null` if the canvas DOM ref
   * isn't attached yet (events-760a1017 line 16170). Deferring one
   * frame lets the canvas attach before the cascade of re-renders.
   */
  useEffect(() => {
    if (seasonings.length === 0) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const dimParam = params.get("dimension");
    const biomeParam = params.get("biome");
    const seasoningParams = params.getAll("seasoning");
    if (!dimParam && !biomeParam && seasoningParams.length === 0) return;

    const apply = () => {
      if (dimParam) setDimensions([dimParam]);
      if (biomeParam) {
        // Cobblemon biome tags (`cobblemon:is_*`, `cobblemon:nether/is_*`)
        // live in the catalog with a leading `#`; vanilla biomes
        // (`minecraft:plains`) do not. Normalise based on the namespace.
        const stripped = biomeParam.replace(/^#/, "");
        const isTag = stripped.startsWith("cobblemon:");
        setBiomes([isTag ? `#${stripped}` : stripped]);
      }
      if (seasoningParams.length > 0) {
        const next: SlotState = [null, null, null];
        seasoningParams.slice(0, 3).forEach((slug, i) => {
          const s = seasonings.find((x) => x.slug === slug);
          if (s) next[i] = s;
        });
        setSlots(next);
      }

      const url = new URL(window.location.href);
      url.searchParams.delete("dimension");
      url.searchParams.delete("biome");
      url.searchParams.delete("seasoning");
      window.history.replaceState({}, "", url.toString());
    };

    const handle = window.requestAnimationFrame(apply);
    return () => window.cancelAnimationFrame(handle);
  }, [seasonings]);

  /**
   * Shareable state ⇄ URL. The whole maker config (slots + every filter)
   * is mirrored into the query string so a copied link reproduces the
   * exact screen. We hydrate once on mount (after the seasoning catalog
   * loads, so slugs resolve to objects), then keep the URL in sync on
   * every change. `hydratedRef` gates the sync effect so it never writes
   * a stale empty URL before hydration ran.
   */
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    if (seasonings.length === 0) return;
    if (typeof window === "undefined") return;
    hydratedRef.current = true;
    const sp = new URLSearchParams(window.location.search);
    // Nothing to hydrate if no shareable key is present (the deep-link
    // effects above own `load`/`dimension`/`biome`/`seasoning`).
    if (!sp.get("s") && ![...sp.keys()].some((k) => SHARE_KEYS.has(k))) return;
    const st = decodeSnackState(sp);

    const apply = () => {
      const next: SlotState = [null, null, null];
      st.slots.slice(0, 3).forEach((slug, i) => {
        if (!slug) return;
        const s = seasonings.find((x) => x.slug === slug);
        if (s) next[i] = s;
      });
      if (st.slots.length > 0) setSlots(next);
      if (st.biomes.length) setBiomes(st.biomes);
      if (st.dimensions.length) setDimensions(st.dimensions);
      if (st.contexts.length) setContexts(st.contexts);
      if (st.structures.length) setStructures(st.structures);
      if (st.sources.length) setSources(st.sources);
      if (st.times.length) setTimes(st.times);
      if (st.namespaces.length) setAllowedNamespaces(st.namespaces);
      if (st.weather) setWeather(st.weather);
      if (st.skyExposure) setSkyExposure(st.skyExposure);
      if (st.lightLevel) setLightLevel(st.lightLevel);
      if (st.moonPhase) setMoonPhase(st.moonPhase);
      if (st.minY) setMinY(st.minY);
      if (st.maxY) setMaxY(st.maxY);
      if (st.potColour) {
        const match = POT_COLOURS.find((c) => c.slug === st.potColour);
        if (match) setPotColour(match);
      }
      if (st.attQuery) setAttQuery(st.attQuery);
      if (st.attTypes.length) setAttTypes(st.attTypes);
      if (st.attBuckets.length) setAttBuckets(st.attBuckets);
      if (st.attSort !== "probability") setAttSort(st.attSort);
      if (st.showShiny) setShowShiny(true);
    };
    // Defer one frame like the other hydration effects — setting slots and
    // filters synchronously races R3F's canvas connect path.
    const handle = window.requestAnimationFrame(apply);
    return () => window.cancelAnimationFrame(handle);
  }, [seasonings]);

  // Reset the maker back to its initial state — empty slots, default pot,
  // and cleared filters (keeping the bait-mode context defaults). The URL
  // sync effect then strips the query string automatically.
  const canReset =
    slots.some((s) => s !== null) ||
    biomes.length > 0 ||
    dimensions.length > 0 ||
    structures.length > 0 ||
    times.length > 0 ||
    weather !== "" ||
    skyExposure !== "" ||
    lightLevel !== "" ||
    moonPhase !== "" ||
    minY !== "" ||
    maxY !== "" ||
    potColour.slug !== null ||
    attQuery !== "" ||
    attTypes.length > 0 ||
    attBuckets.length > 0 ||
    attSort !== "probability" ||
    showShiny ||
    (isBait
      ? false
      : contexts.length > 0);

  const resetSnack = () => {
    setSlots([null, null, null]);
    setBiomes([]);
    setDimensions([]);
    setStructures([]);
    setTimes([]);
    setContexts(isBait ? ["surface", "submerged", "seafloor"] : []);
    setSources(["cobblemon"]);
    setAllowedNamespaces(["cobblemon", "minecraft"]);
    setWeather("");
    setSkyExposure("");
    setLightLevel("");
    setMoonPhase("");
    setMinY("");
    setMaxY("");
    setPotColour(POT_COLOURS[0]);
    setAttQuery("");
    setAttTypes([]);
    setAttBuckets([]);
    setAttSort("probability");
    setShowShiny(false);
    setActiveFlavours(new Set());
    setKindFilter("all");
    setFilterQuery("");
  };

  // Current shareable state, derived from the live UI state.
  const shareState = useMemo<SnackShareState>(
    () => ({
      slots: slots.map((s) => s?.slug ?? null),
      biomes,
      dimensions,
      contexts,
      structures,
      sources,
      times,
      namespaces: allowedNamespaces,
      weather,
      skyExposure,
      lightLevel,
      moonPhase,
      minY,
      maxY,
      potColour: potColour.slug,
      attQuery,
      attTypes,
      attBuckets,
      attSort: attSort as SnackSort,
      showShiny,
    }),
    [
      slots, biomes, dimensions, contexts, structures, sources, times,
      allowedNamespaces, weather, skyExposure, lightLevel, moonPhase, minY,
      maxY, potColour, attQuery, attTypes, attBuckets, attSort, showShiny,
    ],
  );

  // Keep the URL in sync with the live state (after hydration). We rewrite
  // with replaceState so back-button history isn't flooded while the user
  // tweaks filters.
  const shareQuery = useMemo(() => encodeSnackState(shareState), [shareState]);
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.search.replace(/^\?/, "") === shareQuery) return;
    url.search = shareQuery;
    window.history.replaceState({}, "", url.toString());
  }, [shareQuery]);

  /**
   * The cross-axis filter that all dropdowns share. We assemble it from
   * every UI state so each axis can ask "given the OTHER selections,
   * what values are still reachable?".
   */
  const axisFilter = useMemo<AxisFilter>(() => {
    let canSeeSkyValue: boolean | undefined;
    if (skyExposure === "open") canSeeSkyValue = true;
    else if (skyExposure === "covered" || skyExposure === "cave")
      canSeeSkyValue = false;
    void canSeeSkyValue; // surfaced through the `skyExposure` axis directly

    return {
      sources: sources.length > 0 ? sources : undefined,
      contexts: contexts.length > 0 ? contexts : undefined,
      biomes: biomes.length > 0 ? biomes : undefined,
      dimensions: dimensions.length > 0 ? dimensions : undefined,
      structures: structures.length > 0 ? structures : undefined,
      timeRanges: times.length > 0 ? times : undefined,
      weather: weather ? (weather as "clear" | "rain" | "thunder") : undefined,
      moonPhase: moonPhase ? Number.parseInt(moonPhase, 10) : undefined,
      skyExposure: skyExposure
        ? (skyExposure as "open" | "covered" | "cave")
        : undefined,
      lightLevel: lightLevel ? Number.parseInt(lightLevel, 10) : undefined,
      namespaces: allowedNamespaces.length > 0 ? allowedNamespaces : undefined,
    };
  }, [
    sources,
    contexts,
    biomes,
    dimensions,
    structures,
    times,
    weather,
    moonPhase,
    skyExposure,
    lightLevel,
    allowedNamespaces,
  ]);

  /**
   * Dimensional traits (day/night, weather, moon, sky) for the
   * dimensions the player has currently picked. With nothing picked we
   * return the optimistic "everything is plausible" set so first-load
   * controls don't all grey out at once. The CampfirePot then blocks
   * the controls themselves when the trait is `false`.
   */
  const dimTraits = useMemo(() => {
    if (!worldGraph) return aggregateTraits(dimensions);
    if (dimensions.length === 0) {
      return { hasDayCycle: true, hasWeather: true, hasMoon: true, hasSky: true };
    }
    // Every picked dimension that's known to the world graph
    // contributes its traits; unknowns optimistically claim everything
    // (so a future mod that adds its own dimension keeps the controls
    // visible).
    const out = { hasDayCycle: false, hasWeather: false, hasMoon: false, hasSky: false };
    let unknownAny = false;
    for (const id of dimensions) {
      const row = worldGraph.dimensions.find((d) => d.id === id);
      if (!row) {
        unknownAny = true;
        continue;
      }
      out.hasDayCycle ||= row.hasDayCycle;
      out.hasWeather ||= row.hasWeather;
      out.hasMoon ||= row.hasMoon;
      out.hasSky ||= row.hasSky;
    }
    if (unknownAny) {
      return { hasDayCycle: true, hasWeather: true, hasMoon: true, hasSky: true };
    }
    return out;
  }, [dimensions, worldGraph]);

  // Snap stale state when the player switches to a dimension that
  // doesn't support a given axis (Nether: no time / weather / moon /
  // sky). Otherwise the API still receives "rain" and silently filters
  // every spawn out.
  useEffect(() => {
    if (!dimTraits.hasDayCycle && times.length > 0) setTimes([]);
    if (!dimTraits.hasWeather && weather !== "") setWeather("");
    if (!dimTraits.hasMoon && moonPhase !== "") setMoonPhase("");
    if (!dimTraits.hasSky && skyExposure !== "") setSkyExposure("");
  }, [dimTraits, times.length, weather, moonPhase, skyExposure]);

  // Drop the structure picks when the dimension or biome changes — a
  // village picked under Overworld must not survive a switch to the
  // Nether (where it doesn't exist).
  useEffect(() => {
    setStructures([]);
  }, [dimensions, biomes]);

  // Compute the still-reachable values per axis once, from the shared
  // axes payload. Each call ignores the axis being computed so the
  // control never greys ITS OWN value out.
  const reachable = useMemo(() => {
    if (spawnAxes.length === 0) return null;
    return {
      biomes: availableValues(spawnAxes, axisFilter, "biomes"),
      namespaces: availableValues(spawnAxes, axisFilter, "namespaces"),
      dimensions: availableValues(spawnAxes, axisFilter, "dimensions"),
      contexts: availableValues(spawnAxes, axisFilter, "contexts"),
      structures: availableValues(spawnAxes, axisFilter, "structures"),
      timeRanges: availableValues(spawnAxes, axisFilter, "timeRanges"),
      weather: availableValues(spawnAxes, axisFilter, "weather"),
      moonPhase: availableValues(spawnAxes, axisFilter, "moonPhase"),
      skyExposure: availableValues(spawnAxes, axisFilter, "skyExposure"),
      sources: availableValues(spawnAxes, axisFilter, "sources"),
    };
  }, [spawnAxes, axisFilter]);

  /**
   * Biome options driven by the world graph.
   *
   *   - When the graph is loaded AND a dimension is picked, we only
   *     surface biomes mapped to one of those dimensions. That kills
   *     the leak the user spotted: Overworld + Nether tags showing up
   *     side by side.
   *   - When the graph isn't loaded yet (first render before the
   *     /api/world-graph fetch resolves), we fall back to the curated
   *     sections so the picker isn't empty.
   *   - Mods toggle still applies on top: a biome whose namespace
   *     isn't in `allowedNamespaces` stays hidden.
   *   - The cross-axis `reachable` set narrows it further when other
   *     filters are active.
   */
  const biomeOptions = useMemo<MultiSelectOption[]>(() => {
    const allowed = new Set(allowedNamespaces);
    const reach = reachable?.biomes;
    const dimSet = new Set(dimensions);
    const seen = new Set<string>();
    const out: MultiSelectOption[] = [];
    const sectionLabel = (raw: string | null) => raw ?? "Other";
    const matchNamespace = (id: string) => {
      const stripped = id.replace(/^#/, "");
      const ns = stripped.includes(":") ? stripped.split(":", 1)[0] : "";
      return !ns || allowed.has(ns);
    };
    const reachable_ok = (id: string) =>
      !reach || reach.has(id.replace(/^#/, ""));

    if (worldGraph) {
      for (const b of worldGraph.biomeTags) {
        // Transverse tags (`has_*`, `evolution/*`, `space/*`) carry a
        // null dimensionId — they're parked in the Advanced panel and
        // never bubble up here.
        if (!b.dimensionId) continue;
        // Empty dimSet = "all dimensions selected by default", so we
        // show every dimensional tag. With at least one pick, narrow
        // to those.
        if (dimSet.size > 0 && !dimSet.has(b.dimensionId)) continue;
        if (!matchNamespace(b.id)) continue;
        if (!reachable_ok(b.id)) continue;
        if (seen.has(b.id)) continue;
        seen.add(b.id);
        // Keep the upstream id verbatim as the label so power-users
        // can grep the data files. Strip the leading `#` only so the
        // chips don't read "##cobblemon:…" when copied.
        out.push({
          value: b.id,
          label: b.id.replace(/^#/, ""),
          description: b.label,
          group: sectionLabel(b.section),
        });
      }
      return out;
    }

    // Fallback path: graph not loaded yet, or no dimension picked.
    // We still respect a picked dimension via the section's curated
    // `dimension` field — a section with `dimension: null` only
    // surfaces when the player hasn't pinned a dimension. That's what
    // keeps the search box from offering Aether biomes while the
    // Nether is the dimension picked.
    for (const section of BIOME_SECTIONS) {
      if (
        section.dimension &&
        dimSet.size > 0 &&
        !dimSet.has(section.dimension)
      ) {
        continue;
      }
      // Cross-dimensional sections (Sky & magical, Space) only show
      // up when the player hasn't committed to a dimension yet.
      if (!section.dimension && dimSet.size > 0) continue;
      for (const tag of section.tags) {
        if (!matchNamespace(tag)) continue;
        if (!reachable_ok(tag)) continue;
        if (seen.has(tag)) continue;
        seen.add(tag);
        out.push({
          value: tag,
          label: tag.replace(/^#/, ""),
          description: biomeLabel(tag),
          group: section.title,
        });
      }
    }
    // biomeCatalog (modded biomes from the API) — only fold them in
    // when no dimension is pinned. With a dimension picked we already
    // surfaced everything the world graph maps to that dimension; any
    // modded biome we'd add here would be a guess and could leak (e.g.
    // an Aether biome under a Nether pick).
    if (dimSet.size === 0) {
      for (const b of biomeCatalog) {
        if (!allowed.has(b.namespace)) continue;
        if (reach && !reach.has(b.value.replace(/^#/, ""))) continue;
        if (seen.has(b.value)) continue;
        seen.add(b.value);
        out.push({
          value: b.value,
          label: b.value.replace(/^#/, ""),
          description: b.label,
          group: NS_LABEL[b.namespace] ?? `Modded · ${b.namespace}`,
        });
      }
    }
    return out;
  }, [biomeCatalog, allowedNamespaces, reachable, dimensions, worldGraph]);

  // Prune selected biomes that are no longer in the allowed namespace set.
  useEffect(() => {
    setBiomes((prev) =>
      prev.filter((v) =>
        allowedNamespaces.includes(
          biomeCatalog.find((b) => b.value === v)?.namespace ?? "",
        ),
      ),
    );
  }, [allowedNamespaces, biomeCatalog]);

  const filtered = useMemo(() => {
    let list = seasonings.filter((s) => s.snackValid);
    if (kindFilter !== "all") {
      list = list.filter((s) =>
        kindFilter === "berry" ? s.kind === "berry" : s.kind === "other",
      );
    }
    if (filterQuery) {
      const q = filterQuery.toLowerCase();
      list = list.filter((s) => s.slug.includes(q));
    }
    if (activeFlavours.size > 0) {
      list = list.filter(
        (s) => s.dominantFlavour && activeFlavours.has(s.dominantFlavour),
      );
    }
    return list;
  }, [seasonings, kindFilter, filterQuery, activeFlavours]);

  const grouped = useMemo(() => {
    const map = new Map<string, Seasoning[]>();
    for (const s of filtered) {
      const key = s.kind === "berry" ? "Berries" : s.category;
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [filtered]);

  const dominant = useMemo(() => {
    const agg: Record<string, number> = {};
    for (const slot of slots) {
      if (!slot) continue;
      for (const [k, v] of Object.entries(slot.flavours ?? {}))
        agg[k] = (agg[k] ?? 0) + v;
    }
    let best: string | null = null;
    let bestVal = 0;
    for (const f of FLAVOURS) {
      const v = agg[f] ?? 0;
      if (v > bestVal) {
        bestVal = v;
        best = f;
      }
    }
    return best;
  }, [slots]);

  const snackBerries = useMemo<BerryPlacement[]>(() => {
    return slots
      .filter((s): s is Seasoning => s !== null)
      .map((s) => ({
        slug: s.slug,
        itemId: s.itemId,
        colour: s.colour,
        flavours: s.flavours,
        dominantFlavour: s.dominantFlavour,
        fruitModel: s.fruitModel ?? null,
        fruitTexture: s.fruitTexture ?? null,
        snackPositionings: s.snackPositionings ?? [],
      }));
  }, [slots]);

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const seasoningSlugs = slots
          .filter((s): s is Seasoning => s !== null)
          .map((s) => s.slug);
        // Map the combined "sky exposure" UI control onto the two
        // independent Cobblemon condition fields it represents. "Open
        // sky" → canSeeSky=true (and skyLight is high so a default of
        // 15 is a reasonable guess). "Covered" → canSeeSky=false but
        // we don't pin skyLight (the player may stand under a tree).
        // "Cave" → canSeeSky=false AND skyLight=0 to match conditions
        // like `derelict` / `redstone_caves` that pin maxSkyLight=0.
        let canSeeSkyValue: boolean | undefined;
        let skyLightLevelValue: number | undefined;
        if (skyExposure === "open") canSeeSkyValue = true;
        else if (skyExposure === "covered") canSeeSkyValue = false;
        else if (skyExposure === "cave") {
          canSeeSkyValue = false;
          skyLightLevelValue = 0;
        }

        // Bait operates on a fishing rod, so only spawns whose
        // SpawningContext is water (surface / submerged / seafloor)
        // are reachable. We seed the state with that set in bait mode
        // (above) but the user can broaden it; honour their choice.
        const effectiveContexts =
          contexts.length > 0
            ? contexts
            : isBait
              ? ["surface", "submerged", "seafloor"]
              : undefined;

        const body = {
          composition: { seasoningSlugs },
          filter: {
            biomes: biomes.length > 0 ? biomes : undefined,
            timeRanges: times.length > 0 ? times : undefined,
            minY: minY ? Number.parseInt(minY, 10) : undefined,
            maxY: maxY ? Number.parseInt(maxY, 10) : undefined,
            sources: sources.length > 0 ? sources : undefined,
            contexts: effectiveContexts,
            structures: structures.length > 0 ? structures : undefined,
            weather: weather || undefined,
            canSeeSky: canSeeSkyValue,
            skyLightLevel: skyLightLevelValue,
            lightLevel: lightLevel ? Number.parseInt(lightLevel, 10) : undefined,
            moonPhase: moonPhase ? Number.parseInt(moonPhase, 10) : undefined,
            // Empty selection = all dimensions; the API treats an
            // omitted `dimensions` filter as "no constraint", which
            // matches the new UX rule (every dimension by default).
            dimensions: dimensions.length > 0 ? dimensions : undefined,
          },
        };
        const res = await fetch("/api/snack", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        const data = (await res.json()) as {
          attracted: AttractedEntry[];
          snack?: { baitEffects?: BaitEffect[] };
        };
        setAttracted(data.attracted ?? []);
        setAttractedVisible(24);
        setSnackBaitEffects(data.snack?.baitEffects ?? []);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setAttracted([]);
          setSnackBaitEffects([]);
        }
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [
    slots,
    biomes,
    times,
    minY,
    maxY,
    sources,
    isBait,
    weather,
    contexts,
    skyExposure,
    lightLevel,
    moonPhase,
    dimensions,
    structures,
  ]);


  const attractedView = useMemo(() => {
    const q = attQuery.trim().toLowerCase();
    const bucketOrder: Record<AttractedEntry["bucket"], number> = {
      "ultra-rare": 0,
      rare: 1,
      uncommon: 2,
      common: 3,
    };
    let list = attracted.filter((p) => {
      if (q) {
        const hay = `${p.name} ${p.slug} ${p.dexNo} ${String(p.dexNo).padStart(4, "0")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (attTypes.length > 0) {
        // Intersection, capped at 2 (a Cobblemon has at most 2 types).
        const own = [p.primaryType, p.secondaryType].filter(
          (t): t is string => !!t,
        );
        if (!attTypes.slice(0, 2).every((t) => own.includes(t))) return false;
      }
      if (attBuckets.length > 0 && !attBuckets.includes(p.bucket)) return false;
      return true;
    });
    const cmp: Record<typeof attSort, (a: AttractedEntry, b: AttractedEntry) => number> = {
      probability: (a, b) => b.probability - a.probability,
      dex: (a, b) => a.dexNo - b.dexNo,
      dex_desc: (a, b) => b.dexNo - a.dexNo,
      name: (a, b) => a.name.localeCompare(b.name),
      name_desc: (a, b) => b.name.localeCompare(a.name),
      bucket: (a, b) =>
        bucketOrder[a.bucket] - bucketOrder[b.bucket] || b.probability - a.probability,
    };
    list = [...list].sort(cmp[attSort]);
    return list;
  }, [attracted, attQuery, attTypes, attBuckets, attSort]);

  useEffect(() => {
    setAttractedVisible(24);
  }, [attQuery, attTypes, attBuckets, attSort]);

  /**
   * Cobblemon shiny chance = 1 / 8192 per roll. A `shiny_reroll` bait adds
   * (value) extra rolls at its own chance. P(any shiny) = 1 - ∏(1 - rollChance).
   * We accumulate over all shiny_reroll bait effects present in the pot.
   */
  const shinyMultiplier = useMemo(() => {
    let pNotShiny = 8191 / 8192; // base single roll
    for (const e of snackBaitEffects) {
      if (e.kind !== "shiny_reroll") continue;
      const rolls = Math.max(1, e.value || 1);
      const perRoll = (e.chance || 1) * (1 / 8192);
      for (let i = 0; i < rolls; i++) pNotShiny *= 1 - perRoll;
    }
    const pShiny = 1 - pNotShiny;
    return pShiny; // absolute probability per encounter
  }, [snackBaitEffects]);
  const hasShinyBoost = snackBaitEffects.some((e) => e.kind === "shiny_reroll");

  useEffect(() => {
    if (attractedVisible >= attractedView.length) return;
    const el = attractedSentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setAttractedVisible((v) => Math.min(v + 24, attractedView.length));
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [attractedVisible, attractedView.length]);

  const setSlot = (idx: number, s: Seasoning | null) => {
    const next = [...slots] as SlotState;
    next[idx] = s;
    setSlots(next);
  };

  const findEmptySlot = () => slots.findIndex((s) => s === null);

  const toggleFlavour = (f: string) =>
    setActiveFlavours((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  return (
    <div className="space-y-8">
      <TopProgress active={loading} />
    <div className="grid gap-6 sm:gap-8 lg:grid-cols-[auto_1fr]">
      <aside className="space-y-6">
        <div>
          <h3 className="text-sm font-medium uppercase tracking-wide text-muted">{t("cookingPot")}</h3>
          <div className="mt-3 flex w-full sm:inline-flex sm:w-auto flex-col items-center gap-3 p-4 rounded-xl border border-border bg-card">
            {!isBait && (
              <>
                <div className="flex items-center gap-1">
                  {POT_COLOURS.map((c) => (
                    <button
                      key={c.slug ?? "default"}
                      onClick={() => setPotColour(c)}
                      title={`${c.label} Cooking Pot`}
                      aria-label={`${c.label} Cooking Pot`}
                      className={`size-5 rounded-full border transition-transform ${
                        potColour.slug === c.slug
                          ? "border-accent scale-110 ring-2 ring-ring/30"
                          : "border-border hover:scale-105"
                      }`}
                      style={{ background: c.hex }}
                    />
                  ))}
                </div>
                <div className="text-[10px] text-muted uppercase">{t("potDefault", { name: potColour.label })}</div>
              </>
            )}

            {isBait ? (
              <BaitPreview berries={snackBerries} size={snack3DSize} />
            ) : (
              <Snack3D
                flavour={dominant}
                berries={snackBerries}
                potColour={potColour.hex}
                size={snack3DSize}
                interactive
              />
            )}
            <p
              className="text-[8px] text-muted italic text-center leading-tight"
              style={{ maxWidth: snack3DSize }}
            >
              {isBait
                ? "the in-game bait may look different."
                : "the in-game snack may look different."}
            </p>

            <div className="flex gap-2 mt-1">
              {slots.map((slot, idx) => (
                <div
                  key={idx}
                  onDragOver={(e) => {
                    // Both calls are required for the slot to be a valid
                    // drop target on Chromium and Firefox; without
                    // dropEffect the cursor stays "no-entry".
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const slug =
                      e.dataTransfer.getData("text/seasoning") ||
                      e.dataTransfer.getData("text/plain");
                    const s = seasonings.find((x) => x.slug === slug);
                    if (s && s.snackValid) setSlot(idx, s);
                  }}
                  onClick={() => {
                    // Filled → just empty the slot. Empty → on phones,
                    // open the picker sheet for THIS slot; on desktop
                    // keep the no-op (the inline pantry is the source).
                    if (slot) {
                      setSlot(idx, null);
                    } else if (window.matchMedia("(max-width: 639px)").matches) {
                      setPickerSlotIndex(idx);
                    }
                  }}
                  title={slot ? `Remove ${slot.slug}` : "Tap to pick a seasoning"}
                  className={`size-16 rounded-lg border-2 flex items-center justify-center cursor-pointer transition-colors ${
                    slot
                      ? "border-accent bg-subtle"
                      : "border-dashed border-border bg-subtle/50 hover:bg-subtle"
                  }`}
                  style={
                    slot?.colour
                      ? { boxShadow: `0 0 0 2px ${slot.colour.toLowerCase()}33 inset` }
                      : undefined
                  }
                >
                  {slot ? (
                    <ItemIcon id={slot.itemId} size={48} />
                  ) : (
                    <span className="text-[9px] text-muted uppercase">+ S{idx + 1}</span>
                  )}
                </div>
              ))}
            </div>
            <div className="text-[10px] text-muted uppercase">{t("seasoningSlotsCount", { count: 3 })}</div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <SaveSnackButton slots={slots} potColour={potColour.hex} mode={mode} />
              <button
                type="button"
                onClick={resetSnack}
                disabled={!canReset}
                aria-label={t("reset")}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-subtle transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {t("reset")}
              </button>
              <ShareRecipeButton
                title={isBait ? "Poké Bait recipe" : "Poké Snack recipe"}
                text={
                  isBait
                    ? "Check out this Poké Bait recipe on Snack & Catch."
                    : "Check out this Poké Snack recipe on Snack & Catch."
                }
                label={t("share")}
              />
            </div>
          </div>
        </div>
      </aside>

      <div className="space-y-6">
        <div className="hidden sm:block">
          <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
            {t("pantry")}
          </h3>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder={t("filterSeasonings")}
              className="w-full sm:w-52 rounded-md border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-accent"
            />
            <div className="flex gap-1">
              {KINDS.map((k) => (
                <button
                  key={k}
                  onClick={() => setKindFilter(k)}
                  className={`text-[10px] uppercase px-2 py-0.5 rounded-full border transition-colors ${
                    kindFilter === k
                      ? "bg-accent text-accent-foreground border-accent"
                      : "border-border bg-card text-muted hover:text-foreground"
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {FLAVOURS.map((f) => {
                const active = activeFlavours.has(f);
                return (
                  <button
                    key={f}
                    onClick={() => toggleFlavour(f)}
                    className={`text-[10px] uppercase px-2 py-0.5 rounded-full border transition-colors ${
                      active
                        ? "border-transparent text-foreground"
                        : "border-border bg-card text-muted hover:text-foreground"
                    }`}
                    style={
                      active
                        ? {
                            background: `${FLAVOUR_COLORS[f]}33`,
                            borderColor: FLAVOUR_COLORS[f],
                          }
                        : undefined
                    }
                  >
                    {f}
                  </button>
                );
              })}
              {activeFlavours.size > 0 && (
                <button
                  onClick={() => setActiveFlavours(new Set())}
                  className="text-[10px] uppercase px-2 py-0.5 rounded-full border border-border bg-card text-muted hover:text-foreground"
                >
                  clear
                </button>
              )}
            </div>
          </div>

          <div className="mt-3 max-h-[420px] overflow-y-auto p-2 rounded-lg border border-border bg-subtle space-y-3">
            {pantryLoading && seasonings.length === 0 ? (
              <div className="flex flex-wrap gap-2 p-2">
                {Array.from({ length: 20 }).map((_, i) => (
                  <Skeleton key={`sk-ps-${i}`} className="size-12 rounded-md" />
                ))}
              </div>
            ) : grouped.length === 0 ? (
              <p className="text-xs text-muted p-3">{t("noSeasoningMatch")}</p>
            ) : null}
            {grouped.map(([category, items]) => (
              <div key={category}>
                <div className="text-[10px] uppercase tracking-wider text-muted px-1 mb-1">
                  {category} ({items.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {items.map((s) => (
                    <SeasoningChip
                      key={s.slug}
                      seasoning={s}
                      onPick={() => {
                        if (!s.snackValid) return;
                        const idx = findEmptySlot();
                        if (idx >= 0) setSlot(idx, s);
                      }}
                      selected={slots.some((slot) => slot?.slug === s.slug)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
            {t("snackEffects")} {loading && <Spinner className="ml-2" />}
          </h3>
          <p className="mt-1 text-xs text-muted">{t("effectsHelp")}</p>
          <div className="mt-3">
            <SnackEffectsSummary effects={snackBaitEffects} />
          </div>
        </div>


        <div>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
              {t("filters")}
            </h3>
            {(biomes.length > 0 ||
              times.length > 0 ||
              minY !== "" ||
              maxY !== "" ||
              weather !== "" ||
              contexts.length > 0 ||
              skyExposure !== "" ||
              lightLevel !== "" ||
              moonPhase !== "" ||
              dimensions.length > 0 ||
              structures.length > 0) && (
              <button
                onClick={() => {
                  setBiomes([]);
                  setTimes([]);
                  setMinY("");
                  setMaxY("");
                  setWeather("");
                  setContexts(isBait ? ["surface", "submerged", "seafloor"] : []);
                  setSkyExposure("");
                  setLightLevel("");
                  setMoonPhase("");
                  setDimensions([]);
                  setStructures([]);
                }}
                className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border border-border bg-card text-muted hover:text-foreground"
              >
                {t("filtersReset")}
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">{t("filtersHelp")}</p>

          {/*
            Filter sections follow the dependency chain the user walks
            through:  Mods → Dimension → Biome → Position+Y →
            Time/Weather/Moon → Sky/Light → Sources. Each step prunes
            the next one.
          */}

          {/* 1. Mods (Cobblemon + Minecraft locked, addons opt-in) */}
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wider text-muted px-1 mb-1">
              {t("filtersMods")}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <MultiSelect
                label={t("mods")}
                options={(() => {
                  const seen = new Set<string>();
                  const out: MultiSelectOption[] = [];
                  // Authored mods from the world graph.
                  if (worldGraph) {
                    for (const m of worldGraph.mods) {
                      if (
                        !m.locked &&
                        reachable &&
                        !reachable.namespaces.has(m.id)
                      )
                        continue;
                      seen.add(m.id);
                      out.push({
                        value: m.id,
                        label: m.label,
                        group: m.locked ? "Default" : "Mods",
                        locked: m.locked,
                      });
                    }
                  }
                  // Anything else NAMESPACE_OPTIONS knows about.
                  for (const o of NAMESPACE_OPTIONS) {
                    if (seen.has(o.value)) continue;
                    if (
                      !LOCKED_NAMESPACES.includes(
                        o.value as (typeof LOCKED_NAMESPACES)[number],
                      ) &&
                      reachable &&
                      !reachable.namespaces.has(o.value)
                    )
                      continue;
                    seen.add(o.value);
                    out.push(
                      LOCKED_NAMESPACES.includes(
                        o.value as (typeof LOCKED_NAMESPACES)[number],
                      )
                        ? { ...o, locked: true }
                        : o,
                    );
                  }
                  return out;
                })()}
                value={allowedNamespaces}
                onChange={(next) => {
                  const merged = new Set(next);
                  for (const ns of LOCKED_NAMESPACES) merged.add(ns);
                  setAllowedNamespaces([...merged]);
                }}
                placeholder={t("modsAny")}
              />
            </div>
          </div>

          {/* 2. Dimension — derived from the world graph. Dimensions
              owned by a mod the player hasn't enabled are hidden. The
              vanilla three (Overworld / Nether / End) come from the
              "minecraft" mod, which is locked, so they always appear. */}
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wider text-muted px-1 mb-1">
              {t("filtersDimension")}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <MultiSelect
                label={t("dimension")}
                options={(() => {
                  if (!worldGraph) return DIMENSION_OPTIONS;
                  const allowedMods = new Set(allowedNamespaces);
                  return worldGraph.dimensions
                    .filter((d) => allowedMods.has(d.modId))
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((d) => ({ value: d.id, label: d.label }));
                })()}
                value={dimensions}
                onChange={setDimensions}
                placeholder={t("dimensionAny")}
                searchable={false}
              />
            </div>
          </div>

          {/* 3. Biome — always visible. With no dimension picked the
              biome list spans every dimension; once the player narrows
              down, the cascade trims it via biomeOptions. */}
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wider text-muted px-1 mb-1">
              {t("filtersBiome")}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <MultiSelect
                label={t("biomes")}
                options={biomeOptions}
                value={biomes}
                onChange={setBiomes}
                placeholder={t("biomesAny")}
              />
            </div>
          </div>

          {/* 3b. Nearby structure — derived from the world graph for
              the picked biomes (or, if no biome is picked, every
              structure tied to the picked dimensions). */}
          {worldGraph && (() => {
            const dimSet = new Set(dimensions);
            const biomeSet = new Set(biomes);
            // Resolve which biome tags' structures we surface. With no
            // dimension picked we accept every dimensional tag (the
            // user said "all dimensions"). With biomes pinned, only
            // those biomes' structures.
            const eligibleBiomes = new Set<string>();
            for (const b of worldGraph.biomeTags) {
              if (!b.dimensionId) continue;
              if (dimSet.size > 0 && !dimSet.has(b.dimensionId)) continue;
              if (biomeSet.size > 0 && !biomeSet.has(b.id)) continue;
              eligibleBiomes.add(b.id);
            }
            const structureMeta = new Map(
              worldGraph.structures.map((s) => [s.id, s.label]),
            );
            const seenStruct = new Set<string>();
            const opts: MultiSelectOption[] = [];
            for (const link of worldGraph.biomeTagStructures) {
              if (!eligibleBiomes.has(link.biomeTagId)) continue;
              if (seenStruct.has(link.structureId)) continue;
              const meta = structureMeta.get(link.structureId);
              if (!meta) continue;
              seenStruct.add(link.structureId);
              opts.push({
                value: link.structureId,
                label: link.structureId.replace(/^#/, ""),
                description: meta,
              });
            }
            // Also fold in structures the spawn graph reports through
            // `reachable` (handles addons that pinned structures we
            // haven't catalogued).
            if (reachable) {
              for (const s of reachable.structures) {
                if (seenStruct.has(s)) continue;
                seenStruct.add(s);
                opts.push({
                  value: s,
                  label: s.replace(/^#/, ""),
                  description: s.replace(/^[a-z0-9_]+:/, "").replace(/_/g, " "),
                });
              }
            }
            opts.sort((a, b) => a.label.localeCompare(b.label));
            if (opts.length === 0) return null;
            return (
              <div className="mt-3">
                <div className="text-[10px] uppercase tracking-wider text-muted px-1 mb-1">
                  {t("filtersStructure")}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <MultiSelect
                    label={t("structure")}
                    options={opts}
                    value={structures}
                    onChange={setStructures}
                    placeholder={t("structureAny")}
                  />
                </div>
              </div>
            );
          })()}

          {/* 4. Position + Y range — always available. */}
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wider text-muted px-1 mb-1">
              {t("filtersPosition")}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <MultiSelect
                label={t("context")}
                options={CONTEXT_OPTIONS.filter(
                  (o) => !reachable || reachable.contexts.has(o.value),
                )}
                value={contexts}
                onChange={setContexts}
                placeholder={t("contextAny")}
                searchable={false}
              />
              <label className="text-xs inline-flex items-center gap-1 text-muted">
                <span className="text-[10px] uppercase tracking-wide">{t("minY")}</span>
                <input
                  value={minY}
                  onChange={(e) => setMinY(e.target.value)}
                  inputMode="numeric"
                  placeholder="-64"
                  className="w-16 rounded-md border border-border bg-card px-2 py-1 text-sm"
                />
              </label>
              <label className="text-xs inline-flex items-center gap-1 text-muted">
                <span className="text-[10px] uppercase tracking-wide">{t("maxY")}</span>
                <input
                  value={maxY}
                  onChange={(e) => setMaxY(e.target.value)}
                  inputMode="numeric"
                  placeholder="320"
                  className="w-16 rounded-md border border-border bg-card px-2 py-1 text-sm"
                />
              </label>
            </div>
          </div>

          {/* 5. When (time / weather / moon) — only the traits the
              picked dimensions actually carry (Nether removes day
              cycle, weather, moon ; End removes them too). */}
          {(dimTraits.hasDayCycle || dimTraits.hasWeather || dimTraits.hasMoon) && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-muted px-1 mb-1">
                {t("filtersWhen")}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {dimTraits.hasDayCycle && (
                  <MultiSelect
                    label={t("time")}
                    options={TIME_OPTIONS.filter(
                      (o) => !reachable || reachable.timeRanges.has(o.value),
                    )}
                    value={times}
                    onChange={setTimes}
                    placeholder={t("timeAny")}
                    searchable={false}
                  />
                )}
                {dimTraits.hasWeather && (
                  <label className="text-xs inline-flex items-center gap-1 text-muted">
                    <span className="text-[10px] uppercase tracking-wide">{t("weather")}</span>
                    <select
                      value={weather}
                      onChange={(e) => setWeather(e.target.value)}
                      className="rounded-md border border-border bg-card px-2 py-1 text-sm outline-none focus:border-accent"
                    >
                      <option value="">{t("weatherAny")}</option>
                      {WEATHER_OPTIONS.filter(
                        (o) => !reachable || reachable.weather.has(o.value),
                      ).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {dimTraits.hasMoon && (
                  <label className="text-xs inline-flex items-center gap-1 text-muted">
                    <span className="text-[10px] uppercase tracking-wide">{t("moonPhase")}</span>
                    <select
                      value={moonPhase}
                      onChange={(e) => setMoonPhase(e.target.value)}
                      className="rounded-md border border-border bg-card px-2 py-1 text-sm outline-none focus:border-accent"
                    >
                      <option value="">{t("moonPhaseAny")}</option>
                      {MOON_PHASE_OPTIONS.filter(
                        (o) => !reachable || reachable.moonPhase.has(o.value),
                      ).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>
          )}

          {/* 6. Sky / light — always available; sky picker hides if
              the picked dimensions don't have a visible sky. */}
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wider text-muted px-1 mb-1">
              {t("filtersConditions")}
            </div>
              <div className="flex flex-wrap items-center gap-2">
                {dimTraits.hasSky && (
                  <label className="text-xs inline-flex items-center gap-1 text-muted">
                    <span className="text-[10px] uppercase tracking-wide">{t("skyExposure")}</span>
                    <select
                      value={skyExposure}
                      onChange={(e) => setSkyExposure(e.target.value)}
                      className="rounded-md border border-border bg-card px-2 py-1 text-sm outline-none focus:border-accent"
                    >
                      <option value="">{t("skyExposureAny")}</option>
                      {SKY_EXPOSURE_OPTIONS.filter(
                        (o) => !reachable || reachable.skyExposure.has(o.value),
                      ).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="text-xs inline-flex items-center gap-1 text-muted">
                  <span className="text-[10px] uppercase tracking-wide">{t("lightLevel")}</span>
                  <input
                    value={lightLevel}
                    onChange={(e) => setLightLevel(e.target.value)}
                    inputMode="numeric"
                    placeholder="0–15"
                    className="w-16 rounded-md border border-border bg-card px-2 py-1 text-sm"
                  />
                </label>
              </div>
          </div>

          {/* 7. Sources (datapacks / addons) — last because it's an
              advanced override, not part of the main flow. */}
          {sourcesCatalog.length > 1 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-muted px-1 mb-1">
                {t("filtersSources")}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <MultiSelect
                  label="Datapacks"
                  options={sourcesCatalog
                    .filter(
                      (s) =>
                        s === "cobblemon" ||
                        !reachable ||
                        reachable.sources.has(s),
                    )
                    .map((s) => ({
                      value: s,
                      label: s,
                      // The vanilla mod's own pool is the canonical
                      // source — locking it mirrors how cobblemon +
                      // minecraft sit in the Mods picker.
                      ...(s === "cobblemon" ? { locked: true } : {}),
                    }))}
                  value={sources}
                  onChange={(next) => {
                    const merged = new Set(next);
                    merged.add("cobblemon");
                    setSources([...merged]);
                  }}
                  placeholder={t("sourcesAll")}
                />
              </div>
            </div>
          )}
        </div>

      </div>
      </div>

      <div className="w-full">
        <div>
          <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
            {t("attracted")} {loading && <Spinner className="ml-2" />}
          </h3>
          <div className="mt-2 rounded-lg border border-amber-400/50 bg-amber-400/10 p-3 text-xs">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center justify-center size-5 rounded-full bg-amber-500 text-white font-bold text-[10px] shrink-0"
                aria-hidden
              >
                !
              </span>
              <div className="font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide text-[10px]">
                {t("attractedWip")}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={attQuery}
              onChange={(e) => setAttQuery(e.target.value)}
              placeholder={t("searchAttracted")}
              className="flex-1 min-w-40 rounded-md border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-accent"
            />
            <MultiSelect
              label={t("types")}
              options={TYPE_OPTIONS}
              value={attTypes}
              onChange={setAttTypes}
              placeholder={t("typesAny")}
              maxSelection={2}
            />
            <MultiSelect
              label={t("rarity")}
              options={BUCKET_OPTIONS}
              value={attBuckets}
              onChange={setAttBuckets}
              placeholder={tc("any")}
              searchable={false}
            />
            <label className="text-xs inline-flex items-center gap-1 text-muted">
              <span className="text-[10px] uppercase tracking-wide">{tc("sort")}</span>
              <select
                value={attSort}
                onChange={(e) =>
                  setAttSort(e.target.value as typeof attSort)
                }
                className="rounded-md border border-border bg-card px-2 py-1 text-xs"
              >
                <option value="probability">{t("sortProbability")}</option>
                <option value="bucket">{t("sortBucket")}</option>
                <option value="dex">{t("sortDex")}</option>
                <option value="dex_desc">{t("sortDexDesc")}</option>
                <option value="name">{t("sortName")}</option>
                <option value="name_desc">{t("sortNameDesc")}</option>
              </select>
            </label>
            <button
              onClick={() => setShowShiny((v) => !v)}
              aria-pressed={showShiny}
              className={`text-xs inline-flex items-center gap-1 px-2 py-1 rounded-md border transition-colors ${
                showShiny
                  ? "border-amber-400 bg-amber-400/10 text-amber-600 dark:text-amber-400"
                  : "border-border text-muted hover:text-foreground"
              }`}
              title={`Shiny rate: ${(shinyMultiplier * 100).toFixed(4)}% per encounter`}
            >
              <Star
                className={`h-3.5 w-3.5 ${showShiny ? "text-amber-500 fill-amber-500" : ""}`}
                aria-hidden
              />
              <span className="text-[10px] uppercase tracking-wide">{t("shiny")}</span>
            </button>
            {(attQuery || attTypes.length > 0 || attBuckets.length > 0) && (
              <button
                onClick={() => {
                  setAttQuery("");
                  setAttTypes([]);
                  setAttBuckets([]);
                }}
                className="text-xs px-2 py-1 rounded-md border border-border text-muted hover:text-foreground"
              >
                {tc("clear")}
              </button>
            )}
          </div>

          {attractedView.length === 0 ? (
            loading && attracted.length === 0 ? (
              <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 auto-rows-fr">
                {Array.from({ length: 12 }).map((_, i) => (
                  <li key={`sk-att-${i}`}>
                    <AttractedCardSkeleton />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted">{t("noAttracted")}</p>
            )
          ) : (
            <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 auto-rows-fr">
              {attractedView.slice(0, attractedVisible).map((p) => (
                <li key={p.slug} className="h-full">
                  <Link
                    href={`/pokemon/${p.slug}`}
                    className="h-full rounded-xl border border-border bg-card p-3 flex items-center gap-3 hover:border-accent/60 hover:bg-subtle transition-colors"
                  >
                    <PokemonSprite
                      dexNo={p.dexNo}
                      name={p.name}
                      variantLabel={p.variantLabel}
                      size={64}
                      shiny={showShiny}
                    />
                  <div className="min-w-0 flex-1 self-stretch flex flex-col">
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-mono text-muted">
                        #{String(p.dexNo).padStart(4, "0")}
                      </span>
                      {(() => {
                        const prob = showShiny
                          ? p.probability * shinyMultiplier
                          : p.probability;
                        const digits = prob >= 0.01 ? 2 : prob >= 0.0001 ? 4 : 6;
                        return (
                          <span
                            className={`ml-auto text-xs font-mono font-medium ${
                              showShiny ? "text-amber-600 dark:text-amber-400" : "text-accent"
                            }`}
                            title={
                              showShiny
                                ? `P(spawn) = ${(p.probability * 100).toFixed(3)}% × P(shiny) = ${(shinyMultiplier * 100).toFixed(4)}%`
                                : `base weight ${p.weight} → adjusted ${p.adjustedWeight.toFixed(1)}`
                            }
                          >
                            {(prob * 100).toFixed(digits)}%
                          </span>
                        );
                      })()}
                    </div>
                    <div className="font-semibold text-base truncate">{p.name}</div>
                    <div className="mt-1 min-w-0 max-w-full overflow-hidden">
                      <TypePair primary={p.primaryType} secondary={p.secondaryType} size={18} />
                    </div>
                    <div className="text-[11px] text-muted uppercase mt-1">
                      {p.bucket}
                    </div>
                    {p.reasons.length > 0 && (
                      <div
                        className="text-[10px] text-accent/80 truncate mt-0.5"
                        title={p.reasons.join(" · ")}
                      >
                        {p.reasons.slice(0, 2).join(" · ")}
                      </div>
                    )}
                    {(() => {
                      const { badges } = summarizeSpawnRules(p);
                      if (badges.length === 0) return null;
                      return (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {badges.slice(0, 3).map((b, i) => (
                            <span
                              key={i}
                              className={`text-[10px] px-1.5 py-0.5 rounded-full leading-tight ${
                                b.kind === "warn"
                                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                                  : "bg-subtle text-muted border border-border"
                              }`}
                            >
                              {b.text}
                            </span>
                          ))}
                          {badges.length > 3 && (
                            <span
                              className="text-[10px] text-muted"
                              title={badges
                                .slice(3)
                                .map((b) => b.text)
                                .join(" · ")}
                            >
                              +{badges.length - 3}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {attractedView.length > attractedVisible && (
            <div
              ref={attractedSentinelRef}
              className="mt-3 flex items-center justify-center gap-2 text-xs text-muted py-4"
            >
              <Spinner />
              <span>{tc("remaining", { count: attractedView.length - attractedVisible })}</span>
            </div>
          )}
        </div>
      </div>
      <SeasoningPickerSheet
        open={pickerSlotIndex != null}
        onClose={() => setPickerSlotIndex(null)}
        seasonings={seasonings}
        occupiedSlugs={slots
          .filter((s): s is Seasoning => Boolean(s))
          .map((s) => s.slug)}
        onPick={(s) => {
          if (pickerSlotIndex == null) return;
          setSlot(pickerSlotIndex, s);
          setPickerSlotIndex(null);
        }}
        flavourColors={FLAVOUR_COLORS}
      />
    </div>
  );
}

function SeasoningChip({
  seasoning,
  onPick,
  selected,
}: {
  seasoning: Seasoning;
  onPick: () => void;
  selected: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [placement, setPlacement] = useState<{
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  }>({});
  const anchorRef = useRef<HTMLButtonElement>(null);
  const flavourLabel = seasoning.dominantFlavour ?? seasoning.category;
  const effectCount = seasoning.baitEffects?.length ?? 0;

  useLayoutEffect(() => {
    if (!hovered || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const tooltipW = 280;
    const tooltipH = Math.max(140, 60 + 40 * Math.max(1, effectCount));
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const flipAbove = rect.bottom + tooltipH + 8 > vh;
    let left = rect.left + rect.width / 2 - tooltipW / 2;
    if (left < 8) left = 8;
    if (left + tooltipW > vw - 8) left = vw - 8 - tooltipW;

    if (flipAbove) {
      setPlacement({ top: rect.top - tooltipH - 8, left });
    } else {
      setPlacement({ top: rect.bottom + 4, left });
    }
  }, [hovered, effectCount]);

  return (
    <>
      <button
        ref={anchorRef}
        draggable={seasoning.snackValid}
        onDragStart={(e) => {
          if (!seasoning.snackValid) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData("text/seasoning", seasoning.slug);
          e.dataTransfer.setData("text/plain", seasoning.slug);
          // Without effectAllowed the browser falls back to "none" and
          // the cursor turns into a no-entry sign over every drop zone.
          e.dataTransfer.effectAllowed = "copy";
          // Use the entire card as the drag preview instead of letting
          // the browser pick the inner <img> (which gives a tiny ghost
          // sprite and the no-drop cursor on most setups).
          if (anchorRef.current) {
            const rect = anchorRef.current.getBoundingClientRect();
            e.dataTransfer.setDragImage(
              anchorRef.current,
              rect.width / 2,
              rect.height / 2,
            );
          }
        }}
        onClick={onPick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        title={`${seasoning.slug} · ${flavourLabel}${seasoning.snackValid ? "" : " (not a bait seasoning)"}`}
        className={`size-12 rounded border transition-colors flex items-center justify-center relative ${
          selected
            ? "border-accent ring-2 ring-ring/30 bg-subtle"
            : seasoning.snackValid
              ? "border-border bg-card hover:border-accent cursor-pointer"
              : "border-border bg-card opacity-50 cursor-help"
        }`}
      >
        <ItemIcon id={seasoning.itemId} size={40} />
        {!seasoning.snackValid && (
          <span className="absolute -top-1 -right-1 size-3 rounded-full bg-muted/60 border border-border" />
        )}
        {seasoning.snackValid && effectCount > 0 && (
          <span className="absolute -top-1 -right-1 size-4 rounded-full bg-accent text-accent-foreground text-[9px] leading-4 text-center font-mono">
            {effectCount}
          </span>
        )}
      </button>
      {hovered && (
        <div
          style={{ position: "fixed", ...placement, width: 280, zIndex: 60 }}
          className="p-3 rounded-lg border border-border bg-card shadow-lg pointer-events-none"
        >
          <div className="flex items-center gap-2">
            <ItemIcon id={seasoning.itemId} size={24} />
            <div className="font-medium capitalize min-w-0 truncate">
              {seasoning.slug.replaceAll("_", " ")}
            </div>
            <span
              className="ml-auto shrink-0 text-[10px] uppercase px-1.5 py-0.5 rounded-full"
              style={{ background: `${FLAVOUR_COLORS[flavourLabel] ?? "#888"}33` }}
            >
              {flavourLabel}
            </span>
          </div>
          {seasoning.kind === "berry" &&
            Object.values(seasoning.flavours).some((v) => v > 0) && (
              <div className="mt-1 text-[10px] text-muted font-mono">
                {Object.entries(seasoning.flavours)
                  .filter(([, v]) => v > 0)
                  .map(([k, v]) => `${k.slice(0, 3)} ${v}`)
                  .join(" · ")}
              </div>
            )}
          {!seasoning.snackValid && (
            <div className="mt-1 text-[10px] uppercase text-amber-700 dark:text-amber-300">
              ✗ not a bait seasoning
            </div>
          )}
          {seasoning.snackValid && effectCount === 0 && (
            <div className="mt-1 text-[10px] uppercase text-muted">
              Bait-valid, no documented effect
            </div>
          )}
          {effectCount > 0 && (
            <ul className="mt-2 space-y-1">
              {seasoning.baitEffects.map((e, i) => (
                <li
                  key={`${e.kind}-${i}`}
                  className={`rounded px-2 py-1 text-[10px] leading-tight ${EFFECT_TONE_STYLES[e.tone]}`}
                >
                  <span className="font-medium">{e.title}</span>
                  {e.chance < 1 && (
                    <span className="ml-1 opacity-70">
                      {Math.round(e.chance * 100)}%
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {seasoning.description && effectCount === 0 && (
            <p className="mt-2 text-xs text-muted leading-snug">{seasoning.description}</p>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Tiny "Save" button + name prompt that drops the current snack composition
 * into localStorage via saveSnack(). Disabled when no slot is filled.
 */
function SaveSnackButton({
  slots,
  potColour,
  mode,
}: {
  slots: SlotState;
  potColour: string;
  mode: PotMode;
}) {
  const isBait = mode === "bait";
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const filled = slots.filter((s): s is Seasoning => Boolean(s));
  const disabled = filled.length === 0;
  const defaultName = filled
    .map((s) => s.slug.replace(/_berry$/, "").replace(/_/g, " "))
    .join(" + ");

  return (
    <div className="mt-2 flex items-center gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setModalOpen(true)}
        className="text-[10px] uppercase tracking-wide px-2 py-1 rounded border border-border hover:bg-subtle disabled:opacity-30"
      >
        {isBait ? "Save bait" : "Save snack"}
      </button>
      <Link
        href="/saved"
        className="text-[10px] uppercase tracking-wide text-muted hover:text-foreground"
      >
        My recipes
      </Link>
      {savedAt && (
        <span className="text-[10px] text-green-600">saved</span>
      )}

      <NameRecipeModal
        open={modalOpen}
        title={isBait ? "Name this bait" : "Name this snack"}
        hint="Saved locally in your browser."
        defaultValue={defaultName}
        onCancel={() => setModalOpen(false)}
        onConfirm={async (name) => {
          const { saveSnack } = await import("@/lib/saved-recipes");
          saveSnack({
            name,
            seasoningSlugs: filled.map((s) => s.slug),
            potColour,
            kind: mode,
          });
          setSavedAt(Date.now());
          setModalOpen(false);
        }}
      />
    </div>
  );
}

/**
 * Minecraft DyeColor → textureDiffuseColor (RGB hex). These are the same
 * values the in-game `PokeBaitItemColorProvider` reads from the bait's
 * FoodColourComponent to tint each layer.
 *
 * Source: net.minecraft.world.item.DyeColor.java per-vanilla 1.21.x.
 * We keep the table in sync with the official mod by name (lower_snake_case).
 */
const DYE_TEXTURE_COLOR: Record<string, string> = {
  white: "#F9FFFE",
  orange: "#F9801D",
  magenta: "#C74EBD",
  light_blue: "#3AB3DA",
  yellow: "#FED83D",
  lime: "#80C71F",
  pink: "#F38BAA",
  gray: "#474F52",
  light_gray: "#9D9D97",
  cyan: "#169C9C",
  purple: "#8932B8",
  blue: "#3C44AA",
  brown: "#835432",
  green: "#5E7C16",
  red: "#B02E26",
  black: "#1D1D21",
};

function dyeToHex(dye: string | null | undefined): string | null {
  if (!dye) return null;
  return DYE_TEXTURE_COLOR[dye.toLowerCase()] ?? null;
}

/**
 * In-mod accurate preview of the Poké Bait. Replicates
 * `PokeBaitItemColorProvider`: 3 stacked alpha-mask layers (base +
 * overlay1 + overlay2) tinted by the DyeColor of each placed seasoning,
 * in slot order. The `mask-image` + `background-color` trick is the
 * portable way to reproduce Minecraft's textureDiffuseColor multiply.
 */
function BaitPreview({
  berries,
  size,
}: {
  berries: BerryPlacement[];
  size: number;
}) {
  const layers = [
    "/textures/cobblemon/item/poke_bait.png",
    "/textures/cobblemon/item/poke_bait_overlay1.png",
    "/textures/cobblemon/item/poke_bait_overlay2.png",
  ];
  return (
    <div
      className="relative rounded-lg border border-border bg-subtle/40 flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <div
        className="relative"
        style={{
          width: Math.round(size * 0.7),
          height: Math.round(size * 0.7),
          imageRendering: "pixelated",
        }}
      >
        {layers.map((src, i) => {
          // Slot N feeds layer N. With no seasoning placed at all, show
          // the base layer with its default brown tint so the user sees
          // a recognisable Poké Bait silhouette.
          const slot = berries[i];
          const fallbackBase = i === 0 && berries.length === 0;
          const tint = fallbackBase
            ? "#835432" // base poke_bait colour
            : dyeToHex(slot?.colour ?? null);
          if (!tint) return null;
          return (
            <div
              key={src}
              aria-hidden
              className="absolute inset-0"
              style={{
                backgroundColor: tint,
                WebkitMaskImage: `url(${src})`,
                maskImage: `url(${src})`,
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskSize: "contain",
                maskSize: "contain",
                WebkitMaskPosition: "center",
                maskPosition: "center",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

