"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, Star } from "lucide-react";

type Stats = {
  visits: number;
  /** Raw vote total (each submission counts, even repeats from one IP). */
  ratingCount: number;
  voteCount?: number;
  /** Distinct ip_hash count — population that actually shaped the average. */
  uniqueRaterCount?: number;
  ratingAverage: number;
};

/** Fired by RatingForm after a successful submit so the badge updates live. */
export const SITE_RATING_SUBMITTED_EVENT = "site-rating-submitted";

/**
 * Compact badge under the home intro: cumulative visits + average
 * satisfaction rating. Bumps the visit counter once per browser session
 * via sessionStorage so it doesn't over-count reloads.
 */
export function SiteStatsBadge() {
  const t = useTranslations("siteStats");
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    // Count this visit once per tab session, then fetch the aggregates.
    const KEY = "visit-counted";
    let cancelled = false;

    const refresh = async () => {
      try {
        // Cache buster so the freshly-submitted rating shows up
        // immediately instead of waiting for the CDN's 30-second SWR.
        const res = await fetch(`/api/site/stats?t=${Date.now()}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as Stats;
        if (!cancelled) setStats(data);
      } catch {
        /* ignore */
      }
    };

    const run = async () => {
      try {
        if (!sessionStorage.getItem(KEY)) {
          sessionStorage.setItem(KEY, "1");
          await fetch("/api/site/visit", { method: "POST" });
        }
      } catch {
        // Ignore — counter is best-effort.
      }
      await refresh();
    };
    run();

    const onRated = () => {
      // Small delay so the just-inserted row is visible to the SELECT
      // (Postgres is sync but the no-store fetch needs to fire AFTER
      // the rate POST completes — RatingForm dispatches the event in
      // the same tick after `await fetch`).
      refresh();
    };
    window.addEventListener(SITE_RATING_SUBMITTED_EVENT, onRated);
    return () => {
      cancelled = true;
      window.removeEventListener(SITE_RATING_SUBMITTED_EVENT, onRated);
    };
  }, []);

  if (!stats) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
      <span className="inline-flex items-center gap-1.5">
        <Eye className="h-3.5 w-3.5" aria-hidden />
        <span className="tabular-nums">
          {stats.visits.toLocaleString()}
        </span>
        <span>{t("visits", { count: stats.visits })}</span>
      </span>
      {stats.ratingCount > 0 && (
        <span
          className="inline-flex items-center gap-1.5"
          title={t("ratingTitle", {
            count: stats.uniqueRaterCount ?? stats.ratingCount,
            avg: stats.ratingAverage,
          })}
        >
          <Star
            className="h-3.5 w-3.5 text-amber-500 fill-amber-500"
            aria-hidden
          />
          <span className="tabular-nums font-medium text-foreground">
            {stats.ratingAverage.toFixed(1)}
          </span>
          <span className="text-muted">/ 5</span>
          <span className="text-muted">
            · {t("ratingVotes", { count: stats.voteCount ?? stats.ratingCount })}
          </span>
        </span>
      )}
    </div>
  );
}
