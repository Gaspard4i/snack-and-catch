import { eq, sql } from "drizzle-orm";
import { db, isDbMissing, schema } from "@/lib/db/client";

/**
 * Returns aggregated site stats for the home page counter.
 *
 * Counts:
 *   - `visits`            — raw page-load counter (kept on site_stats).
 *   - `ratingCount`       — every recorded vote, one row in site_ratings
 *                           per submission. An IP that voted four times
 *                           contributes four to this total.
 *   - `uniqueRaterCount`  — number of distinct ip_hash values, i.e. the
 *                           population that actually shaped the average.
 *   - `ratingAverage`     — average over EACH IP's most recent vote
 *                           (one effective vote per ip_hash). Anonymous
 *                           submissions (ip_hash = '') collapse into a
 *                           single bucket — they're a known limitation
 *                           of running behind a stripped reverse proxy.
 *
 * Cache 30s on the CDN. Any failure returns zeros instead of a 500.
 */
export async function GET() {
  if (isDbMissing()) {
    return Response.json(emptyStats());
  }
  try {
    const rows = await db
      .select()
      .from(schema.siteStats)
      .where(eq(schema.siteStats.id, 1))
      .limit(1);
    const row = rows[0];
    const visits = row?.visits ?? 0;
    // Aggregate average over the latest vote per ip_hash. We use a
    // window function inside a subquery so the heavy lifting happens in
    // Postgres rather than in JS — fast even with thousands of ratings
    // because of the `site_ratings_created_idx` index.
    const aggRows = await db.execute<{
      vote_count: number;
      unique_rater_count: number;
      rating_average: number | null;
    }>(sql`
      WITH latest AS (
        SELECT
          stars,
          coalesce(ip_hash, '') AS bucket,
          row_number() OVER (
            PARTITION BY coalesce(ip_hash, '')
            ORDER BY created_at DESC, id DESC
          ) AS rn
        FROM site_ratings
      )
      SELECT
        (SELECT count(*)::int FROM site_ratings) AS vote_count,
        (SELECT count(*)::int FROM latest WHERE rn = 1) AS unique_rater_count,
        avg(stars)::float8 AS rating_average
      FROM latest
      WHERE rn = 1
    `);
    const agg = aggRows[0] ?? null;
    const voteCount = Number(agg?.vote_count ?? 0);
    const uniqueRaterCount = Number(agg?.unique_rater_count ?? 0);
    const average = agg?.rating_average ? Number(agg.rating_average) : 0;
    return Response.json(
      {
        visits,
        // `ratingCount` is kept for backwards compatibility with old UI
        // builds that read it; new code should use `voteCount` /
        // `uniqueRaterCount` for clearer semantics.
        ratingCount: voteCount,
        voteCount,
        uniqueRaterCount,
        ratingAverage: Number(average.toFixed(2)),
      },
      { headers: { "cache-control": "public, s-maxage=30" } },
    );
  } catch (err) {
    console.warn("[site/stats] query failed:", err instanceof Error ? err.message : err);
    return Response.json(emptyStats());
  }
}

function emptyStats() {
  return {
    visits: 0,
    ratingCount: 0,
    voteCount: 0,
    uniqueRaterCount: 0,
    ratingAverage: 0,
  };
}
