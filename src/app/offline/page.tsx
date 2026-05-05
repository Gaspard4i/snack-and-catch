import { getTranslations } from "next-intl/server";
import { WifiOff } from "lucide-react";
import { ErrorShell } from "@/components/ErrorShell";

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function Offline() {
  const t = await getTranslations("errors");
  return (
    <ErrorShell
      code="OFFLINE"
      icon={WifiOff}
      title={t("codeOffline.title")}
      body={t("codeOffline.body")}
      homeLabel={t("backHome")}
    />
  );
}
