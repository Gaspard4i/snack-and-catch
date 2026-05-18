import { listBerries } from "@/lib/db/queries";

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
