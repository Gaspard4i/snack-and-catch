import { db, schema } from "@/lib/db/client";
import { extractBerryDrops } from "@/lib/parsers/drops";

/**
 * Rebuild the berry_drops table from species already in the DB. Every
 * `species.raw` carries its `drops` block (base + per-form), so we derive
 * the berry → Pokémon drop mapping without touching the Cobblemon repo.
 *
 * Kept dependency-free (only db + the pure parser) so it runs inside the
 * standalone production image, not just the full ingest toolchain.
 */
export async function ingestBerryDrops(): Promise<{ rows: number; berries: number }> {
  const rows = await db
    .select({ id: schema.species.id, raw: schema.species.raw })
    .from(schema.species);
  const values: Array<typeof schema.berryDrops.$inferInsert> = [];
  for (const s of rows) {
    for (const d of extractBerryDrops(s.raw)) {
      values.push({
        berryItemId: d.berryItemId,
        speciesId: s.id,
        percentage: d.percentage,
        quantityRange: d.quantityRange,
      });
    }
  }
  await db.delete(schema.berryDrops);
  for (let i = 0; i < values.length; i += 500) {
    await db
      .insert(schema.berryDrops)
      .values(values.slice(i, i + 500))
      .onConflictDoNothing();
  }
  return {
    rows: values.length,
    berries: new Set(values.map((v) => v.berryItemId)).size,
  };
}
