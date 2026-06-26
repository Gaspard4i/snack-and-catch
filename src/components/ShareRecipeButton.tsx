"use client";

import { Check, Link2, Share2 } from "lucide-react";
import { useState } from "react";

/**
 * Shares the CURRENT page URL — including the maker state encoded in its
 * query string — so the recipient opens the exact same recipe + filters.
 * Uses the Web Share API where available (native sheet on mobile), falling
 * back to a clipboard copy with a "Link copied" confirmation.
 *
 * Unlike the app-wide ShareButton (which always shares the site root), this
 * one reads `window.location.href` at click time so whatever the user has
 * configured travels with the link.
 */
export function ShareRecipeButton({
  title,
  text,
  className = "",
  label = "Share",
}: {
  title: string;
  text: string;
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    if (typeof window === "undefined") return;
    const url = window.location.href;

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Nothing more we can do; the URL bar already reflects the state.
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-subtle transition-colors ${className}`}
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
          <span>Link copied</span>
        </>
      ) : (
        <>
          <Share2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{label}</span>
          <Link2 className="h-3 w-3 text-muted shrink-0" aria-hidden />
        </>
      )}
    </button>
  );
}
