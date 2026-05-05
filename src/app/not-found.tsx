import { getTranslations } from "next-intl/server";
import { Search } from "lucide-react";
import { ErrorShell } from "@/components/ErrorShell";

export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <ErrorShell
      code="404"
      icon={Search}
      title={t("code404.title")}
      body={t("code404.body")}
      homeLabel={t("backHome")}
    />
  );
}
