import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { listBerries } from "@/lib/db/queries";
import { ItemIcon } from "@/components/ItemIcon";
import type { Apricorn, Flavour } from "@/lib/recommend/aprijuice";
import { cookAprijuice } from "@/lib/recommend/aprijuice";
import { RideStatsGrid } from "@/components/juice/RideStatsGrid";
import { SaveJuiceButton } from "@/components/juice/SaveJuiceButton";

/**
 * Cobblemon apricorn item ids keyed by the canonical colour name used
 * throughout the app. Used to render the exact block icon in the 3×3
 * crafting grid that mirrors the in-game Cooking Pot.
 */
const APRICORN_ITEM: Record<Apricorn, string> = {
  RED: "cobblemon:red_apricorn",
  YELLOW: "cobblemon:yellow_apricorn",
  GREEN: "cobblemon:green_apricorn",
  BLUE: "cobblemon:blue_apricorn",
  PINK: "cobblemon:pink_apricorn",
  BLACK: "cobblemon:black_apricorn",
  WHITE: "cobblemon:white_apricorn",
};

/**
 * Aprijuice visual quality tier. Per the wiki:
 *   <4 boost points → Plain
 *   4-7             → Tasty
 *   8+              → Delicious
 * Sprites live in /textures/aprijuice/<tier>_<colour>_aprijuice.png.
 */
function juiceTier(totalPositive: number): "plain" | "tasty" | "delicious" {
  if (totalPositive >= 8) return "delicious";
  if (totalPositive >= 4) return "tasty";
  return "plain";
}
function aprijuiceSpriteSrc(apricorn: Apricorn, tier: "plain" | "tasty" | "delicious"): string {
  return `/textures/aprijuice/${tier}_${apricorn.toLowerCase()}_aprijuice.png`;
}

const APRICORNS: Apricorn[] = [
  "RED",
  "YELLOW",
  "GREEN",
  "BLUE",
  "PINK",
  "BLACK",
  "WHITE",
];

function parseApricorn(raw: string | undefined): Apricorn | null {
  if (!raw) return null;
  const up = raw.toUpperCase() as Apricorn;
  return APRICORNS.includes(up) ? up : null;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ apricorn?: string; berries?: string }>;
}): Promise<Metadata> {
  const p = await searchParams;
  const apricorn = parseApricorn(p.apricorn) ?? "RED";
  return { title: `${apricorn} Aprijuice` };
}

