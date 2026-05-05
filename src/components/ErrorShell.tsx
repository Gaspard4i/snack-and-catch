import Link from "next/link";
import { Home, RefreshCcw, type LucideIcon } from "lucide-react";

type Props = {
  code: string;
  icon?: LucideIcon;
  title: string;
  body: string;
  homeLabel: string;
  retryLabel?: string;
  onRetry?: () => void;
};

/**
 * Shared layout for every error page (404 / 401 / 403 / 500 / offline).
 * Renders a big code, a title, an explanation, and 1-2 actions.
 * Server component by default — pass `onRetry` to make it interactive.
 */
export function ErrorShell({
  code,
  icon: Icon,
  title,
  body,
  homeLabel,
  retryLabel,
  onRetry,
}: Props) {
  return (
    <main
      role="alert"
      className="min-h-[60vh] flex flex-col items-center justify-center px-6 py-12 text-center"
    >
      {Icon ? (
        <Icon className="h-12 w-12 text-muted mb-4" aria-hidden />
      ) : null}
      <p className="text-xs uppercase tracking-widest text-muted">{code}</p>
      <h1 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">
        {title}
      </h1>
      <p className="mt-3 max-w-md text-sm text-muted leading-relaxed">{body}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/"
          data-track={`error-${code}-home`}
          className="inline-flex items-center gap-2 rounded-md bg-accent text-accent-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          <Home className="h-4 w-4" aria-hidden />
          <span>{homeLabel}</span>
        </Link>
        {onRetry && retryLabel ? (
          <button
            type="button"
            onClick={onRetry}
            data-track={`error-${code}-retry`}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-subtle"
          >
            <RefreshCcw className="h-4 w-4" aria-hidden />
            <span>{retryLabel}</span>
          </button>
        ) : null}
      </div>
    </main>
  );
}
