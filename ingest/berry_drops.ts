/**
 * Standalone re-ingest of the berry_drops table from species already in the
 * DB. Run after a normal ingest when you only need to refresh the
 * berry → Pokémon drop mapping without a full reset.
 *
 *   pnpm ingest:berry-drops          (local)
 *   pnpm ingest:berry-drops:prod     (production)
 */
import { ingestBerryDrops } from "./reset";

ingestBerryDrops()
  .then(() => {
    console.log("[berry-drops] done");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
