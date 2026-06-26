"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUp,
  Ban,
  Shield,
  Target,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { ItemIcon } from "./ItemIcon";
import { Spinner, TopProgress, Skeleton } from "./Loader";
import { OwnedBerriesPicker } from "./juice/OwnedBerriesPicker";
import { ShareRecipeButton } from "./ShareRecipeButton";
import { encodeJuiceState, decodeJuiceState } from "@/lib/share-state";
import type {
  Apricorn,
  Flavour,
  JuiceResult,
  RidingStat,
} from "@/lib/recommend/aprijuice";

/**
 * Client-side mirror of `maxForStatGiven` from the server solver. We
 * receive the set of achievable stat vectors once per ownership change
 * and recompute constrained caps locally every time the user drags a
 * slider. Worst case ~1 000 vectors × 5 constraints × 50ms debounce →
 * sub-ms per cap.
 */
type StatVector = Record<RidingStat, number>;

function maxForStatGivenClient(
  vectors: StatVector[],
  stat: RidingStat,
  constraints: Record<RidingStat, number>,
): number {
  let best = -Infinity;
  outer: for (const v of vectors) {
    for (const other of RIDE_STATS) {
      if (other === stat) continue;
      if (v[other] < constraints[other]) continue outer;
    }
    if (v[stat] > best) best = v[stat];
  }
  return Number.isFinite(best) ? best : 0;
}

const RIDE_STATS: RidingStat[] = [
  "ACCELERATION",
  "SKILL",
  "SPEED",
  "STAMINA",
  "JUMP",
];

type BerryDTO = {
  slug: string;
  itemId: string;
  colour: string | null;
  flavours: Partial<Record<Flavour, number>>;
};

const APRICORNS: Apricorn[] = [
  "RED",
  "YELLOW",
  "GREEN",
  "BLUE",
  "PINK",
  "BLACK",
  "WHITE",
];

const APRICORN_HEX: Record<Apricorn, string> = {
  RED: "#ff6b6b",
  YELLOW: "#f7d26a",
  GREEN: "#6bcf7f",
  BLUE: "#6b9dff",
  PINK: "#f090c7",
  BLACK: "#2b2b33",
  WHITE: "#e9e9ee",
};

const STAT_ICON: Record<RidingStat, LucideIcon> = {
  ACCELERATION: Zap,
  SKILL: Target,
  SPEED: Wind,
  STAMINA: Shield,
  JUMP: ArrowUp,
};

const FLAVOURS_ALL: Flavour[] = ["SPICY", "DRY", "SWEET", "SOUR", "BITTER"];

/** Per-flavour colour (matches SnackEffectsSummary / CampfirePot palette). */
const FLAVOUR_COLORS: Record<Flavour, string> = {
  SPICY: "#e85a3a",
  DRY: "#7fb3d5",
  SWEET: "#f8b3d7",
  SOUR: "#f4d35e",
  BITTER: "#735a8a",
};

const STAT_TONE: Record<RidingStat, string> = {
  ACCELERATION: "text-red-600 dark:text-red-400",
  SKILL: "text-cyan-600 dark:text-cyan-400",
  SPEED: "text-pink-600 dark:text-pink-400",
  STAMINA: "text-amber-600 dark:text-amber-400",
  JUMP: "text-purple-600 dark:text-purple-400",
};

type Suggestion = {
  apricorn: Apricorn;
  berrySlugs: string[];
  result: JuiceResult;
  /** L2 distance from the user's target vector — lower is better. */
  distance: number;
};

const ZERO_STATS: Record<RidingStat, number> = {
  ACCELERATION: 0,
  SKILL: 0,
  SPEED: 0,
  STAMINA: 0,
  JUMP: 0,
};

/**
 * Aprijuice *advisor*. We don't cook juices for users — they'll do that
 * in-game. Instead we answer: "given what you have and what stats you
 * want, what's the best recipe?"
 *
 *   1. User declares what they own (default = everything; uncheck what's
 *      missing).
 *   2. Server returns a point budget + per-stat ceilings computed from
 *      that owned pool.
 *   3. User distributes points via sliders (sum ≤ budget).
 *   4. Server returns the closest achievable recipes.
 */
