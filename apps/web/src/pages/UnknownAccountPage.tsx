import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@ib/ui/button";
import { Card, CardContent } from "@ib/ui/card";

export function UnknownAccountPage({ id }: { id: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-heading text-lg font-semibold tracking-tight">{t("unknownAccount.title")}</h1>
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-sm text-muted-foreground">{t("unknownAccount.hint", { id })}</p>
          <Button variant="outline" nativeButton={false} role="link" render={<Link to="/accounts" />}>
            {t("unknownAccount.link")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
