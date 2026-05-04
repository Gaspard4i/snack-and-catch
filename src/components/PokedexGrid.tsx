"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { Spinner, TopProgress, PokedexCardSkeleton } from "./Loader";
import { PokemonSprite } from "./PokemonSprite";
import { TypePair } from "./TypeBadge";
import { MultiSelect, type MultiSelectOption } from "./MultiSelect";
import { VariantBadge } from "./VariantBadge";
import { useFilterState } from "@/lib/url-state";

type Species = {
  id: number;
  slug: string;
  name: string;
  dexNo: number;
  primaryType: string;
  secondaryType: string | null;
  baseStats: Record<string, number>;
  catchRate: number;
  abilities: string[];
  labels: string[];
  variantOfSpeciesId?: number | null;
  variantLabel?: string | null;
};

const TYPE_OPTIONS: MultiSelectOption[] = [
  "normal", "fire", "water", "electric", "grass", "ice", "fighting",
  "poison", "ground", "flying", "psychic", "bug", "rock", "ghost",
  "dragon", "dark", "steel", "fairy",
].map((t) => ({ value: t, label: t }));

const GEN_OPTIONS: MultiSelectOption[] = Array.from({ length: 9 }, (_, i) => ({
  value: `gen${i + 1}`,
  label: `Gen ${i + 1}`,
}));

const LABEL_OPTIONS: MultiSelectOption[] = [
  { value: "starter", label: "Starter", group: "Story" },
  { value: "legendary", label: "Legendary", group: "Story" },
  { value: "mythical", label: "Mythical", group: "Story" },
  { value: "paradox", label: "Paradox", group: "Story" },
  { value: "ultra_beast", label: "Ultra Beast", group: "Story" },
  { value: "baby", label: "Baby", group: "Evolution" },
];

type SortKey =
  | "dex"
  | "dex_desc"
  | "name"
  | "name_desc"
  | "hp"
  | "attack"
  | "speed"
  | "total";

const FILTER_DESCRIPTOR = {
  scalars: ["q", "gen", "sort", "form", "ability"],
  multi: ["type", "label"],
  bools: ["shiny"],
} as const;