export function JuiceMaker() {
  const t = useTranslations("juice");
  const tc = useTranslations("common");

  const [berries, setBerries] = useState<BerryDTO[]>([]);
  const [berriesLoading, setBerriesLoading] = useState(true);

  const [ownedBerries, setOwnedBerries] = useState<Set<string>>(new Set());
  const [ownedApricorns, setOwnedApricorns] = useState<Set<Apricorn>>(
    new Set(APRICORNS),
  );

  const [targetPoints, setTargetPoints] = useState<Record<RidingStat, number>>(
    ZERO_STATS,
  );

  const [budget, setBudget] = useState(0);
  const [caps, setCaps] = useState<Record<RidingStat, number>>(ZERO_STATS);
  /**
   * Full set of stat vectors reachable given what the user owns. Used
   * to compute the REAL max slider reach for a stat accounting for the
   * points already allocated on the other stats (no single recipe can
   * hit every stat at its ceiling simultaneously).
   */
  const [vectors, setVectors] = useState<StatVector[]>([]);

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const [berryFilter, setBerryFilter] = useState("");
  const [activeFlavours, setActiveFlavours] = useState<Set<Flavour>>(new Set());
  const [ignoredStats, setIgnoredStats] = useState<Set<RidingStat>>(new Set());

  const hydratedRef = useRef(false);
  useEffect(() => {
    fetch("/api/juice")
      .then((r) => r.json())
      .then((d: { berries?: BerryDTO[] }) => {
        const list = d.berries ?? [];
        setBerries(list);
        // Hydrate from a shared URL if present, else default to owning
        // every berry (the user unchecks what they're missing).
        const shared =
          typeof window !== "undefined"
            ? decodeJuiceState(window.location.search)
            : null;
        hydratedRef.current = true;
        const allSlugs = new Set(list.map((b) => b.slug));
        if (shared && shared.ownedBerries.length > 0) {
          setOwnedBerries(new Set(shared.ownedBerries.filter((s) => allSlugs.has(s))));
        } else {
          setOwnedBerries(allSlugs);
        }
        if (shared && shared.ownedApricorns.length > 0) {
          setOwnedApricorns(
            new Set(shared.ownedApricorns.filter((a): a is Apricorn =>
              (APRICORNS as string[]).includes(a),
            )),
          );
        }
        if (shared && Object.keys(shared.target).length > 0) {
          setTargetPoints((prev) => {
            const next = { ...prev };
            for (const [stat, v] of Object.entries(shared.target)) {
              if ((RIDE_STATS as string[]).includes(stat)) {
                next[stat as RidingStat] = v;
              }
            }
            return next;
          });
        }
        if (shared && shared.ignoredStats.length > 0) {
          setIgnoredStats(
            new Set(
              shared.ignoredStats.filter((s): s is RidingStat =>
                (RIDE_STATS as string[]).includes(s),
              ),
            ),
          );
        }
      })
      .catch(() => setBerries([]))
      .finally(() => setBerriesLoading(false));
  }, []);

  // Mirror the maker state into the URL so the screen is shareable.
  const ownsAllBerries =
    berries.length > 0 && ownedBerries.size === berries.length;
  const ownsAllApricorns = ownedApricorns.size === APRICORNS.length;
  const shareQuery = useMemo(
    () =>
      encodeJuiceState(
        {
          ownedBerries: [...ownedBerries],
          ownedApricorns: [...ownedApricorns],
          target: targetPoints,
          ignoredStats: [...ignoredStats],
        },
        { ownsAllBerries, ownsAllApricorns },
      ),
    [ownedBerries, ownedApricorns, targetPoints, ignoredStats, ownsAllBerries, ownsAllApricorns],
  );
  useEffect(() => {
    if (!hydratedRef.current || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.search.replace(/^\?/, "") === shareQuery) return;
    url.search = shareQuery;
    window.history.replaceState({}, "", url.toString());
  }, [shareQuery]);

  // Spent points ignore stats the user explicitly opted out of — those
  // are not consuming any budget.
  const spentPoints = useMemo(
    () =>
      (Object.entries(targetPoints) as Array<[RidingStat, number]>)
        .filter(([s]) => !ignoredStats.has(s))
        .reduce((s, [, v]) => s + v, 0),
    [targetPoints, ignoredStats],
  );

  // Budget probe: fetch caps whenever ownership changes.
  useEffect(() => {
    if (ownedBerries.size === 0 || ownedApricorns.size === 0) {
      setBudget(0);
      setCaps(ZERO_STATS);
      setVectors([]);
      return;
    }
    const ctrl = new AbortController();
    fetch("/api/juice/suggest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownedBerrySlugs: [...ownedBerries],
        ownedApricorns: [...ownedApricorns],
        includeVectors: true,
        limit: 0,
      }),
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then(
        (d: {
          budget: number;
          caps: Record<RidingStat, number>;
          vectors?: StatVector[];
        }) => {
          setBudget(d.budget ?? 0);
          if (d.caps) setCaps(d.caps);
          if (d.vectors) setVectors(d.vectors);
        },
      )
      .catch(() => {});
    return () => ctrl.abort();
  }, [ownedBerries, ownedApricorns]);

  // Re-solve when target, owned berries or apricorns change.
  useEffect(() => {
    if (spentPoints === 0) {
      setSuggestions([]);
      return;
    }
    if (ownedBerries.size === 0 || ownedApricorns.size === 0) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setSuggestLoading(true);
      try {
        const res = await fetch("/api/juice/suggest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            // Zero-out ignored stats so they don't reach the solver — the
            // user said "any value is fine" for those.
            target: (Object.entries(targetPoints) as Array<[RidingStat, number]>)
              .filter(([s, v]) => !ignoredStats.has(s) && v > 0)
              .reduce(
                (acc, [s, v]) => ({ ...acc, [s]: v }),
                {} as Partial<Record<RidingStat, number>>,
              ),
            ownedBerrySlugs: [...ownedBerries],
            ownedApricorns: [...ownedApricorns],
            ignoredStats: [...ignoredStats],
            limit: 6,
          }),
          signal: ctrl.signal,
        });
        const data = (await res.json()) as {
          suggestions: Suggestion[];
          budget: number;
          caps: Record<RidingStat, number>;
        };
        setSuggestions(data.suggestions ?? []);
        setBudget(data.budget ?? 0);
        if (data.caps) setCaps(data.caps);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setSuggestions([]);
      } finally {
        setSuggestLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [targetPoints, ownedBerries, ownedApricorns, ignoredStats, spentPoints]);

  const setStatPoints = (stat: RidingStat, raw: number) => {
    if (ignoredStats.has(stat)) return;
    setTargetPoints((prev) => {
      // Hard cap = the biggest value for `stat` that's STILL reachable
      // while every OTHER non-ignored stat stays at its current value.
      // Ignored stats don't constrain (−Infinity).
      const constraints: Record<RidingStat, number> = {
        ACCELERATION: ignoredStats.has("ACCELERATION")
          ? -Infinity
          : prev.ACCELERATION,
        SKILL: ignoredStats.has("SKILL") ? -Infinity : prev.SKILL,
        SPEED: ignoredStats.has("SPEED") ? -Infinity : prev.SPEED,
        STAMINA: ignoredStats.has("STAMINA") ? -Infinity : prev.STAMINA,
        JUMP: ignoredStats.has("JUMP") ? -Infinity : prev.JUMP,
      };
      const hard = vectors.length > 0
        ? maxForStatGivenClient(vectors, stat, constraints)
        : (caps[stat] ?? 0);
      const next = Math.max(0, Math.min(raw, hard));
      return { ...prev, [stat]: next };
    });
  };

  const toggleIgnoreStat = (stat: RidingStat) => {
    setIgnoredStats((prev) => {
      const n = new Set(prev);
      if (n.has(stat)) n.delete(stat);
      else {
        n.add(stat);
        // Drop any points allocated to the now-ignored stat.
        setTargetPoints((p) => ({ ...p, [stat]: 0 }));
      }
      return n;
    });
  };

  const resetPoints = () => {
    setTargetPoints(ZERO_STATS);
    setIgnoredStats(new Set());
  };

  const toggleOwnedBerry = (slug: string) =>
    setOwnedBerries((prev) => {
      const n = new Set(prev);
      if (n.has(slug)) n.delete(slug);
      else n.add(slug);
      return n;
    });

  const toggleAllBerries = () =>
    setOwnedBerries((prev) =>
      prev.size === berries.length
        ? new Set()
        : new Set(berries.map((b) => b.slug)),
    );

  const toggleOwnedApricorn = (a: Apricorn) =>
    setOwnedApricorns((prev) => {
      const n = new Set(prev);
      if (n.has(a)) n.delete(a);
      else n.add(a);
      return n;
    });

  const toggleFlavourFilter = (f: Flavour) =>
    setActiveFlavours((prev) => {
      const n = new Set(prev);
      if (n.has(f)) n.delete(f);
      else n.add(f);
      return n;
    });

  const filteredBerries = useMemo(() => {
    const q = berryFilter.trim().toLowerCase();
    return berries.filter((b) => {
      if (q) {
        const hay = `${b.slug.replaceAll("_", " ")} ${b.itemId}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      // If any flavour chips are active, the berry must have a POSITIVE
      // magnitude on at least one of them.
      if (activeFlavours.size > 0) {
        let match = false;
        for (const f of activeFlavours) {
          if ((b.flavours[f] ?? 0) > 0) {
            match = true;
            break;
          }
        }
        if (!match) return false;
      }
      return true;
    });
  }, [berries, berryFilter, activeFlavours]);

  return (
    <div className="space-y-6">
      <TopProgress active={berriesLoading || suggestLoading} />

      <div className="flex justify-end">
        <ShareRecipeButton
          title="Aprijuice plan"
          text="Check out this Aprijuice plan on Snack & Catch."
          label={tc("share")}
        />
      </div>

      {/* Step 1 — owned apricorns + berries */}
      <section className="rounded-xl border border-border bg-card p-4 space-y-4">
        <header>
          <div className="text-[10px] uppercase tracking-widest text-muted">
            {t("stepOwnership")}
          </div>
          <h3 className="mt-0.5 text-lg font-semibold">
            {t("ownershipTitle")}
          </h3>
          <p className="mt-1 text-xs text-muted">{t("ownershipHelp")}</p>
        </header>

        <div>
          <div className="flex items-center justify-between">
            <h4 className="text-xs uppercase tracking-wide text-muted">
              {t("ownedApricorns")}{" "}
              <span className="ml-1 normal-case text-muted">
                ({ownedApricorns.size}/{APRICORNS.length})
              </span>
            </h4>
          </div>
          <div className="mt-2 flex items-center justify-between gap-1.5 sm:gap-2 sm:justify-start sm:flex-wrap">
            {APRICORNS.map((a) => {
              const active = ownedApricorns.has(a);
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => toggleOwnedApricorn(a)}
                  aria-pressed={active}
                  aria-label={a.toLowerCase()}
                  className={`size-8 sm:size-10 shrink-0 rounded-full border-2 transition-all ${
                    active
                      ? "border-accent scale-105"
                      : "border-border opacity-40 hover:opacity-70"
                  }`}
                  style={{ background: APRICORN_HEX[a] }}
                  title={a}
                />
              );
            })}
          </div>
        </div>

        <div>
          <OwnedBerriesPicker
            berries={berries}
            loading={berriesLoading}
            ownedBerries={ownedBerries}
            onToggle={toggleOwnedBerry}
            onSelectAll={toggleAllBerries}
            filter={berryFilter}
            onFilterChange={setBerryFilter}
            activeFlavours={activeFlavours as Set<string>}
            onToggleFlavour={(f) => toggleFlavourFilter(f as Flavour)}
            onClearFlavours={() => setActiveFlavours(new Set())}
            flavoursAll={FLAVOURS_ALL}
            flavourColors={FLAVOUR_COLORS}
            filteredBerries={filteredBerries}
          />
        </div>
      </section>

      {/* Step 2 — distribute points */}
      <section className="rounded-xl border border-border bg-card p-4 space-y-4">
        <header>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted">
                {t("stepDistribute")}
              </div>
              <h3 className="mt-0.5 text-lg font-semibold">
                {t("distributeTitle")}
              </h3>
            </div>
            <div className="text-sm font-mono tabular-nums">
              <span
                className={
                  spentPoints > budget
                    ? "text-red-500"
                    : spentPoints === budget && spentPoints > 0
                      ? "text-accent"
                      : "text-foreground"
                }
              >
                {spentPoints}
              </span>
              <span className="text-muted"> / {budget}</span>
            </div>
          </div>
          <p className="mt-1 text-xs text-muted">{t("distributeHelp")}</p>
        </header>

        {/* Mobile-only legend: icon → label, since the per-row label is
            hidden below to free horizontal space for the slider. */}
        <ul
          className="sm:hidden flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted"
          aria-label="Stats legend"
        >
          {(["ACCELERATION", "SKILL", "SPEED", "STAMINA", "JUMP"] as RidingStat[]).map(
            (stat) => {
              const Icon = STAT_ICON[stat];
              return (
                <li key={stat} className="inline-flex items-center gap-1">
                  <Icon
                    className={`h-3.5 w-3.5 ${STAT_TONE[stat]}`}
                    aria-hidden
                  />
                  <span className="uppercase tracking-wide">
                    {stat.toLowerCase()}
                  </span>
                </li>
              );
            },
          )}
        </ul>

        <ul className="space-y-3">
          {(["ACCELERATION", "SKILL", "SPEED", "STAMINA", "JUMP"] as RidingStat[]).map(
            (stat) => {
              const Icon = STAT_ICON[stat];
              const cap = caps[stat] ?? 0;
              const value = targetPoints[stat];
              const ignored = ignoredStats.has(stat);
              // Real constrained cap: given the OTHER stats are pinned
              // at their current values, how high can `stat` actually
              // go? Computed by scanning the achievable-vector set
              // returned by the server.
              const constraints: Record<RidingStat, number> = {
                ACCELERATION: ignoredStats.has("ACCELERATION")
                  ? -Infinity
                  : stat === "ACCELERATION"
                    ? -Infinity
                    : targetPoints.ACCELERATION,
                SKILL: ignoredStats.has("SKILL")
                  ? -Infinity
                  : stat === "SKILL"
                    ? -Infinity
                    : targetPoints.SKILL,
                SPEED: ignoredStats.has("SPEED")
                  ? -Infinity
                  : stat === "SPEED"
                    ? -Infinity
                    : targetPoints.SPEED,
                STAMINA: ignoredStats.has("STAMINA")
                  ? -Infinity
                  : stat === "STAMINA"
                    ? -Infinity
                    : targetPoints.STAMINA,
                JUMP: ignoredStats.has("JUMP")
                  ? -Infinity
                  : stat === "JUMP"
                    ? -Infinity
                    : targetPoints.JUMP,
              };
              const constrained = vectors.length > 0
                ? maxForStatGivenClient(vectors, stat, constraints)
                : cap;
              const maxForThis = ignored ? 0 : Math.max(0, constrained);
              return (
                <li key={stat} className="flex items-center gap-2">
                  <Icon
                    className={`h-4 w-4 ${STAT_TONE[stat]} shrink-0 ${ignored ? "opacity-30" : ""}`}
                    aria-label={stat.toLowerCase()}
                  />
                  <span
                    className={`hidden sm:inline text-[11px] uppercase tracking-wide w-16 shrink-0 ${ignored ? "line-through text-muted" : ""}`}
                  >
                    {stat.toLowerCase()}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(maxForThis, 1)}
                    value={ignored ? 0 : value}
                    onChange={(e) =>
                      setStatPoints(stat, Number(e.target.value))
                    }
                    disabled={ignored || cap === 0 || maxForThis === 0}
                    aria-label={stat.toLowerCase()}
                    className="flex-1 accent-accent disabled:opacity-30"
                  />
                  <span className="w-10 text-right text-sm font-mono tabular-nums">
                    {ignored ? ", " : `+${value}`}
                  </span>
                  <span className="text-[10px] text-muted font-mono tabular-nums w-10 text-right">
                    {ignored ? "" : `/${maxForThis}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleIgnoreStat(stat)}
                    aria-pressed={ignored}
                    aria-label={t("ignore")}
                    title={t("ignoreTitle")}
                    className={`text-[10px] uppercase tracking-wide rounded border transition-colors shrink-0 inline-flex items-center justify-center sm:px-1.5 sm:py-0.5 sm:gap-1 size-7 sm:size-auto ${
                      ignored
                        ? "border-amber-400 bg-amber-400/10 text-amber-600 dark:text-amber-400"
                        : "border-border text-muted hover:text-foreground"
                    }`}
                  >
                    <Ban className="h-3.5 w-3.5 sm:hidden" aria-hidden />
                    <span className="hidden sm:inline">{t("ignore")}</span>
                  </button>
                </li>
              );
            },
          )}
        </ul>

        {spentPoints > 0 && (
          <button
            type="button"
            onClick={resetPoints}
            className="text-xs px-2 py-1 rounded-md border border-border text-muted hover:text-foreground"
          >
            {tc("clear")}
          </button>
        )}
      </section>

      {/* Step 3 — recipes */}
      <section className="rounded-xl border border-border bg-card p-4">
        <header>
          <div className="text-[10px] uppercase tracking-widest text-muted">
            {t("stepRecipes")}
          </div>
          <h3 className="mt-0.5 text-lg font-semibold flex items-center gap-2">
            {t("topCombos")}
            {suggestLoading && <Spinner />}
          </h3>
        </header>

        {spentPoints === 0 ? (
          <p className="mt-4 text-sm text-muted">{t("pickStat")}</p>
        ) : suggestions.length === 0 && !suggestLoading ? (
          <p className="mt-4 text-sm text-muted">{t("noCombo")}</p>
        ) : (
          <ul className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {suggestions.map((s, i) => {
              const href = `/juice/recipe?apricorn=${s.apricorn}&berries=${encodeURIComponent(s.berrySlugs.join(","))}`;
              return (
              <li
                key={`${s.apricorn}-${s.berrySlugs.join(",")}`}
                className={`rounded-xl border bg-card transition-colors hover:border-accent/80 ${
                  i === 0
                    ? "border-accent ring-1 ring-accent/40"
                    : "border-border"
                }`}
              >
                <Link
                  href={href}
                  className="block p-3 space-y-2"
                  aria-label={t("openRecipe", { kind: s.apricorn })}
                >
                <div className="flex items-center gap-2">
                  <span
                    className="size-6 rounded-full border border-border shrink-0"
                    style={{ background: APRICORN_HEX[s.apricorn] }}
                    title={`${s.apricorn} apricorn`}
                  />
                  <span className="text-xs uppercase font-medium">
                    {t("apricornHeading", { kind: s.apricorn })}
                  </span>
                  <span
                    className="ml-auto text-[10px] font-mono text-muted tabular-nums"
                    title={t("distanceTitle")}
                  >
                    Δ {s.distance.toFixed(1)}
                  </span>
                  {i < 3 && (
                    <span className="text-[10px] font-mono bg-accent text-accent-foreground rounded-full px-1.5 py-0.5">
                      #{i + 1}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap gap-1 min-h-[2.5rem]">
                  {s.berrySlugs.length === 0 ? (
                    <span className="text-[10px] text-muted italic">
                      {t("noSeasoning")}
                    </span>
                  ) : (
                    s.berrySlugs.map((slug, j) => {
                      const b = berries.find((x) => x.slug === slug);
                      return (
                        <span
                          key={`${slug}-${j}`}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-subtle px-1.5 py-1"
                          title={slug}
                        >
                          {b && <ItemIcon id={b.itemId} size={20} />}
                          <span className="text-[10px] capitalize">
                            {slug.replaceAll("_", " ")}
                          </span>
                        </span>
                      );
                    })
                  )}
                </div>

                <ul className="grid grid-cols-5 gap-1 text-[10px]">
                  {(["ACCELERATION", "SKILL", "SPEED", "STAMINA", "JUMP"] as RidingStat[]).map(
                    (stat) => {
                      const delta = s.result.statBoosts[stat] ?? 0;
                      const Icon = STAT_ICON[stat];
                      return (
                        <li
                          key={stat}
                          className={`rounded-md border p-1 flex flex-col items-center gap-0.5 ${
                            delta > 0
                              ? "border-emerald-500/40 bg-emerald-500/5"
                              : delta < 0
                                ? "border-red-500/40 bg-red-500/5"
                                : "border-border"
                          }`}
                        >
                          <Icon
                            className={`h-3 w-3 ${STAT_TONE[stat]}`}
                            aria-hidden
                          />
                          <span className="font-mono">
                            {delta > 0 ? "+" : ""}
                            {delta}
                          </span>
                        </li>
                      );
                    },
                  )}
                </ul>
                </Link>
              </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
