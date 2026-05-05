import { sql } from "drizzle-orm";
import { db, isDbMissing } from "@/lib/db/client";

/**
 * Naive sliding-window rate limit backed by analytics_events. Counts how
 * many rows the given ip_hash has produced in the last `windowSeconds`
 * and rejects if the total would exceed `max`.
 *
 * Cost: one SELECT per protected request. Indexed on (ip_hash, created_at)
 * — cheap at our scale. If we ever cross ~10 events/sec sustained, swap
 * to Vercel KV with INCR + EXPIRE.
 */
export async function rateLimitOk(opts: {
  ipHash: string;
  windowSeconds: number;
  max: number;
}): Promise<boolean> {
  if (isDbMissing()) return true;
  if (!opts.ipHash) return true;
  try {
    const rows = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n
      FROM analytics_events
      WHERE ip_hash = ${opts.ipHash}
        AND created_at > now() - (${opts.windowSeconds} || ' seconds')::interval
    `);
    const n = Number(rows[0]?.n ?? 0);
    return n < opts.max;
  } catch {
    // On DB failure, fail open — better lose a rate-limit than reject all users.
    return true;
  }
}
