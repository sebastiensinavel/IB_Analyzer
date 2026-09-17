import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ib/ui/select";

interface CurrencySelectProps {
  currencies: readonly string[];
  value: string | null;
  onChange: (currency: string | null) => void;
}

/** The currency the statistics show. With a single currency there is nothing to choose: nothing is drawn. */
export function CurrencySelect({ currencies, value, onChange }: CurrencySelectProps) {
  const { t } = useTranslation();
  if (currencies.length < 2) return null;
  return (
    <Select value={value} onValueChange={(next: string | null) => onChange(next)}>
      <SelectTrigger className="w-32" aria-label={t("stats.currency")}>
        <SelectValue>{(current: string | null) => current ?? ""}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {currencies.map((currency) => (
          <SelectItem key={currency} value={currency}>
            {currency}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
