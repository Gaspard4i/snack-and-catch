/**
 * Standalone re-ingest of the berry_drops table from species already in the
 * DB. No repo clone needed — it reads species.raw. Safe to run inside the
 * production container against the gazai database.
 *
 *   pnpm ingest:berry-drops          (local)
 *   pnpm ingest:berry-drops:prod     (gazai, via the container)
 */
import { ingestBerryDrops } from "../src/lib/ingest/berry-drops";

ingestBerryDrops()
  .then((r) => {
    console.log(`[berry-drops] rows=${r.rows} berries=${r.berries}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
