import type { ReactNode } from "react";
import { Navigate, useParams } from "react-router";
import type { Strategy } from "@ib/ledger";
import { useAccountStrategies } from "@/db/AccountDataProvider";

/**
 * A page of an inactive strategy sends to the account's dashboard (spec of sub-project 30, §6.3):
 * a bookmark never lands on an empty page. Nothing is decided while the account is still loading.
 */
export function StrategyRoute({ strategy, children }: { strategy: Strategy; children: ReactNode }) {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const active = useAccountStrategies();
  if (strategy === "others") return children;
  if (active === undefined) return null;
  if (!active.includes(strategy)) return <Navigate to={`/accounts/${accountId}/dashboard`} replace />;
  return children;
}
