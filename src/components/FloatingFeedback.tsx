"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MessageCircleHeart, X } from "lucide-react";
import {
  DISCORD_HANDLE,
  DiscordIcon,
  GITHUB_ISSUES_URL,
  GithubIcon,
} from "./Feedback";
import { RatingForm } from "./RatingForm";
import { ShareButton } from "./ShareButton";

/**
 * Always-visible floating action button. Bottom-right on desktop, above
 * the mobile nav on phones. Opens a small popover with Discord + GitHub
 * contact options.
 */
export function FloatingFeedback() {
  const t = useTranslations("feedback");
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed z-40 bottom-[calc(env(safe-area-inset-bottom)+3.75rem)] right-4 sm:bottom-4 sm:right-4">
      {open ? (
        <div
          role="dialog"
          aria-label={t("title")}
          className="w-72 rounded-xl border border-border bg-card shadow-xl p-3 space-y-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <MessageCircleHeart
                className="h-4 w-4 text-accent shrink-0"
                aria-hidden
              />
              <h3 className="text-sm font-semibold">{t("title")}</h3>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("close")}
              className="size-7 rounded-md hover:bg-subtle flex items-center justify-center"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <p className="text-xs text-muted leading-relaxed">{t("bodyShort")}</p>
          <RatingForm showComment />
          <div className="pt-1 border-t border-border space-y-1.5">
            <ShareButton className="mt-2 w-full" />
            <a
              href={GITHUB_ISSUES_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs hover:bg-subtle transition-colors"
            >
              <GithubIcon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{t("ctaGithub")}</span>
            </a>
            <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
              <DiscordIcon className="h-4 w-4 shrink-0 text-[#5865F2]" />
              <span className="flex-1 text-muted">Discord DM:</span>
              <code className="font-mono text-foreground">{DISCORD_HANDLE}</code>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("open")}
          className="inline-flex items-center gap-2 rounded-full bg-accent text-accent-foreground px-4 py-2.5 text-xs font-medium shadow-lg hover:opacity-90 transition-opacity"
        >
          <MessageCircleHeart className="h-4 w-4" aria-hidden />
          <span>{t("buttonLabel")}</span>
        </button>
      )}
    </div>
  );
}