export function PokedexGrid() {
  const t = useTranslations("pokedexUi");
  const tc = useTranslations("common");
  const [filters, setFilters] = useFilterState(FILTER_DESCRIPTOR);

  const q = filters.q ?? "";
  const types = filters.type;
  const gens = filters.gen ? [filters.gen] : [];
  const labels = filters.label;
  const sort = (filters.sort as SortKey) || "dex";
  const shiny = filters.shiny;
  const form = filters.form === "all" ? "all" : filters.form === "base" ? "base" : "regional";
  const ability = filters.ability ?? "";

  const [results, setResults] = useState<Species[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const reqIdRef = useRef(0);
  const inFlightRef = useRef(false);

  // Single stable identity that captures every filter axis. Comparing
  // arrays directly in deps would refire every render because
  // `searchParams.getAll(...)` returns a fresh array each call — the
  // join key is value-stable.
  const filterKey = useMemo(
    () =>
      [q, [...types].sort().join(","), gens.join(","), [...labels].sort().join(","), sort, form, ability].join("|"),
    [q, types, gens, labels, sort, form, ability],
  );

  const buildUrl = useCallback(
    (c: string | null) => {
      const u = new URLSearchParams();
      if (c) u.set("cursor", c);
      if (q) u.set("q", q);
      for (const t of types.slice(0, 2)) u.append("type", t);
      if (gens.length > 0) u.set("gen", gens[0]);
      for (const l of labels) u.append("label", l);
      u.set("form", form);
      if (ability.trim()) u.set("ability", ability.trim());
      u.set("sort", sort);
      return `/api/pokedex?${u.toString()}`;
    },
    // The key captures every value-relevant filter; arrays don't need
    // to appear directly in this deps list because they're folded in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterKey],
  );

  // Re-fetch whenever any filter changes. We bump the request id
  // (so any in-flight response is dropped) AND abort the running
  // fetch outright — letting it run wastes bandwidth and, more
  // importantly, would race with the new fetch the next effect
  // launches if the same connection slot resolves first.
  //
  // We don't kick the new fetch from this effect because at this
  // point the `cursor`/`done` setStates are still queued — the
  // captured closure for fetchPage still holds the previous cursor
  // and would request a stale page. The "kick" effect below depends
  // on the post-reset states and runs in the next commit.
  useEffect(() => {
    reqIdRef.current += 1;
    inFlightRef.current = false;
    abortRef.current?.abort();
    setResults([]);
    setCursor(null);
    setDone(false);
  }, [filterKey]);

  // Stable ref for the type intersection check inside fetchPage.
  const typesRef = useRef(types);
  typesRef.current = types;

  // AbortController for the in-flight request — when the user
  // changes a filter mid-fetch (or HMR kicks in) we abort instead
  // of letting the old fetch surface as an unhandled NetworkError.
  const abortRef = useRef<AbortController | null>(null);

  const fetchPage = useCallback(async () => {
    if (inFlightRef.current || done) return;
    inFlightRef.current = true;
    const myId = reqIdRef.current;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const res = await fetch(buildUrl(cursor), { signal: ctrl.signal });
      if (!res.ok) throw new Error("pokedex fetch failed");
      const data = (await res.json()) as { results: Species[]; nextCursor: string | null };
      if (myId !== reqIdRef.current) return;
      const activeTypes = typesRef.current;
      const filtered = data.results.filter((s) => {
        if (activeTypes.length > 0) {
          const own = [s.primaryType, s.secondaryType].filter(
            (x): x is string => !!x,
          );
          if (!activeTypes.every((t) => own.includes(t))) return false;
        }
        return true;
      });
      setResults((prev) => {
        const seen = new Set(prev.map((s) => s.id));
        const next = prev.slice();
        for (const s of filtered) {
          if (!seen.has(s.id)) {
            seen.add(s.id);
            next.push(s);
          }
        }
        return next;
      });
      if (data.nextCursor === null) setDone(true);
      else setCursor(data.nextCursor);
    } catch (err) {
      // AbortError = filter changed mid-flight, ignore.
      // TypeError "NetworkError" = transient (HMR, reload, offline).
      // Either way: don't surface it as an unhandled rejection.
      const name = (err as { name?: string } | null)?.name;
      if (name === "AbortError") return;
      if (myId === reqIdRef.current) setDone(true);
    } finally {
      if (myId === reqIdRef.current) setLoading(false);
      inFlightRef.current = false;
    }
  }, [buildUrl, cursor, done]);

  // Abort any in-flight fetch when the component unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Kick the first page when the grid is empty and we are not done.
  // This fires:
  //   - on first mount (results=[], done=false → fetch)
  //   - after a filter reset, on the commit after the reset effect
  //     (cursor is null, done is false, so fetchPage uses the fresh
  //     buildUrl and queries from the start).
  // We must NOT include `fetchPage` directly in deps; otherwise it
  // would also fire after every successful page fetch (because
  // `fetchPage` regens on every cursor tick) — but the
  // `results.length === 0` guard already prevents that. The lint
  // disable below is to opt out of the cascade-trigger.
  useEffect(() => {
    if (results.length === 0 && !done && !inFlightRef.current) {
      fetchPage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.length, done, filterKey]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) fetchPage();
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [fetchPage]);

  const sorted = results;

  const hasActiveFilters = useMemo(
    () =>
      q !== "" ||
      types.length > 0 ||
      gens.length > 0 ||
      labels.length > 0 ||
      form !== "regional" ||
      ability !== "",
    [q, types, gens, labels, form, ability],
  );

  const clearAll = () => {
    setFilters({
      q: null,
      type: null,
      gen: null,
      label: null,
      form: null,
      ability: null,
      sort: null,
    });
  };

  return (
    <>
      <TopProgress active={loading} />
      <div className="sticky top-[57px] z-30 -mx-6 px-6 py-3 bg-background/80 backdrop-blur border-b border-border space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setFilters({ q: e.target.value || null })}
            placeholder={t("searchPlaceholder")}
            className="flex-1 min-w-48 rounded-lg border border-border bg-card px-4 py-2 outline-none focus:border-accent"
          />
          <MultiSelect
            label={t("types")}
            options={TYPE_OPTIONS}
            value={types}
            onChange={(v) => setFilters({ type: v })}
            placeholder={t("typesAny")}
            maxSelection={2}
          />
          <MultiSelect
            label={t("gens")}
            options={GEN_OPTIONS}
            value={gens}
            onChange={(v) => setFilters({ gen: v[0] ?? null })}
            placeholder={t("gensAny")}
            searchable={false}
          />
          <label className="text-xs inline-flex items-center gap-1 text-muted">
            <span className="text-[10px] uppercase tracking-wide">{tc("sort")}</span>
            <select
              value={sort}
              onChange={(e) => setFilters({ sort: e.target.value })}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs"
            >
              <option value="dex">{t("sortDex")}</option>
              <option value="dex_desc">{t("sortDexDesc")}</option>
              <option value="name">{t("sortName")}</option>
              <option value="name_desc">{t("sortNameDesc")}</option>
              <option value="hp">{t("sortHp")}</option>
              <option value="attack">{t("sortAttack")}</option>
              <option value="speed">{t("sortSpeed")}</option>
              <option value="total">{t("sortTotal")}</option>
            </select>
          </label>
          <button
            onClick={() => setFilters({ shiny: !shiny })}
            aria-pressed={shiny}
            className={`text-xs inline-flex items-center gap-1 px-2 py-1 rounded-md border transition-colors ${
              shiny
                ? "border-amber-400 bg-amber-400/10 text-amber-600 dark:text-amber-400"
                : "border-border text-muted hover:text-foreground"
            }`}
            title={t("shinyTitle")}
          >
            <Star
              className={`h-3.5 w-3.5 ${shiny ? "text-amber-500 fill-amber-500" : ""}`}
              aria-hidden
            />
            <span className="text-[10px] uppercase tracking-wide">{t("shiny")}</span>
          </button>
          <button
            onClick={() => setAdvanced((v) => !v)}
            aria-expanded={advanced}
            className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border text-muted hover:text-foreground"
          >
            {advanced ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            <span className="text-[10px] uppercase tracking-wide">{t("advanced")}</span>
          </button>
          {hasActiveFilters && (
            <button
              onClick={clearAll}
              className="text-xs px-2 py-1 rounded-md border border-border text-muted hover:text-foreground"
            >
              {tc("clearAll")}
            </button>
          )}
          {loading && <Spinner label="loading" />}
        </div>
        {advanced && (
          <div className="flex flex-wrap items-center gap-2 pb-1">
            <label className="text-xs inline-flex items-center gap-1 text-muted">
              <span className="text-[10px] uppercase tracking-wide">{t("forms")}</span>
              <select
                value={form}
                onChange={(e) => setFilters({ form: e.target.value === "regional" ? null : e.target.value })}
                className="rounded-md border border-border bg-card px-2 py-1 text-xs"
              >
                <option value="regional">{t("formRegional")}</option>
                <option value="base">{t("formBaseOnly")}</option>
                <option value="all">{t("formAll")}</option>
              </select>
            </label>
            <MultiSelect
              label={t("tag")}
              options={LABEL_OPTIONS}
              value={labels}
              onChange={(v) => setFilters({ label: v })}
              placeholder={t("tagAny")}
              searchable={false}
            />
            <label className="text-xs inline-flex items-center gap-1 text-muted">
              <span className="text-[10px] uppercase tracking-wide">{t("ability")}</span>
              <input
                type="search"
                value={ability}
                onChange={(e) => setFilters({ ability: e.target.value || null })}
                placeholder={t("abilityPlaceholder")}
                className="rounded-md border border-border bg-card px-2 py-1 text-xs w-32"
              />
            </label>
          </div>
        )}
      </div>

      {/*
        Fixed-size cards (96×140 baseline, scale up at md+ via uniform
        column count). Sprite area is the same width as the card so a
        long species name truncates rather than reflowing the layout.
      */}
      <ul className="mt-6 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 sm:gap-3">
        {loading && results.length === 0
          ? Array.from({ length: 12 }).map((_, i) => (
              <li key={`sk-${i}`}>
                <PokedexCardSkeleton />
              </li>
            ))
          : null}
        {sorted.map((s) => (
          <li key={s.id}>
            <Link
              href={`/pokemon/${s.slug}`}
              className="group relative block rounded-lg border border-border bg-card hover:bg-subtle hover:border-accent/50 transition-all p-2 h-full"
            >
              <VariantBadge variantLabel={s.variantLabel} />
              <div className="flex justify-center">
                <PokemonSprite
                  dexNo={s.dexNo}
                  name={s.name}
                  baseSlug={s.slug.replace(/-(?:alolan|galarian|hisuian|paldean|paldean-.*|mega.*|gmax|tera.*).*$/, "")}
                  variantLabel={s.variantLabel}
                  size={72}
                  shiny={shiny}
                  className="transition-transform group-hover:scale-110"
                />
              </div>
              <div className="mt-1 text-[10px] font-mono text-muted text-center">
                #{String(s.dexNo).padStart(4, "0")}
              </div>
              <div className="text-center font-medium truncate text-xs sm:text-sm leading-tight">
                {s.name}
              </div>
              <div className="mt-1 flex justify-center min-w-0 max-w-full overflow-hidden">
                <TypePair primary={s.primaryType} secondary={s.secondaryType} size={14} />
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <div
        ref={sentinel}
        className="h-20 flex items-center justify-center text-xs text-muted"
      >
        {loading
          ? <Spinner label={tc("loading")} />
          : done
            ? t("speciesCount", { count: results.length })
            : ""}
      </div>
    </>
  );
}
