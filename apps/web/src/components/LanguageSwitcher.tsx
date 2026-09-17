import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ib/ui/select";

const LANGUAGES = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
] as const;

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();

  function handleChange(code: string | null) {
    if (code) {
      void i18n.changeLanguage(code);
    }
  }

  return (
    <Select
      items={LANGUAGES.map(({ code, label }) => ({ value: code, label }))}
      value={i18n.language}
      onValueChange={handleChange}
    >
      <SelectTrigger aria-label={t("languageSwitcher.label")} size="sm">
        <Globe className="size-3.5 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LANGUAGES.map((language) => (
          <SelectItem key={language.code} value={language.code}>
            {language.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
