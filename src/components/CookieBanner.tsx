"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getConsent, setConsent } from "@/lib/analytics/client";

/**
 * Bottom-sheet cookie banner. Shows once until the user clicks accept or
 * refuse — choice is persisted in localStorage. The banner is the ONLY
 * thing that toggles tracking on; everything else respects the stored
 * value via getConsent().
 */
export function CookieBanner() {
  const t = useTranslations("cookies");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (getConsent() === null) setVisible(true);
  }, []);

  if (!visible) return null;

  const decide = (value: "accepted" | "refused") => {
    setConsent(value);
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t("dialogLabel")}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 backdrop-blur-sm shadow-2xl"
    >
      <div className="mx-auto max-w-3xl px-4 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <p className="text-xs sm:text-sm text-muted leading-relaxed flex-1">
          {t("body")}
        </p>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            data-track="cookie-refuse"
            onClick={() => decide("refused")}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-subtle"
          >
            {t("refuse")}
          </button>
          <button
            type="button"
            data-track="cookie-accept"
            onClick={() => decide("accepted")}
            className="rounded-md bg-accent text-accent-foreground px-3 py-1.5 text-xs font-medium hover:opacity-90"
          >
            {t("accept")}
          </button>
        </div>
      </div>
    </div>
  );
}
