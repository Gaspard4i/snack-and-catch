"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { flush, getConsent, track } from "@/lib/analytics/client";

/**
 * Mounted once in the root layout. Hooks pageview, click, scroll-depth,
 * and unload events to the analytics buffer. Pure no-op until the user
 * accepts the cookie banner.
 *
 * Click capture: any element with `data-track="<name>"` is recorded with
 * its name. Falls back to the nearest button/link's aria-label or first
 * 60 chars of text. We never log <input> values or form payloads.
 */
export function AnalyticsTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const enterRef = useRef<{ route: string; t: number } | null>(null);
  const maxScrollRef = useRef(0);
  const consentRef = useRef<boolean>(false);

  // Refresh consent state on mount and on toggle from the banner.
  useEffect(() => {
    const sync = () => {
      consentRef.current = getConsent() === "accepted";
    };
    sync();
    window.addEventListener("sc-consent-change", sync);
    return () => window.removeEventListener("sc-consent-change", sync);
  }, []);

  // Pageview + leave timing. We fire pageleave on route change with
  // the dwell time, and again on unload via sendBeacon.
  useEffect(() => {
    const route = pathname + (searchParams?.toString() ? `?${searchParams}` : "");
    const prev = enterRef.current;

    if (prev) {
      track({
        type: "pageleave",
        route: prev.route,
        durationMs: Date.now() - prev.t,
        props: { maxScrollPct: maxScrollRef.current },
      });
    }

    track({ type: "pageview", route });
    enterRef.current = { route, t: Date.now() };
    maxScrollRef.current = 0;
  }, [pathname, searchParams]);

  // Global click handler — records data-track names and button labels.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const el = target.closest<HTMLElement>(
        "[data-track], button, a[href]",
      );
      if (!el) return;

      const name =
        el.getAttribute("data-track") ??
        el.getAttribute("aria-label") ??
        (el.textContent?.trim().slice(0, 60) || null);
      if (!name) return;

      const role =
        el.getAttribute("data-track") ? "tracked"
        : el.tagName === "A" ? "link"
        : "button";

      track({
        type: "click",
        route: enterRef.current?.route,
        props: {
          name,
          role,
          href: el.tagName === "A" ? (el as HTMLAnchorElement).getAttribute("href") : undefined,
        },
      });
    };

    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  // Form submit — record the form name / id, never the field values.
  useEffect(() => {
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement | null;
      if (!form) return;
      track({
        type: "submit",
        route: enterRef.current?.route,
        props: {
          name: form.getAttribute("data-track") ?? form.name ?? form.id ?? "form",
        },
      });
    };
    document.addEventListener("submit", onSubmit, { capture: true });
    return () => document.removeEventListener("submit", onSubmit, { capture: true });
  }, []);

  // Scroll depth — track the deepest % reached on this route.
  useEffect(() => {
    const onScroll = () => {
      const max = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      );
      const viewport = window.innerHeight;
      const scrolled = window.scrollY + viewport;
      const pct = Math.min(100, Math.round((scrolled / max) * 100));
      if (pct > maxScrollRef.current) maxScrollRef.current = pct;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Final flush — pagehide is more reliable than beforeunload, esp. on iOS.
  useEffect(() => {
    const finalize = () => {
      if (!consentRef.current) return;
      const cur = enterRef.current;
      if (cur) {
        track({
          type: "pageleave",
          route: cur.route,
          durationMs: Date.now() - cur.t,
          props: { maxScrollPct: maxScrollRef.current, final: true },
        });
      }
      flush(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") finalize();
    };
    window.addEventListener("pagehide", finalize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", finalize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