export default async function JuiceRecipePage({
  searchParams,
}: {
  searchParams: Promise<{ apricorn?: string; berries?: string }>;
}) {
  const p = await searchParams;
  const apricorn = parseApricorn(p.apricorn) ?? "RED";
  const slugs = (p.berries ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);

  const [t, tc, allBerries] = await Promise.all([
    getTranslations("juice"),
    getTranslations("common"),
    listBerries(),
  ]);

  const bySlug = new Map(allBerries.map((b) => [b.slug, b]));
  const berries = slugs
    .map((s) => bySlug.get(s))
    .filter((b): b is NonNullable<typeof b> => Boolean(b));

  const result = cookAprijuice({
    apricorn,
    berries: berries.map((b) => ({
      slug: b.slug,
      itemId: b.itemId,
      flavours: b.flavours as Partial<Record<Flavour, number>>,
    })),
  });

  // Quality tier (Plain / Tasty / Delicious) = sum of positive stat
  // boosts from the produced juice.
  const totalPositive = (Object.values(result.statBoosts) as number[]).reduce(
    (s, v) => s + (v > 0 ? v : 0),
    0,
  );
  const tier = juiceTier(totalPositive);
  const juiceSprite = aprijuiceSpriteSrc(apricorn, tier);

  // Shopping list: dedup ingredients with counts.
  const counts = new Map<string, { itemId: string; slug: string; count: number }>();
  for (const b of berries) {
    const prev = counts.get(b.slug);
    if (prev) prev.count += 1;
    else counts.set(b.slug, { itemId: b.itemId, slug: b.slug, count: 1 });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <Link
        href="/juice"
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("backToJuice")}
      </Link>

      <header>
        <div className="text-[10px] uppercase tracking-widest text-muted">
          {t("recipeStep")}
        </div>
        <h1 className="mt-1 text-2xl sm:text-3xl font-semibold tracking-tight">
          {t("apricornHeading", { kind: apricorn })}
        </h1>
        <p className="mt-2 text-sm text-muted">{t("recipeIntro")}</p>
        <SaveJuiceButton apricorn={apricorn} berrySlugs={berries.map((b) => b.slug)} />
      </header>

      {/* Cobblemon cooking-pot interface — 1:1 copy of the wiki layout.
          The GIF at /textures/ui/cooking_interface.gif draws every slot
          border; our job is to overlay the right items in the right
          positions using the same .interface .cooking-interface classes
          as the wiki. */}
      <section className="rounded-xl border border-border bg-card p-4 sm:p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted mb-3">
          {t("craftingInterface")}
        </h2>
        <div className="flex justify-center">
          <CookingInterface
            apricornItem={APRICORN_ITEM[apricorn]}
            berries={berries}
            juiceSprite={juiceSprite}
            tier={tier}
          />
        </div>

        {/* Tier label below the panel so the user knows what quality
            comes out of this recipe. */}
        <div className="mt-3 text-center text-xs">
          <span className="text-muted">{t("qualityLabel")}: </span>
          <span
            className={`font-mono uppercase tracking-wide ${
              tier === "delicious"
                ? "text-amber-600 dark:text-amber-400"
                : tier === "tasty"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted"
            }`}
          >
            {tier}
          </span>
          <span className="text-muted"> · {totalPositive} pts</span>
        </div>
      </section>

      {/* Step-by-step how-to. */}
      <section className="rounded-xl border border-border bg-card p-4 sm:p-6 space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
          {t("howto")}
        </h2>
        <ol className="space-y-2 text-sm list-decimal list-inside">
          <li>{t("howtoStep1")}</li>
          <li>
            {t("howtoStep2", {
              apricorn: t("apricornColour", { kind: apricorn }),
            })}
          </li>
          <li>{t("howtoStep3")}</li>
          <li>
            {berries.length > 0 ? (
              <>
                {t("howtoStep4")}{" "}
                {[...counts.values()].map((c, i, arr) => (
                  <span key={c.slug}>
                    <span className="inline-flex items-center gap-1 align-middle">
                      {c.count > 1 && (
                        <span className="font-mono text-xs">{c.count}×</span>
                      )}
                      <ItemIcon id={c.itemId} size={18} />
                      <span className="capitalize">
                        {c.slug.replaceAll("_", " ")}
                      </span>
                    </span>
                    {i < arr.length - 1 ? ", " : ""}
                  </span>
                ))}
              </>
            ) : (
              t("howtoStep4NoSeasoning")
            )}
          </li>
          <li>{t("howtoStep5")}</li>
        </ol>
      </section>

      {/* Ride stat result. */}
      <section className="rounded-xl border border-border bg-card p-4 sm:p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted mb-3">
          {t("rideBoosts")}
        </h2>
        <RideStatsGrid stats={result.statBoosts} />
        {result.summary.length === 0 && (
          <p className="mt-3 text-sm text-muted">{t("noNetBoost")}</p>
        )}
      </section>
    </div>
  );
}

/**
 * Pure-CSS cooking-pot GUI. No background image: every slot is a
 * 40×40 bordered box we stamp out in a grid. Matches the reference mock
 * (3×3 ingredient grid, 3 seasoning slots on the right, arrow, result
 * slot with the finished aprijuice sprite).
 */
type BerryRow = { slug: string; itemId: string };

function CookingInterface({
  apricornItem,
  berries,
  juiceSprite,
  tier,
}: {
  apricornItem: string;
  berries: BerryRow[];
  juiceSprite: string;
  tier: "plain" | "tasty" | "delicious";
}) {
  // Top row of the 3x3 = apricorn + Pep-Up Flower + Energy Root.
  // Rows 2 and 3 stay empty (this is an Aprijuice shapeless recipe —
  // only the 3 fixed ingredients fit in row 0 of the cooking pot).
  const topRow = [
    apricornItem,
    "cobblemon:pep_up_flower",
    "cobblemon:energy_root",
  ];
  const emptySix = Array.from({ length: 6 }, () => null);

  return (
    <div className="cooking-panel">
      {/* 3×3 ingredient grid (top row filled). */}
      <div className="cooking-grid">
        {topRow.map((id, i) => (
          <div className="cooking-slot" key={`top-${i}`} title={id}>
            <ItemIcon id={id} size={32} />
          </div>
        ))}
        {emptySix.map((_, i) => (
          <div className="cooking-slot" key={`empty-${i}`} />
        ))}
      </div>

      {/* Seasoning column. */}
      <div className="cooking-seasoning">
        {Array.from({ length: 3 }).map((_, i) => {
          const b = berries[i];
          return (
            <div className="cooking-slot" key={i} title={b?.slug ?? ""}>
              {b && <ItemIcon id={b.itemId} size={32} />}
            </div>
          );
        })}
      </div>

      <ArrowRight className="cooking-arrow h-6 w-6" aria-hidden />

      {/* Result slot — the finished aprijuice with its quality tier. */}
      <div
        className="cooking-slot"
        title={`${tier} aprijuice`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={juiceSprite} alt={`${tier} aprijuice`} />
      </div>
    </div>
  );
}

