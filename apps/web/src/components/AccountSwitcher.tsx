import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ib/ui/select";
import { useDb } from "@/db/DbProvider";
import { isDemo, leaveDemo } from "@/demo/mode";
import type { AccountRecord } from "@/db/schema";

const ADD_ACCOUNT = "__add__";
const LEAVE_DEMO = "__leave_demo__";

interface AccountSwitcherProps {
  accountId: string;
  accounts: readonly AccountRecord[];
}

export function AccountSwitcher({ accountId, accounts }: AccountSwitcherProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const db = useDb();
  const demo = isDemo();

  // Switching keeps the page: /accounts/alpha/positions/leaps becomes
  // /accounts/beta/positions/leaps. Settings and Help carry no account, so they open the
  // other account's dashboard; a strategy page inactive there falls back to it by StrategyRoute.
  function handleChange(next: string | null) {
    if (next === LEAVE_DEMO) void leaveDemo(db);
    else if (next === ADD_ACCOUNT) navigate("/accounts");
    else if (next) {
      const prefix = `/accounts/${accountId}/`;
      const page = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "dashboard";
      navigate(`/accounts/${next}/${page}`);
    }
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
        {demo ? (
          <SelectItem value={LEAVE_DEMO}>{t("demo.leave")}</SelectItem>
        ) : (
          <SelectItem value={ADD_ACCOUNT}>{t("accounts.add")}</SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
