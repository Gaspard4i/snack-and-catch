import { listBerries, listAllSeasonings, listBaitEffects } from "@/lib/db/queries";
import { BAIT_VANILLA_ITEMS } from "@/lib/recommend/bait-effects";
import { SeasoningDexClient, type SeasoningRow } from "./SeasoningDexClient";

export const metadata = {
  title: "Seasoning Dex",
  description:
    "All Cobblemon berries and bait seasonings: dominant flavour, colour, snack-eligibility, effects.",
};

function spriteUrl(slug: string, itemId: string, fruitTexture: string | null) {
  if (fruitTexture) return `/textures/cobblemon/item/berries/${slug}.png`;
  if (itemId.startsWith("minecraft:")) {
    const name = itemId.replace("minecraft:", "");
    const safe = name === "enchanted_golden_apple" ? "golden_apple" : name;
    return `/textures/minecraft/item/${safe}.png`;
  }
  const raw = itemId.replace(/^cobblemon:/, "");
  if (raw.endsWith("_berry")) return `/textures/cobblemon/item/berries/${raw}.png`;
  return `/textures/cobblemon/item/${raw}.png`;
}

export default async function SeasoningDexPage() {
  const [berries, seasonings, baits] = await Promise.all([
    listBerries(),
    listAllSeasonings(),
    listBaitEffects(),
  ]);

  const baitItemIds = new Set(baits.map((b) => b.itemId));

  const rows: SeasoningRow[] = [];
  for (const b of berries) {
    rows.push({
      slug: b.slug,
      itemId: b.itemId,
      name: b.slug.replace(/_/g, " "),
      kind: "berry",
      snackValid: true,
      dominantFlavour: b.dominantFlavour,
      colour: b.colour,
      effectTags: b.effectTags ?? [],
      spriteUrl: spriteUrl(b.slug, b.itemId, b.fruitTexture),
      hasBaitEffects: baitItemIds.has(b.itemId),
    });
  }
  const berrySlugs = new Set(berries.map((b) => b.slug));
  for (const s of seasonings) {
    if (berrySlugs.has(s.slug)) continue;
    const isSnackValid = BAIT_VANILLA_ITEMS.has(s.itemId);
    rows.push({
      slug: s.slug,
      itemId: s.itemId,
      name: s.slug.replace(/_/g, " "),
      kind: isSnackValid ? "vanilla" : "other",
      snackValid: isSnackValid,
      dominantFlavour: null,
      colour: s.colour,
      effectTags: [],
      spriteUrl: spriteUrl(s.slug, s.itemId, null),
      hasBaitEffects: baitItemIds.has(s.itemId),
    });
  }

  // Drop "other" (non-snack-valid) — out of scope for the Seasoning Dex.
  const visible = rows.filter((r) => r.kind !== "other");

  return (
    <div className="mx-auto max-w-[1200px] px-4 sm:px-6 py-6 sm:py-10">
      <SeasoningDexClient rows={visible} />
    </div>
  );
}
