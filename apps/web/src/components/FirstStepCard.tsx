import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { buttonVariants } from "@ib/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { cn } from "@ib/ui/lib/utils";

interface FirstStepCardProps {
  accountId: string;
  /** False on the Sources page itself, where a link back to it would be noise. */
  showSourcesLink?: boolean;
}

/**
 * Shown while nothing has ever fed the account (`useNeverFed`). A newcomer who clicks
 * « Ouvrir » on a fresh account lands on the dashboard, which would otherwise be an empty
 * page: this card is what they read instead, on the dashboard and on Sources alike.
 */
export function FirstStepCard({ accountId, showSourcesLink = true }: FirstStepCardProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("firstStep.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3 text-sm">
        <p className="text-muted-foreground">{t("firstStep.text")}</p>
        <div className="flex flex-wrap gap-2">
          {showSourcesLink && (
            <Link
              to={`/accounts/${accountId}/sources`}
              className={cn(buttonVariants({ variant: "default", size: "sm" }))}
            >
              {t("firstStep.sourcesLink")}
            </Link>
          )}
          <Link to="/help#statement" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            {t("firstStep.helpLink")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
