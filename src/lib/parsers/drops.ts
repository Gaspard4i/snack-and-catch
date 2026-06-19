/**
 * Extracts berry drops from a Cobblemon species JSON. A species (and each
 * of its forms) carries a `drops.entries[]` list; entries whose `item` is a
 * Cobblemon berry are what we surface on the berry page as "dropped by".
 *
 * Each entry is either a percentage drop (`percentage: 5`) or a guaranteed
 * one with a stack range (`quantityRange: "0-1"`). A handful of entries have
 * neither — those are guaranteed single drops.
 */

/** A berry an item id refers to, e.g. `cobblemon:cheri_berry`. */
const BERRY_ITEM_RE = /(?:^|:)[a-z0-9_]*berry$/;

export interface BerryDrop {
  berryItemId: string;
  /** 0–100, or null when the entry is a guaranteed quantity-range drop. */
  percentage: number | null;
  /** Verbatim `quantityRange` string (`"0-1"`) when present. */
  quantityRange: string | null;
}

function isBerryItem(item: string): boolean {
  return BERRY_ITEM_RE.test(item);
}

function readEntries(drops: unknown): BerryDrop[] {
  if (!drops || typeof drops !== "object") return [];
  const entries = (drops as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return [];
  const out: BerryDrop[] = [];
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const item = (e as { item?: unknown }).item;
    if (typeof item !== "string" || !isBerryItem(item)) continue;
    const pct = (e as { percentage?: unknown }).percentage;
    const qr = (e as { quantityRange?: unknown }).quantityRange;
    out.push({
      berryItemId: item,
      percentage: typeof pct === "number" ? pct : null,
      quantityRange: typeof qr === "string" ? qr : null,
    });
  }
  return out;
}

/**
 * Pulls every berry drop from a species `raw` JSON, scanning the base
 * `drops` block and each form's `drops` block. Forms inherit the base
 * species in the dex, so we attribute their berry drops to the same
 * species row — duplicate (berry, species) pairs are de-duplicated,
 * keeping the highest percentage.
 */
export function extractBerryDrops(raw: unknown): BerryDrop[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as { drops?: unknown; forms?: unknown };
  const collected = [...readEntries(r.drops)];
  if (Array.isArray(r.forms)) {
    for (const form of r.forms) {
      collected.push(...readEntries((form as { drops?: unknown })?.drops));
    }
  }

  const byBerry = new Map<string, BerryDrop>();
  for (const d of collected) {
    const existing = byBerry.get(d.berryItemId);
    if (!existing) {
      byBerry.set(d.berryItemId, d);
      continue;
    }
    // Keep the most generous drop: a higher percentage, or a percentage
    // over a quantity-range entry (percentage carries the dropdown signal
    // the UI sorts on).
    const a = existing.percentage ?? -1;
    const b = d.percentage ?? -1;
    if (b > a) byBerry.set(d.berryItemId, d);
  }
  return [...byBerry.values()];
}
