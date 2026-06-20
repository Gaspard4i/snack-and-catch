/**
 * Cobblemon berries can be obtained by mutation: planting two parent
 * berries next to each other on tilled soil gives a chance to grow a third.
 *
 * Each berry JSON declares its crosses as
 *   "mutations": { "<otherParentItemId>": "<resultItemId>", ... }
 * where the berry that owns the file is one parent, the key is the other
 * parent, and the value is what they produce.
 *
 * For a berry page we want the inverse: which parent pairs produce THIS
 * berry. We scan every berry's mutations, collect the {A, B} pairs whose
 * result is the target, and de-duplicate unordered pairs (A+B === B+A,
 * which upstream lists twice).
 */

export interface BerrySource {
  /** `slug`, `itemId` and `raw.mutations` of a berry. */
  slug: string;
  itemId: string;
  mutations: Record<string, string> | null | undefined;
}

export interface MutationPair {
  /** The two parent item ids, sorted for stable de-dup and display. */
  parents: [string, string];
}

/**
 * Returns the de-duplicated parent pairs that mutate into `targetItemId`.
 * Self-pairs (a berry crossing with itself) are kept if upstream declares
 * them; only the A+B / B+A ordering duplication is collapsed.
 */
export function mutationsProducing(
  targetItemId: string,
  berries: BerrySource[],
): MutationPair[] {
  const seen = new Set<string>();
  const out: MutationPair[] = [];
  for (const berry of berries) {
    const mutations = berry.mutations;
    if (!mutations) continue;
    for (const [otherParent, result] of Object.entries(mutations)) {
      if (result !== targetItemId) continue;
      const parents: [string, string] = [berry.itemId, otherParent].sort() as [
        string,
        string,
      ];
      const key = parents.join("+");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ parents });
    }
  }
  return out;
}
