import { listBerries } from "@/lib/db/queries";

// Route API server-side qui depend de donnees DB : pas de prerender statique au build
export const dynamic = "force-dynamic";

export async function GET() {
  const berries = await listBerries();
  return Response.json(
    {
      apricorns: ["RED", "BLUE", "GREEN", "YELLOW", "BLACK", "WHITE", "PINK"],
      berries: berries.map((b) => ({
        slug: b.slug,
        itemId: b.itemId,
        colour: b.colour,
        flavours: b.flavours,
      })),
    },
    { headers: { "cache-control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
  );
}
