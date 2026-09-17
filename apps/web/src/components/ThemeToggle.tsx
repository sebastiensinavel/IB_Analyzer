import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@ib/ui/button";
import { useTheme } from "@/hooks/useTheme";

export function ThemeToggle() {
  const { t } = useTranslation();
  const { isDark, toggleTheme } = useTheme();

  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={t("theme.toggle")}
      onClick={toggleTheme}
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  );
}
