import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { checkBotId } from "botid/server";
import { db, isDbMissing, schema } from "@/lib/db/client";
import { looksLikeBot } from "@/lib/security/bot-filter";
import { rateLimitOk } from "@/lib/security/rate-limit";

/** Allowed event types — anything else is dropped silently. */
const TYPES = new Set([
  "pageview",
  "pageleave",
  "click",
  "submit",
  "scroll",
  "custom",
]);

const MAX_BATCH = 50;
const MAX_PROPS_BYTES = 4_000;

type Incoming = {
  type?: string;
  route?: string | null;
  sessionId?: string | null;
  locale?: string | null;
  referrer?: string | null;
  durationMs?: number | null;
  props?: Record<string, unknown> | null;
};

/**
 * Ingest endpoint for analytics events. Accepts:
 *   - JSON body `{ events: Incoming[] }` (fetch / sendBeacon JSON)
 *   - JSON body of a single Incoming
 *   - text/plain body containing JSON (sendBeacon defaults to text)
 *
 * No consent check here — the client sends nothing without consent. We
 * still validate types and clamp sizes server-side because the network
 * is hostile.
 */
export async function POST(req: NextRequest) {
  if (isDbMissing()) return Response.json({ ok: true });

  // 0. Admin sessions are dropped on the server too. The client tracker
  //    already short-circuits, but a stale tab from before the admin
  //    cookie was set could still fire — kill those silently.
  if (req.cookies.get("sc-admin")?.value === "1") {
    return Response.json({ ok: true }, { status: 202 });
  }

  // 1. UA filter — drops curl/wget/python and SEO crawlers in O(1).
  const userAgent = req.headers.get("user-agent");
  if (looksLikeBot(userAgent)) {
    return Response.json({ ok: true }, { status: 202 });
  }

  // 2. Vercel BotID — verifies a signed proof issued by the in-page client.
  //    No-op in local dev (returns isBot: false). Active on Vercel.
  try {
    const verification = await checkBotId();
    if (verification.isBot) {
      return Response.json({ ok: true }, { status: 202 });
    }
  } catch {
    // BotID unavailable (e.g. self-hosted) — fall through to remaining defenses.
  }

  let raw: unknown;
  try {
    const text = await req.text();
    if (!text) return Response.json({ ok: true });
    raw = JSON.parse(text);
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const events: Incoming[] = Array.isArray((raw as { events?: unknown })?.events)
    ? ((raw as { events: Incoming[] }).events ?? [])
    : Array.isArray(raw)
      ? (raw as Incoming[])
      : [raw as Incoming];

  if (events.length === 0) return Response.json({ ok: true });
  if (events.length > MAX_BATCH) events.length = MAX_BATCH;

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "";
  const secret = process.env.RATING_SALT ?? "snack-and-catch";
  const ipHash = createHash("sha256").update(`${secret}:${ip}`).digest("hex");
  const truncatedUa = userAgent?.slice(0, 300) ?? null;

  // 3. Rate-limit — 120 events / minute / IP. A normal session emits
  //    ~5-15 events per minute; anything 10× that is a script.
  const allowed = await rateLimitOk({ ipHash, windowSeconds: 60, max: 120 });
  if (!allowed) {
    return Response.json({ error: "rate limited" }, { status: 429 });
  }

  const rows = events
    .map((e) => normalize(e, ipHash, truncatedUa))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return Response.json({ ok: true });

  try {
    await db.insert(schema.analyticsEvents).values(rows);
  } catch (err) {
    console.warn("[track] insert failed:", err instanceof Error ? err.message : err);
  }

  return Response.json({ ok: true });
}

function normalize(e: Incoming, ipHash: string, ua: string | null) {
  if (typeof e?.type !== "string" || !TYPES.has(e.type)) return null;
  const route = typeof e.route === "string" ? e.route.slice(0, 500) : null;
  const sessionId =
    typeof e.sessionId === "string" ? e.sessionId.slice(0, 64) : null;
  const locale = typeof e.locale === "string" ? e.locale.slice(0, 10) : null;
  const referrer =
    typeof e.referrer === "string" ? e.referrer.slice(0, 500) : null;
  const durationMs =
    typeof e.durationMs === "number" && Number.isFinite(e.durationMs)
      ? Math.max(0, Math.min(24 * 3600 * 1000, Math.round(e.durationMs)))
      : null;

  let props: Record<string, unknown> = {};
  if (e.props && typeof e.props === "object" && !Array.isArray(e.props)) {
    const json = JSON.stringify(e.props);
    if (json.length <= MAX_PROPS_BYTES) {
      props = e.props;
    }
  }

  return {
    type: e.type,
    route,
    sessionId,
    ipHash,
    locale,
    referrer,
    userAgent: ua,
    props,
    durationMs,
  };
}
