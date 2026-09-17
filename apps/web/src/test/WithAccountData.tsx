import type { ReactNode } from "react";
import { useParams } from "react-router";
import { AccountDataProvider } from "@/db/AccountDataProvider";

/** Test-only: the account data of the route's `:accountId`, as AppLayout mounts it for the account on screen. */
export function WithAccountData({ children }: { children: ReactNode }) {
  const { accountId = "" } = useParams<{ accountId: string }>();
  return <AccountDataProvider accountId={accountId}>{children}</AccountDataProvider>;
}
