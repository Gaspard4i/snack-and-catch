"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { ErrorShell } from "@/components/ErrorShell";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");
  useEffect(() => {
    console.error("[app/error]", error);
  }, [error]);

  return (
    <ErrorShell
      code="500"
      icon={AlertTriangle}
      title={t("code500.title")}
      body={t("code500.body")}
      homeLabel={t("backHome")}
      retryLabel={t("retry")}
      onRetry={reset}
    />
  );
}
