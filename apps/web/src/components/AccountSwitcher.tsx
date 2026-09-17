import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ib/ui/select";
import type { AccountRecord } from "@/db/schema";

const ADD_ACCOUNT = "__add__";

interface AccountSwitcherProps {
  accountId: string;
  accounts: readonly AccountRecord[];
}

export function AccountSwitcher({ accountId, accounts }: AccountSwitcherProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  function handleChange(next: string | null) {
    if (next === ADD_ACCOUNT) navigate("/accounts");
    else if (next) navigate(`/accounts/${next}/dashboard`);
  }

  return (
    <Select value={accountId} onValueChange={handleChange}>
      <SelectTrigger className="w-full font-medium" aria-label={t("accountSwitcher.label")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((account) => (
          <SelectItem key={account.id} value={account.id}>
            {account.id}
          </SelectItem>
        ))}
        <SelectItem value={ADD_ACCOUNT}>{t("accounts.add")}</SelectItem>
      </SelectContent>
    </Select>
  );
}
