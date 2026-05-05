import { getTranslations } from "next-intl/server";
import { Lock } from "lucide-react";
import { ErrorShell } from "@/components/ErrorShell";

export default async function Unauthorized() {
  const t = await getTranslations("errors");
  return (
    <ErrorShell
      code="401"
      icon={Lock}
      title={t("code401.title")}
      body={t("code401.body")}
      homeLabel={t("backHome")}
    />
  );
}
