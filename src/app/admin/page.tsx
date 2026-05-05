import type { Metadata } from "next";
import { connection } from "next/server";
import { sql } from "drizzle-orm";
import { db, isDbMissing } from "@/lib/db/client";

export const metadata: Metadata = {
  title: "Admin — Snack & Catch",
  robots: { index: false, follow: false, nocache: true },
};

type StarBucket = { stars: number; n: number };
type DailyBucket = { day: string; votes: number };
type RouteRow = {
  route: string;
  views: number;
  uniqueSessions: number;
  avgDurationMs: number | null;
  avgScrollPct: number | null;
};
type ClickRow = { name: string; route: string | null; n: number };
type AnalyticsAggregates = {
  totalEvents: number;
  totalSessions: number;
  totalPageviews: number;
  pageviewsLast24h: number;
  avgSessionDurationMs: number | null;
};
type Comment = {
  id: number;
  stars: number;
  comment: string | null;
  locale: string | null;
  ip_hash: string | null;
  created_at: string;
};
type Aggregates = {
  visits: number;
  totalVotes: number;
  uniqueVoters: number;
  avg: number | null;
  withComment: number;
  last24h: number;
  last7d: number;
};

async function loadData() {
  if (isDbMissing()) {
    return null;
  }

  const [aggRows, distRows, dailyRows, commentRows] = await Promise.all([
    db.execute<{
      visits: number;
      total_votes: number;
      unique_voters: number;
      avg: number | null;
      with_comment: number;
      last_24h: number;
      last_7d: number;
    }>(sql`
      SELECT
        coalesce((SELECT visits FROM site_stats WHERE id = 1), 0)::int AS visits,
        (SELECT count(*)::int FROM site_ratings) AS total_votes,
        (SELECT count(DISTINCT coalesce(ip_hash, '')) FROM site_ratings) AS unique_voters,
        (
          SELECT avg(stars)::float8 FROM (
            SELECT DISTINCT ON (coalesce(ip_hash, '')) stars
            FROM site_ratings
            ORDER BY coalesce(ip_hash, ''), created_at DESC, id DESC
          ) latest
        ) AS avg,
        (SELECT count(*)::int FROM site_ratings WHERE comment IS NOT NULL AND length(trim(comment)) > 0) AS with_comment,
        (SELECT count(*)::int FROM site_ratings WHERE created_at > now() - interval '24 hours') AS last_24h,
        (SELECT count(*)::int FROM site_ratings WHERE created_at > now() - interval '7 days') AS last_7d
    `),
    db.execute<{ stars: number; n: number }>(sql`
      SELECT stars, count(*)::int AS n
      FROM site_ratings
      GROUP BY stars
      ORDER BY stars DESC
    `),
    db.execute<{ day: string; votes: number }>(sql`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
             count(*)::int AS votes
      FROM site_ratings
      WHERE created_at > now() - interval '30 days'
      GROUP BY 1
      ORDER BY 1
    `),
    db.execute<Comment>(sql`
      SELECT id, stars, comment, locale, ip_hash,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS created_at
      FROM site_ratings
      ORDER BY created_at DESC
      LIMIT 200
    `),
  ]);

  const a = aggRows[0];
  const aggregates: Aggregates = {
    visits: Number(a?.visits ?? 0),
    totalVotes: Number(a?.total_votes ?? 0),
    uniqueVoters: Number(a?.unique_voters ?? 0),
    avg: a?.avg !== null && a?.avg !== undefined ? Number(a.avg) : null,
    withComment: Number(a?.with_comment ?? 0),
    last24h: Number(a?.last_24h ?? 0),
    last7d: Number(a?.last_7d ?? 0),
  };

  const distribution: StarBucket[] = [5, 4, 3, 2, 1].map((s) => ({
    stars: s,
    n: Number(distRows.find((r) => Number(r.stars) === s)?.n ?? 0),
  }));

  const daily: DailyBucket[] = (dailyRows as DailyBucket[]).map((r) => ({
    day: r.day,
    votes: Number(r.votes),
  }));

  return { aggregates, distribution, daily, comments: commentRows as Comment[] };
}

