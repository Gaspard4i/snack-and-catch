import { NextRequest } from "next/server";
import { listBerries } from "@/lib/db/queries";
import type {
  Apricorn,
  BerrySeasoning,
  Flavour,
  RidingStat,
} from "@/lib/recommend/aprijuice";
import {
  achievableMaxPerStat,
  achievableVectors,
  suggestAprijuice,
  totalAchievableBudget,
  type StatVector,
  type TargetBoosts,
} from "@/lib/recommend/aprijuice-suggest";

type Body = {
  /** Point allocation per ride stat — what the user wants. */
  target?: Partial<Record<RidingStat, number>>;
  /** Which berry slugs the user owns. If omitted or empty, we use all. */
  ownedBerrySlugs?: string[];
  /** Which apricorn colours the user owns. If omitted, all 7 are allowed. */
  ownedApricorns?: Apricorn[];
  /** Stats the user doesn't care about — excluded from scoring. */
  ignoredStats?: RidingStat[];
  limit?: number;
  /** If true, server also returns the full achievable stat-vector set
   *  so the client can compute constrained caps on the fly as the user
   *  drags the sliders. */
  includeVectors?: boolean;
};

const ALL_APRICORNS: Apricorn[] = [
  "RED",
  "YELLOW",
  "GREEN",
  "BLUE",
  "PINK",
  "BLACK",
  "WHITE",
];

export async function POST(req: NextRequest) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const rows = await listBerries();
  const owned = body.ownedBerrySlugs && body.ownedBerrySlugs.length > 0
    ? new Set(body.ownedBerrySlugs)
    : null;
  const pool: BerrySeasoning[] = rows
    .filter((b) => (owned ? owned.has(b.slug) : true))
    .map((b) => ({
      slug: b.slug,
      itemId: b.itemId,
      flavours: b.flavours as Partial<Record<Flavour, number>>,
    }));

  const apricorns = body.ownedApricorns?.length
    ? body.ownedApricorns
    : ALL_APRICORNS;

  // Pre-compute the achievable set once; everything derives from it.
  const vectors: StatVector[] = achievableVectors(pool, apricorns);
  const caps = achievableMaxPerStat(vectors);
  const budget = totalAchievableBudget(vectors);

  // Normalise target.
  const target: TargetBoosts = { ...(body.target ?? {}) };
  for (const k of Object.keys(target) as RidingStat[]) {
    if (!target[k] || target[k]! <= 0) delete target[k];
  }

  const suggestions =
    Object.keys(target).length === 0
      ? []
      : suggestAprijuice(pool, target, {
          limit: Math.min(Math.max(body.limit ?? 6, 1), 20),
          apricorns,
          ignoredStats: body.ignoredStats,
        });

  return Response.json(
    {
      suggestions,
      budget,
      caps,
      vectors: body.includeVectors ? vectors : undefined,
    },
    { headers: { "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
