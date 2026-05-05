"use client";

import { useEffect } from "react";
import { getConsent, isAdmin } from "@/lib/analytics/client";

/**
 * Lazy-loads PostHog only after the user accepts the cookie banner. The
 * NEXT_PUBLIC_POSTHOG_KEY env var must be set; if absent, this is a
 * no-op and we just rely on first-party analytics.
 *
 * PostHog brings session replay, funnels, and feature flags. Configured
 * for the EU cloud host (eu.i.posthog.com) so personal data stays in EU.
 */
export function PostHogLoader() {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;

    let loaded = false;
    const load = async () => {
      if (loaded) return;
      if (getConsent() !== "accepted") return;
      // Admins are excluded from session replay too — same reason as the
      // first-party tracker. Their sessions would dominate the funnel.
      if (isAdmin()) return;
      loaded = true;
      const { default: posthog } = await import("posthog-js");
      posthog.init(key, {
        api_host:
          process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com",
        person_profiles: "identified_only",
        // Capture replay only on accept — never before.
        session_recording: {
          maskAllInputs: true,
          maskTextSelector: "[data-private]",
        },
        capture_pageview: true,
        capture_pageleave: true,
        autocapture: true,
      });
    };

    load();
    const onChange = () => load();
    window.addEventListener("sc-consent-change", onChange);
    return () => window.removeEventListener("sc-consent-change", onChange);
  }, []);

  return null;
}
