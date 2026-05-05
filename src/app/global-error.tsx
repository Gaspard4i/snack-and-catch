"use client";

import { useEffect } from "react";

/**
 * Last-resort error UI when even the RootLayout fails. No i18n hooks
 * here because next-intl might be the thing that broke. Hardcoded EN
 * copy kept short and unambiguous.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          background: "#0b0b0b",
          color: "#f5f5f5",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "32rem" }}>
          <p style={{ fontSize: "0.75rem", letterSpacing: "0.2em", opacity: 0.6 }}>
            500
          </p>
          <h1 style={{ fontSize: "2rem", marginTop: "0.5rem", fontWeight: 700 }}>
            Something broke on our side
          </h1>
          <p style={{ marginTop: "0.75rem", opacity: 0.7 }}>
            An unexpected error occurred. Reload the page or come back in a moment.
          </p>
          <div style={{ marginTop: "1.5rem", display: "flex", justifyContent: "center", gap: "0.5rem" }}>
            <a
              href="/"
              style={{
                padding: "0.5rem 1rem",
                background: "#f5f5f5",
                color: "#0b0b0b",
                borderRadius: "0.375rem",
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              Back to home
            </a>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: "0.5rem 1rem",
                background: "transparent",
                color: "#f5f5f5",
                border: "1px solid #444",
                borderRadius: "0.375rem",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
