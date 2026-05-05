"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Star } from "lucide-react";

type Props = {
  /** Called on successful submit. Caller decides what to do next
   *  (e.g. close a modal, show a thank-you message). */
  onSubmitted?: () => void;
  /** Show the comment box. Default true — hide it when the host layout
   *  already has a place for freeform feedback. */
  showComment?: boolean;
  /** Extra Tailwind classes for the outer <div>. */
  className?: string;
};

const STORAGE_KEY = "satisfaction-dismissed";

/**
 * Shared 1-5 star rating form. Used by the SatisfactionModal and the
 * FeedbackCard. Stores the submission via POST /api/site/rate and sets
 * the local flag so the 10-minute modal never bothers the user again.
 */
export function RatingForm({
  onSubmitted,
  showComment = true,
  className = "",
}: Props) {
  const t = useTranslations("satisfaction");
  const locale = useLocale();
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const submit = async () => {
    if (stars < 1 || submitting) return;
    setSubmitting(true);
    try {
      await fetch("/api/site/rate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stars, comment: comment.trim() || null, locale }),
      });
      try {
        localStorage.setItem(STORAGE_KEY, "rated");
      } catch {
        /* private mode */
      }
      // Tell the home stats badge to re-fetch so the new vote shows up
      // without a page reload. SiteStatsBadge listens for this event.
      try {
        window.dispatchEvent(new CustomEvent("site-rating-submitted"));
      } catch {
        /* SSR or hostile environment */
      }
      setSubmitted(true);
      onSubmitted?.();
    } catch {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <p className={`text-sm text-center py-2 ${className}`}>{t("thanks")}</p>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <div
        className="flex items-center justify-center gap-1"
        role="radiogroup"
        aria-label={t("rateLabel")}
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const active = (hover || stars) >= n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={stars === n}
              aria-label={`${n} / 5`}
              onClick={() => setStars(n)}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              className="size-9 flex items-center justify-center transition-transform hover:scale-110"
            >
              <Star
                className={`h-6 w-6 ${
                  active ? "text-amber-400 fill-amber-400" : "text-muted"
                }`}
              />
            </button>
          );
        })}
      </div>

      {showComment && (
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t("commentPlaceholder")}
          rows={2}
          maxLength={1000}
          className="w-full rounded-md border border-border bg-subtle px-3 py-2 text-sm outline-none focus:border-accent resize-none"
        />
      )}

      <button
        type="button"
        onClick={submit}
        disabled={stars < 1 || submitting}
        className="w-full rounded-md bg-accent text-accent-foreground px-4 py-2 text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
      >
        {submitting ? t("submitting") : t("submit")}
      </button>
    </div>
  );
}
