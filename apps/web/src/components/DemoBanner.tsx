import { useTranslation } from "react-i18next";
import { Button } from "@ib/ui/button";
import { useDb } from "@/db/DbProvider";
import { isDemo, leaveDemo } from "@/demo/mode";

export function DemoBanner() {
  const { t } = useTranslation();
  const db = useDb();
  if (!isDemo()) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-3 bg-warning/15 px-4 py-2 text-sm">
      <span>{t("demo.banner")}</span>
      <Button variant="outline" size="sm" onClick={() => void leaveDemo(db)}>
        {t("demo.leave")}
      </Button>
    </div>
  );
}
