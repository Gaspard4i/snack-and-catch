import { getTranslations } from "next-intl/server";
import { ShieldOff } from "lucide-react";
import { ErrorShell } from "@/components/ErrorShell";

export default async function Forbidden() {
  const t = await getTranslations("errors");
  return (
    <ErrorShell
      code="403"
      icon={ShieldOff}
      title={t("code403.title")}
      body={t("code403.body")}
      homeLabel={t("backHome")}
    />
  );
}
