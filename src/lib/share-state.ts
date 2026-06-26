/**
 * Shareable maker state ⇄ URL query string.
 *
 * The snack / bait maker (CampfirePot) and the aprijuice maker keep their
 * configuration in component state. To make a screen shareable we mirror
 * that state into the URL: every change rewrites the query string, and on
 * load we hydrate the state back from it. A copied URL therefore reproduces
 * the exact same recipe + filters for whoever opens it.
 *
 * Encoding is intentionally compact (short keys, comma-joined lists) so the
 * link stays manageable, and tolerant on decode (unknown keys ignored,
 * malformed values dropped) so an old link never throws.
 */

/** A list value is joined with commas; empty entries are dropped. */
function putList(sp: URLSearchParams, key: string, values: string[]): void {
  const clean = values.filter((v) => v != null && v !== "");
  if (clean.length > 0) sp.set(key, clean.join(","));
}

function getList(sp: URLSearchParams, key: string): string[] {
  const raw = sp.get(key);
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function putScalar(sp: URLSearchParams, key: string, value: string): void {
  if (value !== "") sp.set(key, value);
}

function putBool(sp: URLSearchParams, key: string, value: boolean): void {
  if (value) sp.set(key, "1");
}

function getBool(sp: URLSearchParams, key: string): boolean {
  const v = sp.get(key);
  return v === "1" || v === "true";
}

/* ────────────────────────────────────────────────────────────────
 *  SNACK / BAIT
 * ──────────────────────────────────────────────────────────────── */

export type SnackSort =
  | "probability"
  | "dex"
  | "dex_desc"
  | "name"
  | "name_desc"
  | "bucket";

const SNACK_SORTS: SnackSort[] = [
  "probability",
  "dex",
  "dex_desc",
  "name",
  "name_desc",
  "bucket",
];

export interface SnackShareState {
  /** Up to 3 seasoning slugs; "" marks an empty slot, trailing empties trimmed. */
  slots: (string | null)[];
  biomes: string[];
  dimensions: string[];
  contexts: string[];
  structures: string[];
  sources: string[];
  times: string[];
  namespaces: string[];
  weather: string;
  skyExposure: string;
  lightLevel: string;
  moonPhase: string;
  minY: string;
  maxY: string;
  /** POT_COLOURS slug, or null for the default pot. */
  potColour: string | null;
  attQuery: string;
  attTypes: string[];
  attBuckets: string[];
  attSort: SnackSort;
  showShiny: boolean;
}

export const EMPTY_SNACK_STATE: SnackShareState = {
  slots: [],
  biomes: [],
  dimensions: [],
  contexts: [],
  structures: [],
  sources: [],
  times: [],
  namespaces: [],
  weather: "",
  skyExposure: "",
  lightLevel: "",
  moonPhase: "",
  minY: "",
  maxY: "",
  potColour: null,
  attQuery: "",
  attTypes: [],
  attBuckets: [],
  attSort: "probability",
  showShiny: false,
};

/** Encode snack/bait state into a query string (no leading "?"). */
export function encodeSnackState(state: SnackShareState): string {
  const sp = new URLSearchParams();
  // Slots keep their position: join with "," but allow empty slots in the
  // middle ("cheri_berry,,oran_berry"). Trailing empties are trimmed.
  const slots = [...state.slots];
  while (slots.length > 0 && !slots[slots.length - 1]) slots.pop();
  if (slots.length > 0) sp.set("s", slots.map((x) => x ?? "").join(","));

  putList(sp, "biome", state.biomes);
  putList(sp, "dim", state.dimensions);
  putList(sp, "ctx", state.contexts);
  putList(sp, "struct", state.structures);
  putList(sp, "src", state.sources);
  putList(sp, "time", state.times);
  putList(sp, "ns", state.namespaces);
  putScalar(sp, "weather", state.weather);
  putScalar(sp, "sky", state.skyExposure);
  putScalar(sp, "light", state.lightLevel);
  putScalar(sp, "moon", state.moonPhase);
  putScalar(sp, "minY", state.minY);
  putScalar(sp, "maxY", state.maxY);
  if (state.potColour) sp.set("pot", state.potColour);
  putScalar(sp, "aq", state.attQuery);
  putList(sp, "at", state.attTypes);
  putList(sp, "ab", state.attBuckets);
  if (state.attSort !== "probability") sp.set("asort", state.attSort);
  putBool(sp, "shiny", state.showShiny);

  return sp.toString();
}

/** Decode a query string back into snack/bait state, filling defaults. */
export function decodeSnackState(query: string | URLSearchParams): SnackShareState {
  const sp = typeof query === "string" ? new URLSearchParams(query) : query;
  const rawSlots = sp.get("s");
  const slots = rawSlots
    ? rawSlots.split(",").map((s) => {
        const t = s.trim();
        return t === "" ? null : t;
      })
    : [];

  const sortRaw = sp.get("asort") as SnackSort | null;
  const attSort = sortRaw && SNACK_SORTS.includes(sortRaw) ? sortRaw : "probability";

  return {
    slots: slots.slice(0, 3),
    biomes: getList(sp, "biome"),
    dimensions: getList(sp, "dim"),
    contexts: getList(sp, "ctx"),
    structures: getList(sp, "struct"),
    sources: getList(sp, "src"),
    times: getList(sp, "time"),
    namespaces: getList(sp, "ns"),
    weather: sp.get("weather") ?? "",
    skyExposure: sp.get("sky") ?? "",
    lightLevel: sp.get("light") ?? "",
    moonPhase: sp.get("moon") ?? "",
    minY: sp.get("minY") ?? "",
    maxY: sp.get("maxY") ?? "",
    potColour: sp.get("pot"),
    attQuery: sp.get("aq") ?? "",
    attTypes: getList(sp, "at"),
    attBuckets: getList(sp, "ab"),
    attSort,
    showShiny: getBool(sp, "shiny"),
  };
}

/** True when at least one shareable field is non-default. */
export function hasSnackState(state: SnackShareState): boolean {
  return encodeSnackState(state) !== "";
}

/* ────────────────────────────────────────────────────────────────
 *  APRIJUICE
 * ──────────────────────────────────────────────────────────────── */

export interface JuiceShareState {
  ownedBerries: string[];
  ownedApricorns: string[];
  /** Stat → target points, only non-zero entries kept. */
  target: Record<string, number>;
  ignoredStats: string[];
}

export const EMPTY_JUICE_STATE: JuiceShareState = {
  ownedBerries: [],
  ownedApricorns: [],
  target: {},
  ignoredStats: [],
};

/**
 * Encode juice maker state. `ownedAll` flags whether the current owned sets
 * equal the full catalogues — when they do we omit them from the URL (the
 * default is "owns everything") to keep the link short.
 */
export function encodeJuiceState(
  state: JuiceShareState,
  opts: { ownsAllBerries: boolean; ownsAllApricorns: boolean },
): string {
  const sp = new URLSearchParams();
  if (!opts.ownsAllBerries) putList(sp, "own", state.ownedBerries);
  if (!opts.ownsAllApricorns) putList(sp, "apr", state.ownedApricorns);

  const target = Object.entries(state.target)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}:${v}`);
  putList(sp, "target", target);
  putList(sp, "ignore", state.ignoredStats);
  return sp.toString();
}

export function decodeJuiceState(query: string | URLSearchParams): JuiceShareState {
  const sp = typeof query === "string" ? new URLSearchParams(query) : query;
  const target: Record<string, number> = {};
  for (const entry of getList(sp, "target")) {
    const [stat, rawVal] = entry.split(":");
    const val = Number(rawVal);
    if (stat && Number.isFinite(val) && val > 0) target[stat] = val;
  }
  return {
    ownedBerries: getList(sp, "own"),
    ownedApricorns: getList(sp, "apr"),
    target,
    ignoredStats: getList(sp, "ignore"),
  };
}