async function loadAnalytics() {
  if (isDbMissing()) return null;

  const [aggRows, routeRows, clickRows] = await Promise.all([
    db.execute<{
      total_events: number;
      total_sessions: number;
      total_pageviews: number;
      pageviews_24h: number;
      avg_session_ms: number | null;
    }>(sql`
      SELECT
        (SELECT count(*)::int FROM analytics_events) AS total_events,
        (SELECT count(DISTINCT session_id)::int FROM analytics_events WHERE session_id IS NOT NULL) AS total_sessions,
        (SELECT count(*)::int FROM analytics_events WHERE type = 'pageview') AS total_pageviews,
        (SELECT count(*)::int FROM analytics_events WHERE type = 'pageview' AND created_at > now() - interval '24 hours') AS pageviews_24h,
        (
          SELECT avg(s.total)::float8 FROM (
            SELECT session_id, sum(coalesce(duration_ms, 0))::bigint AS total
            FROM analytics_events
            WHERE type = 'pageleave' AND session_id IS NOT NULL
            GROUP BY session_id
          ) s
        ) AS avg_session_ms
    `),
    db.execute<{
      route: string;
      views: number;
      unique_sessions: number;
      avg_duration_ms: number | null;
      avg_scroll_pct: number | null;
    }>(sql`
      SELECT
        route,
        sum(CASE WHEN type = 'pageview' THEN 1 ELSE 0 END)::int AS views,
        count(DISTINCT session_id)::int AS unique_sessions,
        avg(CASE WHEN type = 'pageleave' THEN duration_ms END)::float8 AS avg_duration_ms,
        avg(
          CASE WHEN type = 'pageleave' AND props ? 'maxScrollPct'
               THEN (props->>'maxScrollPct')::numeric END
        )::float8 AS avg_scroll_pct
      FROM analytics_events
      WHERE route IS NOT NULL
      GROUP BY route
      ORDER BY views DESC NULLS LAST
      LIMIT 20
    `),
    db.execute<{ name: string; route: string | null; n: number }>(sql`
      SELECT
        coalesce(props->>'name', '(unnamed)') AS name,
        route,
        count(*)::int AS n
      FROM analytics_events
      WHERE type = 'click'
      GROUP BY 1, 2
      ORDER BY n DESC
      LIMIT 25
    `),
  ]);

  const a = aggRows[0];
  const aggregates: AnalyticsAggregates = {
    totalEvents: Number(a?.total_events ?? 0),
    totalSessions: Number(a?.total_sessions ?? 0),
    totalPageviews: Number(a?.total_pageviews ?? 0),
    pageviewsLast24h: Number(a?.pageviews_24h ?? 0),
    avgSessionDurationMs:
      a?.avg_session_ms !== null && a?.avg_session_ms !== undefined
        ? Number(a.avg_session_ms)
        : null,
  };

  const routes: RouteRow[] = routeRows.map((r) => ({
    route: r.route,
    views: Number(r.views ?? 0),
    uniqueSessions: Number(r.unique_sessions ?? 0),
    avgDurationMs:
      r.avg_duration_ms !== null && r.avg_duration_ms !== undefined
        ? Number(r.avg_duration_ms)
        : null,
    avgScrollPct:
      r.avg_scroll_pct !== null && r.avg_scroll_pct !== undefined
        ? Number(r.avg_scroll_pct)
        : null,
  }));

  const clicks: ClickRow[] = clickRows.map((r) => ({
    name: r.name,
    route: r.route,
    n: Number(r.n ?? 0),
  }));

  return { aggregates, routes, clicks };
}

