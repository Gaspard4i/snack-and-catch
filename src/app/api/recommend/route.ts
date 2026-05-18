import { NextRequest } from "next/server";
import {
  getSpeciesBySlug,
  listBaitEffects,
  listSpawnsForSpecies,
} from "@/lib/db/queries";
import { topBaits } from "@/lib/recommend/bait";

type Intent = "spawn" | "bait" | "all";

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("pokemon")?.trim().toLowerCase();
  const intent = (req.nextUrl.searchParams.get("intent") ?? "all") as Intent;

  if (!slug) return err(400, "missing ?pokemon=<slug>");
  const species = await getSpeciesBySlug(slug);
  if (!species) return err(404, `unknown pokemon: ${slug}`);

  const body: Record<string, unknown> = {
    pokemon: {
      slug: species.slug,
      name: species.name,
      dexNo: species.dexNo,
      types: [species.primaryType, species.secondaryType].filter(Boolean),
      catchRate: species.catchRate,
    },
  };

  if (intent === "spawn" || intent === "all") {
    const spawns = await listSpawnsForSpecies(species.id);
    body.spawns = spawns.map((s) => ({
      bucket: s.bucket,
      weight: s.weight,
      level: { min: s.levelMin, max: s.levelMax },
      biomes: s.biomes,
      condition: s.condition,
      source: {
        kind: s.sourceKind,
        name: s.sourceName,
        url: s.sourceUrl,
      },
    }));
  }

  if (intent === "bait" || intent === "all") {
    const baits = await listBaitEffects();
    body.baits = topBaits(baits, {
      primaryType: species.primaryType,
      preferredFlavours: species.preferredFlavours,
      limit: 8,
    });
  }

  return ok(body);
}
