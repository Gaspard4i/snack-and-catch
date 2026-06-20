-- Rebuild berry_drops from species.raw drop tables (base + per-form).
--
-- This is the production path: the standalone web image doesn't ship the
-- ingest TypeScript toolchain, but the gazai database has every species.raw,
-- so we derive the mapping in pure SQL. It mirrors extractBerryDrops():
--   * item ids ending in "berry" (cobblemon:cheri_berry, …; not berry_juice)
--   * percentage drops keep their chance, quantity-range drops keep the range
--   * (berry, species) deduped, keeping the highest percentage
--
-- Run inside snack-db:  psql -U snack -d snack -f berry_drops.sql

BEGIN;

TRUNCATE TABLE berry_drops RESTART IDENTITY;

WITH all_entries AS (
  SELECT s.id AS species_id,
         e->>'item' AS berry_item_id,
         CASE WHEN jsonb_typeof(e->'percentage') = 'number'
              THEN (e->>'percentage')::real END AS percentage,
         CASE WHEN jsonb_typeof(e->'quantityRange') = 'string'
              THEN e->>'quantityRange' END AS quantity_range
  FROM species s,
       LATERAL jsonb_array_elements(s.raw->'drops'->'entries') AS e
  WHERE jsonb_typeof(s.raw->'drops'->'entries') = 'array'
    AND (e->>'item') ~ '(^|:)[a-z0-9_]*berry$'

  UNION ALL

  SELECT s.id AS species_id,
         e->>'item' AS berry_item_id,
         CASE WHEN jsonb_typeof(e->'percentage') = 'number'
              THEN (e->>'percentage')::real END AS percentage,
         CASE WHEN jsonb_typeof(e->'quantityRange') = 'string'
              THEN e->>'quantityRange' END AS quantity_range
  FROM species s,
       LATERAL jsonb_array_elements(s.raw->'forms') AS f,
       LATERAL jsonb_array_elements(f->'drops'->'entries') AS e
  WHERE jsonb_typeof(s.raw->'forms') = 'array'
    AND jsonb_typeof(f->'drops'->'entries') = 'array'
    AND (e->>'item') ~ '(^|:)[a-z0-9_]*berry$'
),
ranked AS (
  SELECT species_id, berry_item_id, percentage, quantity_range,
         ROW_NUMBER() OVER (
           PARTITION BY berry_item_id, species_id
           ORDER BY percentage DESC NULLS LAST
         ) AS rn
  FROM all_entries
)
INSERT INTO berry_drops (berry_item_id, species_id, percentage, quantity_range)
SELECT berry_item_id, species_id, percentage, quantity_range
FROM ranked WHERE rn = 1;

SELECT count(*) AS rows, count(DISTINCT berry_item_id) AS berries FROM berry_drops;

COMMIT;