function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r.toString().padStart(2, "0")}s`;
}

export default async function AdminPage() {
  await connection();
  const [data, analytics] = await Promise.all([loadData(), loadAnalytics()]);

  if (!data) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="mt-4 text-sm text-muted">Database not configured.</p>
      </main>
    );
  }

  const { aggregates, distribution, daily, comments } = data;
  const distMax = Math.max(1, ...distribution.map((b) => b.n));
  const dailyMax = Math.max(1, ...daily.map((d) => d.votes));

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Admin dashboard</h1>
          <p className="text-sm text-muted">
            Site KPIs and user feedback. Auto-refresh disabled — reload to update.
          </p>
        </div>
        <span className="text-xs text-muted">
          Snapshot: {new Date().toISOString().replace("T", " ").slice(0, 16)} UTC
        </span>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Visits" value={aggregates.visits.toLocaleString()} />
        <Kpi label="Votes total" value={aggregates.totalVotes.toLocaleString()} />
        <Kpi label="Unique voters" value={aggregates.uniqueVoters.toLocaleString()} />
        <Kpi
          label="Average rating"
          value={aggregates.avg !== null ? `${aggregates.avg.toFixed(2)} / 5` : "—"}
        />
        <Kpi label="Last 24h" value={aggregates.last24h.toLocaleString()} />
        <Kpi label="Last 7d" value={aggregates.last7d.toLocaleString()} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="Star distribution">
          <ul className="space-y-1.5">
            {distribution.map((b) => {
              const pct = (b.n / distMax) * 100;
              const share = aggregates.totalVotes
                ? ((b.n / aggregates.totalVotes) * 100).toFixed(1)
                : "0.0";
              return (
                <li key={b.stars} className="flex items-center gap-3 text-sm">
                  <span className="w-8 tabular-nums">{b.stars}★</span>
                  <div className="flex-1 h-3 rounded-full bg-subtle overflow-hidden">
                    <div
                      className="h-full bg-amber-400"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-20 text-right tabular-nums text-muted">
                    {b.n} · {share}%
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title="Votes — last 30 days">
          {daily.length === 0 ? (
            <p className="text-sm text-muted">No vote in the last 30 days.</p>
          ) : (
            <div className="flex items-end gap-1 h-32">
              {daily.map((d) => {
                const pct = (d.votes / dailyMax) * 100;
                return (
                  <div
                    key={d.day}
                    className="flex-1 min-w-[4px] bg-accent/70 rounded-t"
                    style={{ height: `${pct}%` }}
                    title={`${d.day} · ${d.votes} vote${d.votes > 1 ? "s" : ""}`}
                  />
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-between text-xs text-muted mt-2">
            <span>{daily[0]?.day ?? "—"}</span>
            <span>{daily[daily.length - 1]?.day ?? "—"}</span>
          </div>
        </Card>
      </section>

      <Card title={`Comments (${comments.filter((c) => c.comment).length})`}>
        {comments.length === 0 ? (
          <p className="text-sm text-muted">No feedback yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted border-b border-border">
                  <th className="px-4 py-2 font-medium">Date (UTC)</th>
                  <th className="px-4 py-2 font-medium">Stars</th>
                  <th className="px-4 py-2 font-medium">Locale</th>
                  <th className="px-4 py-2 font-medium">IP hash</th>
                  <th className="px-4 py-2 font-medium">Comment</th>
                </tr>
              </thead>
              <tbody>
                {comments.map((c) => (
                  <tr key={c.id} className="border-b border-border/50 align-top">
                    <td className="px-4 py-2 whitespace-nowrap tabular-nums text-muted">
                      {c.created_at}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className="text-amber-500">
                        {"★".repeat(c.stars)}
                      </span>
                      <span className="text-muted">
                        {"★".repeat(5 - c.stars)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted">{c.locale ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted">
                      {c.ip_hash ? c.ip_hash.slice(0, 10) + "…" : "—"}
                    </td>
                    <td className="px-4 py-2 max-w-xl">
                      {c.comment ? (
                        <span className="whitespace-pre-wrap break-words">
                          {c.comment}
                        </span>
                      ) : (
                        <span className="text-muted italic">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {analytics ? <AnalyticsSection data={analytics} /> : null}
    </main>
  );
}

function AnalyticsSection({
  data,
}: {
  data: NonNullable<Awaited<ReturnType<typeof loadAnalytics>>>;
}) {
  const { aggregates, routes, clicks } = data;
  const routeMax = Math.max(1, ...routes.map((r) => r.views));
  const clickMax = Math.max(1, ...clicks.map((c) => c.n));
  const posthogProject = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_URL;

  return (
    <>
      <header className="pt-2">
        <h2 className="text-xl font-semibold">User analytics</h2>
        <p className="text-xs text-muted">
          First-party events ingested via /api/track. Tracking only fires after
          explicit cookie consent.
          {posthogProject ? (
            <>
              {" "}
              Session replays:{" "}
              <a
                href={posthogProject}
                target="_blank"
                rel="noreferrer"
                className="underline text-accent"
              >
                open in PostHog →
              </a>
            </>
          ) : null}
        </p>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi label="Events total" value={aggregates.totalEvents.toLocaleString()} />
        <Kpi label="Sessions" value={aggregates.totalSessions.toLocaleString()} />
        <Kpi label="Pageviews" value={aggregates.totalPageviews.toLocaleString()} />
        <Kpi
          label="Pageviews 24h"
          value={aggregates.pageviewsLast24h.toLocaleString()}
        />
        <Kpi
          label="Avg session"
          value={formatDuration(aggregates.avgSessionDurationMs)}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title={`Top routes (${routes.length})`}>
          {routes.length === 0 ? (
            <p className="text-sm text-muted">No pageview yet.</p>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left uppercase text-muted border-b border-border">
                    <th className="px-2 py-1.5 font-medium">Route</th>
                    <th className="px-2 py-1.5 font-medium text-right">Views</th>
                    <th className="px-2 py-1.5 font-medium text-right">Sessions</th>
                    <th className="px-2 py-1.5 font-medium text-right">Avg time</th>
                    <th className="px-2 py-1.5 font-medium text-right">Scroll</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((r) => (
                    <tr key={r.route} className="border-b border-border/50">
                      <td className="px-2 py-1.5 max-w-[16rem]">
                        <div className="truncate font-mono">{r.route}</div>
                        <div className="h-1 rounded-full bg-subtle mt-1 overflow-hidden">
                          <div
                            className="h-full bg-accent"
                            style={{ width: `${(r.views / routeMax) * 100}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {r.views.toLocaleString()}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                        {r.uniqueSessions.toLocaleString()}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                        {formatDuration(r.avgDurationMs)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted">
                        {r.avgScrollPct !== null
                          ? `${Math.round(r.avgScrollPct)}%`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={`Top clicked elements (${clicks.length})`}>
          {clicks.length === 0 ? (
            <p className="text-sm text-muted">No click recorded yet.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {clicks.map((c, i) => {
                const pct = (c.n / clickMax) * 100;
                return (
                  <li key={`${c.name}-${c.route}-${i}`} className="space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate font-medium">{c.name}</span>
                      <span className="tabular-nums text-muted shrink-0">
                        {c.n.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-subtle overflow-hidden">
                        <div
                          className="h-full bg-accent"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="font-mono text-[10px] text-muted truncate max-w-[10rem]">
                        {c.route ?? "—"}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>
    </>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className="text-xl font-semibold tabular-nums mt-1">{value}</div>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}
