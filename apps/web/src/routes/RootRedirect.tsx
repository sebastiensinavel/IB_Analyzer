import { Navigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useAccounts } from "@/db/hooks";
import { getLastAccountId } from "@/lib/accountStorage";

export function RootRedirect() {
  const { t } = useTranslation();
  const accounts = useAccounts();
  if (accounts === undefined) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }
  const remembered = getLastAccountId();
  const target = accounts.find((a) => a.id === remembered) ?? accounts[0];
  return <Navigate to={target ? `/accounts/${target.id}/dashboard` : "/accounts"} replace />;
}
