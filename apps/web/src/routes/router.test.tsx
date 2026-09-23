import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { ConsistencyPage } from "@/pages/ConsistencyPage";
import { StrategyPositionsPage } from "@/pages/StrategyPositionsPage";
import { SectorsPage } from "@/pages/SectorsPage";
import { router } from "@/routes/router";
import { StrategyRoute } from "@/routes/StrategyRoute";

describe("router", () => {
  it("has no route for the former Today page", () => {
    const paths = router.routes
      .flatMap((route) => route.children ?? [])
      .map((child) => child.path)
      .filter((path): path is string => typeof path === "string");
    expect(paths).not.toContain("today");
  });

  it("routes the four journals and the three statistics pages under the account", () => {
    const account = router.routes.find((r) => r.path === "/accounts/:accountId");
    const paths = (account?.children ?? []).map((c) => c.path);
    for (const p of ["journal/wheel", "journal/leaps", "journal/condors", "journal/others", "stats/wheel", "stats/leaps", "stats/condors"]) {
      expect(paths).toContain(p);
    }
  });

  it("routes the Consistency page under the account", () => {
    const account = router.routes.find((r) => r.path === "/accounts/:accountId");
    const route = (account?.children ?? []).find((c) => c.path === "consistency");
    expect(route).toBeDefined();
    const element = route?.element as ReactElement;
    expect(element.type).toBe(ConsistencyPage);
  });

  it("routes the Sector and Score page under the account", () => {
    const account = router.routes.find((r) => r.path === "/accounts/:accountId");
    const route = (account?.children ?? []).find((c) => c.path === "sectors");
    expect(route).toBeDefined();
    const element = route?.element as ReactElement;
    expect(element.type).toBe(SectorsPage);
  });

  it("routes the four strategies' positions pages under the account, guarded by StrategyRoute", () => {
    const account = router.routes.find((r) => r.path === "/accounts/:accountId");
    for (const strategy of ["wheel", "leaps", "condors", "others"] as const) {
      const route = (account?.children ?? []).find((c) => c.path === `positions/${strategy}`);
      const guard = route?.element as ReactElement<{ strategy: string; children: ReactElement<{ strategy: string }> }>;
      expect(guard.type).toBe(StrategyRoute);
      expect(guard.props.strategy).toBe(strategy);
      const element = guard.props.children;
      expect(element.type).toBe(StrategyPositionsPage);
      expect(element.props.strategy).toBe(strategy);
    }
  });

  it("guards every journal and statistics route with StrategyRoute", () => {
    const account = router.routes.find((r) => r.path === "/accounts/:accountId");
    for (const p of ["journal/wheel", "journal/leaps", "journal/condors", "journal/others", "stats/wheel", "stats/leaps", "stats/condors"]) {
      const route = (account?.children ?? []).find((c) => c.path === p);
      const guard = route?.element as ReactElement<{ strategy: string }>;
      expect(guard.type).toBe(StrategyRoute);
      expect(guard.props.strategy).toBe(p.split("/")[1]);
    }
  });
});
