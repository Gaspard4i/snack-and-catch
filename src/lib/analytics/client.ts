"use client";

/**
 * Lightweight first-party analytics. No-op until the user accepts the
 * cookie banner — `getConsent()` returns "accepted" only after an
 * explicit click on the accept button.
 *
 * Buffers events in memory and flushes on:
 *   - every 8 events (small batches keep ingest cheap)
 *   - every 15s (idle flush)
 *   - visibilitychange → hidden / pagehide (final flush via sendBeacon)
 */

const CONSENT_KEY = "sc-analytics-consent-v1";
const SESSION_KEY = "sc-analytics-session";

export type Consent = "accepted" | "refused";

type EventInput = {
  type: "pageview" | "pageleave" | "click" | "submit" | "scroll" | "custom";
  route?: string;
  durationMs?: number;
  props?: Record<string, unknown>;
};

type QueuedEvent = EventInput & {
  sessionId: string;
  locale?: string;
  referrer?: string;
};

let buffer: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function getConsent(): Consent | null {
  if (typeof localStorage === "undefined") return null;
  const v = localStorage.getItem(CONSENT_KEY);
  return v === "accepted" || v === "refused" ? v : null;
}

/** True when the current browser has been authenticated as admin. The
 *  cookie is set by middleware.ts after successful Basic Auth on /admin
 *  and persists for 30 days. We never track admin sessions — they would
 *  pollute the KPIs (long dwell on /admin, internal button clicks). */
export function isAdmin(): boolean {
  if (typeof document === "undefined") return false;
  return /(?:^|;\s*)sc-admin=1(?:;|$)/.test(document.cookie);
}

export function setConsent(value: Consent) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(CONSENT_KEY, value);
  window.dispatchEvent(new CustomEvent("sc-consent-change", { detail: value }));
}

function getSessionId(): string {
  if (typeof sessionStorage === "undefined") return "ssr";
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export function track(event: EventInput) {
  if (typeof window === "undefined") return;
  if (getConsent() !== "accepted") return;
  if (isAdmin()) return;

  buffer.push({
    ...event,
    sessionId: getSessionId(),
    locale: document.documentElement.lang || undefined,
    referrer:
      event.type === "pageview" && document.referrer ? document.referrer : undefined,
  });

  if (buffer.length >= 8) {
    flush();
  } else {
    scheduleFlush();
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, 15_000);
}

/** Send the buffer. Uses sendBeacon when the page is unloading. */
export function flush(useBeacon = false) {
  if (buffer.length === 0) return;
  const events = buffer;
  buffer = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const payload = JSON.stringify({ events });
  try {
    if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon("/api/track", blob);
      return;
    }
    fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {
      /* network error — drop */
    });
  } catch {
    /* ignore */
  }
}
