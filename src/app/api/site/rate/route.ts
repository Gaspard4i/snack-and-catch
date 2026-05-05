import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { db, isDbMissing, schema } from "@/lib/db/client";

type Body = {
  stars?: number;
  comment?: string | null;
  locale?: string | null;
};

/**
 * Record a satisfaction rating (1-5 stars + optional comment) and bump
 * the aggregate counter. If the DB is unavailable we still return 200
 * so the client's thank-you flow works; the rating is just dropped.
 */
export async function POST(req: NextRequest) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const stars = Number(body.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return Response.json({ error: "stars must be 1-5" }, { status: 400 });
  }
  const comment =
    typeof body.comment === "string" && body.comment.trim()
      ? body.comment.trim().slice(0, 1000)
      : null;
  const locale = typeof body.locale === "string" ? body.locale.slice(0, 10) : null;

  if (isDbMissing()) return Response.json({ ok: true });

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "";
  const secret = process.env.RATING_SALT ?? "snack-and-catch";
  const ipHash = createHash("sha256").update(`${secret}:${ip}`).digest("hex");

  try {
    // Record every submission as its own row. The aggregate stats route
    // computes the public average from EACH ip_hash's most recent vote,
    // so re-rating doesn't double-count toward the average — but the
    // raw vote_count keeps growing so we can show "X votes total" too.
    await db.insert(schema.siteRatings).values({
      stars,
      comment,
      locale,
      ipHash,
    });
  } catch (err) {
    console.warn("[site/rate] failed:", err instanceof Error ? err.message : err);
  }

  return Response.json({ ok: true });
}
