# Sous-projet 41 — La page d'accueil, la démonstration et ses captures : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Cocher chaque case dans le même commit que la tâche** (CLAUDE.md, Workflow).

**Goal:** Un navigateur sans compte atterrit sur `/welcome`, une page de présentation qui mène à l'ajout d'un compte IB ou à une démonstration complète de l'application sur des données fictives, isolée dans sa propre base ; les captures de la page se régénèrent par `pnpm screenshots` depuis cette démo.

**Architecture:** `src/demo/mode.ts` est le seul lecteur du drapeau `sessionStorage` `ib2:demo` ; `schema.ts` en tire le nom de la base au chargement du module (`ib-analyzer-demo` ou `ib-analyzer`), et les clés `localStorage` d'affichage passent par `storageKey`. Une graine scénarisée (`src/demo/scenario.ts` → `generate.ts`) produit transactions, snapshot et points de cash, cohérents par construction ; un agent simulé (`src/demo/agent.ts`) répond à la place de `127.0.0.1:8100` au format réel de l'agent. `/welcome` lit un manifeste de captures (`src/welcome/shots.ts`) que `apps/web/scripts/screenshots.mjs` lit aussi pour capturer la démo avec Playwright.

**Tech Stack:** React 19, react-router 7, react-i18next, Dexie 4, Vitest + fake-indexeddb + Testing Library, Playwright 1.62, `sharp` (nouvelle devDependency d'`apps/web`, conversion WebP), base-ui via `@ib/ui`.

**Spec:** `docs/specs/2026-09-29-page-accueil-et-demo-design.md` — à lire avant toute tâche.

## Global Constraints

- Le serveur ne voit rien : aucun changement de `apps/api`, de `apps/tws-agent`, de `deploy/`.
- Aucun nom de domaine dans un fichier versionné ; tous les liens de `/welcome` sont relatifs.
- `isDemo()` (`apps/web/src/demo/mode.ts`) est le **seul** lecteur du drapeau `ib2:demo` ; `enterDemo`, `clearDemo`, `leaveDemo` y vivent aussi. Aucun autre fichier ne lit ni n'écrit `sessionStorage`.
- Noms fixes : base de démo `ib-analyzer-demo`, vraie base `ib-analyzer`, compte démo `id` `demo`, `ibAccountId` `U0000000`, libellé `Démo`, `twsPort` `7496`.
- En démo, aucun `fetch` vers `http://127.0.0.1:8100` — ni `/health`, ni `/snapshot`, ni `/bars`, ni `/quotes`.
- Hors de `src/demo/mode.ts`, tout `src/demo/` se charge par `import()` dynamique : aucun import statique de `@/demo/…` sauf `@/demo/mode`.
- Les prix de la démo ne viennent jamais de `Math.random` : générateur déterministe à graine fixe.
- Tout texte visible dans `apps/web/src/i18n/{fr,en}.json` (sous `welcome.*` et `demo.*`) ; les deux fichiers ont les mêmes clés.
- Ton de `/welcome` : factuel, aucun superlatif, aucun chiffre de performance, aucun témoignage. FAQ « Est-ce gratuit ? » → « Aucun frais d'utilisation. » / « Is it free? » → « There are no usage fees. »
- `packages/ui` n'a ni `Dialog` ni `Accordion` : une capture s'ouvre dans un nouvel onglet (`<a target="_blank" rel="noopener">`), la FAQ utilise `<details>`/`<summary>`.
- Captures : viewport 1280×800, `deviceScaleFactor: 2`, sortie WebP 1600×1000 qualité 85, fichiers `apps/web/public/welcome/<id>.<light|dark>.<fr|en>.webp`, exclus du pré-cache (`globIgnores`).
- Tests `apps/web` : `npx vitest run <motif>` depuis `apps/web` (le `--` de pnpm ne filtre pas). `pnpm check` une seule fois, à la fin (tâche 10).
- Un test doit échouer si le comportement change ; `apps/web` teste sur `fake-indexeddb`, jamais en moquant les hooks.
- Arbitrages d'affichage tranchés ici, à ne pas rouvrir : `/welcome` en « page qui se déroule » (maquette A), largeur max `max-w-5xl`, sections de fonctions en deux colonnes alternées dès `md`, une colonne en dessous (texte puis capture) ; la section Confidentialité est une `Card` à bordure gauche teal (`border-l-4 border-l-primary`) ; le bandeau démo est une barre pleine largeur en haut de la coquille, fond `bg-warning/15`, texte `text-sm`, bouton `outline` `size="sm"` à droite.

## Review Focus

1. **Un vrai compte nommé « demo »** (le slug est libre) : ses vues de tableau et son « dernier compte visité » ne doivent jamais se mêler à ceux de la démo. Test en tâche 1 (`storageKey`).
2. **Visiter la démo un samedi, un dimanche ou un lundi matin** : aucune option ouverte échue, aucun condor XSP dans la monnaie à l'échéance, reconstitution et cash sans écart. Test en tâche 5 (oracle à plusieurs dates).
3. **Deuxième onglet** : un onglet ouvert sur la vraie base pendant qu'un autre est en démo ne voit jamais la base de démo ; quitter la démo ne touche ni `ib-analyzer` ni `ib2:lastAccountId`. Test en tâche 7.
4. **Hors ligne sur `/welcome`** : les captures ne sont pas pré-cachées ; une image absente laisse le cadre et son texte, jamais une icône cassée. Test en tâche 3.
5. **Le vrai agent tourne pendant la démo** : aucune requête ne doit partir vers lui, graphes et cotations compris. Test en tâche 6 (espion `fetch` autour d'une passe complète).

---

## Fichiers

- Create `apps/web/src/demo/mode.ts` (+ `mode.test.ts`) — drapeau, nom de base, `storageKey`, entrer/sortir (tâches 1, 7).
- Modify `apps/web/src/db/schema.ts`, `apps/web/src/lib/tableViewStorage.ts`, `apps/web/src/lib/accountStorage.ts` (tâche 1).
- Create `apps/web/src/pages/WelcomePage.tsx` (+ test), `apps/web/src/components/SessionCorner.tsx`, `apps/web/src/components/welcome/ShotFrame.tsx` (+ test), `apps/web/src/welcome/shots.ts` (tâches 2, 3).
- Modify `apps/web/src/routes/router.tsx`, `apps/web/src/routes/RootRedirect.tsx` (+ test), `apps/web/src/components/app-sidebar.tsx`, `apps/web/src/pages/AccountsPage.tsx` (+ test), `apps/web/src/pages/HelpPage.tsx` (+ test), `apps/web/src/i18n/{fr,en}.json` (tâches 2, 3, 7).
- Create `apps/web/src/demo/calendar.ts`, `prices.ts` (+ tests) (tâche 4).
- Create `apps/web/src/demo/scenario.ts`, `generate.ts` (+ `generate.test.ts`) (tâche 5).
- Create `apps/web/src/demo/agent.ts` (+ test), `apps/web/src/demo/seed.ts` (+ test); modify `apps/web/src/agent/client.ts`, `apps/web/src/main.tsx` (tâche 6).
- Create `apps/web/src/components/DemoBanner.tsx` (+ test); modify `apps/web/src/routes/AppLayout.tsx`, `apps/web/src/components/AccountSwitcher.tsx`, `apps/web/src/pages/SourcesPage.tsx`, `apps/web/src/components/settings/BackupCard.tsx`, `apps/web/src/flex/relay.ts` (+ tests) (tâche 7).
- Create `apps/web/scripts/screenshots.mjs`, `apps/web/src/welcome/shots.test.ts`, `apps/web/public/welcome/*.webp`; modify `package.json` (racine), `apps/web/package.json`, `apps/web/pwa.config.ts` (+ test) (tâche 8).
- Create `apps/web/e2e-offline/demo.spec.ts` (tâche 9).
- Modify `CLAUDE.md`, `.claude/skills/run-frontend/SKILL.md`, la spec (tâche 10).

---

### Task 1: Le mode démo choisit la base et cloisonne le stockage local

**Files:**
- Create: `apps/web/src/demo/mode.ts`, `apps/web/src/demo/mode.test.ts`
- Modify: `apps/web/src/db/schema.ts` (dernière ligne), `apps/web/src/lib/tableViewStorage.ts`, `apps/web/src/lib/accountStorage.ts`

**Interfaces:**
- Produces:
  - `DEMO_FLAG = "ib2:demo"`, `DEMO_DB_NAME = "ib-analyzer-demo"`, `REAL_DB_NAME = "ib-analyzer"`, `DEMO_ACCOUNT_ID = "demo"`
  - `isDemo(): boolean`
  - `databaseName(): string`
  - `storageKey(key: string): string` (en démo, `ib2:x` → `ib2:demo:x` ; toute autre clé inchangée)
  - `navigation: { assign(url: string): void }` (le point de navigation pleine page, remplaçable en test)

- [x] **Step 1: Write the failing tests** — `apps/web/src/demo/mode.test.ts`

```ts
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_DB_NAME, REAL_DB_NAME, databaseName, isDemo, storageKey } from "@/demo/mode";
import { clearTableViews, pageSearchKey, tableViewKey } from "@/lib/tableViewStorage";
import { getLastAccountId, setLastAccountId } from "@/lib/accountStorage";

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe("isDemo", () => {
  it("is false without the flag, true with it", () => {
    expect(isDemo()).toBe(false);
    window.sessionStorage.setItem("ib2:demo", "1");
    expect(isDemo()).toBe(true);
  });
});

describe("databaseName", () => {
  it("names the real base outside the demo and the demo base inside", () => {
    expect(databaseName()).toBe(REAL_DB_NAME);
    window.sessionStorage.setItem("ib2:demo", "1");
    expect(databaseName()).toBe(DEMO_DB_NAME);
  });
});

describe("storageKey", () => {
  it("leaves every key alone outside the demo", () => {
    expect(storageKey("ib2:lastAccountId")).toBe("ib2:lastAccountId");
  });
  it("prefixes ib2 keys in the demo, and only those", () => {
    window.sessionStorage.setItem("ib2:demo", "1");
    expect(storageKey("ib2:lastAccountId")).toBe("ib2:demo:lastAccountId");
    expect(storageKey("other")).toBe("other");
  });
  it("keeps a real account named demo apart from the demo account", () => {
    setLastAccountId("demo");
    window.localStorage.setItem(tableViewKey("demo", "history"), "{}");
    window.sessionStorage.setItem("ib2:demo", "1");
    expect(getLastAccountId()).toBeNull();
    expect(tableViewKey("demo", "history")).toBe("ib2:demo:tableView:demo:history");
    expect(pageSearchKey("demo", "positions")).toBe("ib2:demo:pageSearch:demo:positions");
    clearTableViews("demo");
    window.sessionStorage.clear();
    expect(getLastAccountId()).toBe("demo");
    expect(window.localStorage.getItem("ib2:tableView:demo:history")).toBe("{}");
  });
});
```

- [x] **Step 2: Run to verify it fails** — `cd apps/web && npx vitest run src/demo/mode` → FAIL (module absent).

- [x] **Step 3: Implement** — `apps/web/src/demo/mode.ts`

```ts
/**
 * The demonstration mode (sub-project 41): the only reader of the per-tab flag. Entering or
 * leaving always reloads the page, so everything decided from it — the database name first —
 * is fixed for the life of the tab. Nothing here depends on the server session.
 */
export const DEMO_FLAG = "ib2:demo";
export const DEMO_DB_NAME = "ib-analyzer-demo";
export const REAL_DB_NAME = "ib-analyzer";
export const DEMO_ACCOUNT_ID = "demo";

export function isDemo(): boolean {
  try {
    return window.sessionStorage.getItem(DEMO_FLAG) === "1";
  } catch {
    return false;
  }
}

export function databaseName(): string {
  return isDemo() ? DEMO_DB_NAME : REAL_DB_NAME;
}

/** A display key of localStorage, moved under `ib2:demo:` in the demo: a real account may be named "demo". */
export function storageKey(key: string): string {
  return isDemo() && key.startsWith("ib2:") ? `ib2:demo:${key.slice(4)}` : key;
}

/** Full-page navigation, behind an object so tests can replace it (jsdom does not navigate). */
export const navigation = {
  assign(url: string): void {
    window.location.assign(url);
  },
};
```

In `tableViewStorage.ts`, route the two key builders and `clearTableViews` through `storageKey`:

```ts
import { storageKey } from "@/demo/mode";
// …
export function tableViewKey(accountId: string, table: string): string {
  return storageKey(`${VIEW_PREFIX}${accountId}:${table}`);
}

export function pageSearchKey(accountId: string, page: string): string {
  return storageKey(`${SEARCH_PREFIX}${accountId}:${page}`);
}
// in clearTableViews:
    const prefixes = [storageKey(`${VIEW_PREFIX}${accountId}:`), storageKey(`${SEARCH_PREFIX}${accountId}:`)];
```

In `accountStorage.ts`, replace each `STORAGE_KEY` use by `storageKey(STORAGE_KEY)` (import from `@/demo/mode`).

Search for any other `ib2:` key built for an account (`grep -rn '"ib2:' apps/web/src --include=*.ts --include=*.tsx | grep -v test`): `ib2:theme` stays shared (a visitor preference); any other account-scoped key found goes through `storageKey` too.

In `schema.ts`, last line:

```ts
import { databaseName } from "@/demo/mode";
// …
/** The one database of the tab: the demo's while the demo flag is set (sub-project 41). Tests wipe its tables between cases. */
export const db = new AppDatabase(databaseName());
```

- [x] **Step 4: Run** — `npx vitest run src/demo/mode src/lib/tableViewStorage src/lib/accountStorage` → PASS.

- [x] **Step 5: Commit** — `git add -A apps/web/src/demo apps/web/src/db/schema.ts apps/web/src/lib && git commit -m "Démo : le drapeau choisit la base et cloisonne le stockage local"`

---

### Task 2: Le parcours d'entrée — `/welcome`, la redirection, le menu sans compte

**Files:**
- Create: `apps/web/src/pages/WelcomePage.tsx` (squelette, complété en tâche 3), `apps/web/src/pages/WelcomePage.test.tsx`, `apps/web/src/components/SessionCorner.tsx`
- Modify: `apps/web/src/routes/router.tsx`, `apps/web/src/routes/RootRedirect.tsx` (+ `RootRedirect.test.tsx`), `apps/web/src/components/app-sidebar.tsx` (+ test dans `routes/AppLayout.test.tsx`), `apps/web/src/pages/AccountsPage.tsx` (+ `AccountsPage.test.tsx`), `apps/web/src/pages/HelpPage.tsx` (+ `HelpPage.test.tsx`), `apps/web/src/i18n/{fr,en}.json`

**Interfaces:**
- Produces: route `/welcome` → `WelcomePage` ; `SessionCorner` (export nommé, déplacé tel quel d'`AccountsPage.tsx`) ; clés i18n `welcome.discover` (« Découvrir IB Analyzer » / « Discover IB Analyzer »), `welcome.addAccount` (« Ajouter un compte IB » / « Add an IB account »), `welcome.exploreDemo` (« Explorer la démo » / « Explore the demo »), `welcome.help` (« Aide » / « Help »), `welcome.restore` (« Restaurer une sauvegarde » / « Restore a backup ») ; ancre `#agent` sur la section de l'agent de l'Aide.

- [x] **Step 1: Write the failing tests**

`RootRedirect.test.tsx` — change the no-account case (keep `renderRoot`, `Probe`):

```tsx
it("sends a browser with no account to the welcome page", async () => {
  renderRoot();
  expect(await screen.findByTestId("location")).toHaveTextContent("/welcome");
});
```

`WelcomePage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, expect, it } from "vitest";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import { WelcomePage } from "@/pages/WelcomePage";

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={["/welcome"]}>
        <Routes>
          <Route path="/welcome" element={<WelcomePage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  await db.accounts.clear();
});

it("leads to adding an account, to the help and to a backup restore", () => {
  renderPage();
  expect(screen.getByRole("link", { name: "Ajouter un compte IB" })).toHaveAttribute("href", "/accounts");
  expect(screen.getByRole("link", { name: "Aide" })).toHaveAttribute("href", "/help");
  expect(screen.getByRole("link", { name: "Restaurer une sauvegarde" })).toHaveAttribute("href", "/settings");
  expect(screen.getByRole("button", { name: "Explorer la démo" })).toBeInTheDocument();
});

it("still renders when accounts exist", async () => {
  await db.accounts.put({ id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] });
  renderPage();
  expect(screen.getByRole("link", { name: "Ajouter un compte IB" })).toBeInTheDocument();
});
```

`routes/AppLayout.test.tsx` — add (reuse `renderAt`):

```tsx
it("offers adding an account and the welcome page when there is no account at all", async () => {
  renderAt("/help");
  expect(await screen.findByRole("link", { name: "Ajouter un compte IB" })).toHaveAttribute("href", "/accounts");
  expect(screen.getByRole("link", { name: "Découvrir IB Analyzer" })).toHaveAttribute("href", "/welcome");
});

it("keeps a discreet link to the welcome page with accounts", async () => {
  await db.accounts.put({ id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] });
  renderAt("/accounts/alpha/dashboard");
  expect(await screen.findByRole("link", { name: "Découvrir IB Analyzer" })).toHaveAttribute("href", "/welcome");
  expect(screen.queryByRole("link", { name: "Ajouter un compte IB" })).toBeNull();
});
```

(Add `<Route path="/help" element={<AppLayout />}><Route index element={<div>help</div>} /></Route>` to `renderAt`'s routes if missing.)

`AccountsPage.test.tsx` — replace the « Premiers pas » assertion:

```tsx
it("points to the welcome page instead of pitching the app itself", () => {
  renderPage();
  expect(screen.getByRole("link", { name: "Découvrir IB Analyzer" })).toHaveAttribute("href", "/welcome");
  expect(screen.queryByText("Comment ça marche")).toBeNull();
});
```

`HelpPage.test.tsx` — add:

```tsx
it("anchors the agent section and links to the welcome page", () => {
  renderHelp(); // the file's existing render helper
  expect(document.getElementById("agent")).not.toBeNull();
  expect(screen.getByRole("link", { name: "Découvrir IB Analyzer" })).toHaveAttribute("href", "/welcome");
});
```

- [x] **Step 2: Run to verify they fail** — `npx vitest run src/routes src/pages/WelcomePage src/pages/AccountsPage src/pages/HelpPage` → FAIL.

- [x] **Step 3: Implement**

1. Move `SessionCorner` (and its doc comment) from `AccountsPage.tsx` into `components/SessionCorner.tsx` as `export function SessionCorner()`; `AccountsPage` imports it.
2. `router.tsx`: `{ path: "/welcome", element: <WelcomePage /> },` right after `/accounts`, with a comment: « Hors `AppLayout` comme `/accounts` : la page d'un navigateur sans compte, qu'on partage par lien (sous-projet 41). »
3. `RootRedirect.tsx`: `"/accounts"` → `"/welcome"` in the no-account branch.
4. `WelcomePage.tsx` skeleton (the full content comes in task 3):

```tsx
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@ib/ui/button";
import { cn } from "@ib/ui/lib/utils";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { SessionCorner } from "@/components/SessionCorner";
import { ThemeToggle } from "@/components/ThemeToggle";

export function WelcomePage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-12 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-heading text-sm font-semibold tracking-tight">IB Analyzer</span>
        <div className="flex flex-wrap items-center gap-2">
          <SessionCorner />
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
      <WelcomeActions />
    </div>
  );
}

export function WelcomeActions() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Link to="/accounts" className={cn(buttonVariants())}>{t("welcome.addAccount")}</Link>
        <Button variant="outline">{t("welcome.exploreDemo")}</Button>
      </div>
      <div className="flex gap-4 text-sm text-muted-foreground">
        <Link to="/help" className="underline">{t("welcome.help")}</Link>
        <Link to="/settings" className="underline">{t("welcome.restore")}</Link>
      </div>
    </div>
  );
}
```

(The demo button gets its `onClick` in task 7.)

5. `app-sidebar.tsx`: in `SidebarHeader`, when `accountId === null`, render in place of the switcher:

```tsx
{accountId === null && (
  <div className="flex flex-col gap-1">
    <Link to="/accounts" onClick={() => setOpenMobile(false)} className={cn(buttonVariants({ size: "sm" }), "w-full")}>
      {t("welcome.addAccount")}
    </Link>
    <Link to="/welcome" onClick={() => setOpenMobile(false)} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-full")}>
      {t("welcome.discover")}
    </Link>
  </div>
)}
```

and in `SidebarFooter`, above `<SessionMenuItem />`, when `accountId !== null`:

```tsx
<Link to="/welcome" onClick={() => setOpenMobile(false)} className="px-2 text-xs text-muted-foreground underline-offset-2 hover:underline">
  {t("welcome.discover")}
</Link>
```

6. `AccountsPage.tsx`: delete `WelcomeCard` and its render; delete `accounts.welcome` from both i18n files; put in its place:

```tsx
<Link to="/welcome" className="text-sm text-muted-foreground underline">{t("welcome.discover")}</Link>
```

7. `HelpPage.tsx`: `<Section id="agent" title={t("help.what.title")}>`; in the first section (`help.app.title`) append `<p><Link to="/welcome" className="underline">{t("welcome.discover")}</Link></p>`.

8. Add the `welcome.*` keys of the Interfaces block to `fr.json` and `en.json`.

- [x] **Step 4: Run** — same command as step 2 → PASS.

- [x] **Step 5: Commit** — `git commit -am "Accueil : /welcome, la redirection sans compte et le menu qui mène à l'ajout d'un compte"` (after `git add` of the new files).

---

### Task 3: Le contenu de `/welcome` et ses cadres de capture

**Files:**
- Create: `apps/web/src/welcome/shots.ts`, `apps/web/src/components/welcome/ShotFrame.tsx`, `apps/web/src/components/welcome/ShotFrame.test.tsx`
- Modify: `apps/web/src/pages/WelcomePage.tsx` (+ test), `apps/web/src/i18n/{fr,en}.json`

**Interfaces:**
- Produces:
  - `type ShotId = "dashboard" | "positions" | "wheel" | "journal-wheel" | "condors" | "history"`
  - `interface ShotSpec { id: ShotId; route: string; waitFor: string; prepare?: "expand-first-condor" | "open-first-chart" }`
  - `SHOTS: readonly ShotSpec[]`, `SHOT_WIDTH = 1600`, `SHOT_HEIGHT = 1000`, `SHOT_THEMES = ["light","dark"] as const`, `SHOT_LANGUAGES = ["fr","en"] as const`
  - `shotPath(id: ShotId, theme: "light"|"dark", lang: "fr"|"en"): string` → `/welcome/<id>.<theme>.<lang>.webp`
  - `ShotFrame({ id, alt, className? })`

- [x] **Step 1: Write the failing tests**

`ShotFrame.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it } from "vitest";
import i18n from "@/i18n";
import { ShotFrame } from "@/components/welcome/ShotFrame";

it("shows the shot of the current theme and language, full size in a new tab", async () => {
  await i18n.changeLanguage("en");
  render(<I18nextProvider i18n={i18n}><ShotFrame id="positions" alt="Positions" /></I18nextProvider>);
  const img = screen.getByRole("img", { name: "Positions" });
  expect(img).toHaveAttribute("src", "/welcome/positions.light.en.webp");
  expect(img).toHaveAttribute("width", "1600");
  expect(img).toHaveAttribute("loading", "lazy");
  expect(screen.getByRole("link")).toHaveAttribute("target", "_blank");
  await i18n.changeLanguage("fr");
});

it("keeps its frame and its text when the image cannot load", () => {
  render(<I18nextProvider i18n={i18n}><ShotFrame id="history" alt="Historique" /></I18nextProvider>);
  fireEvent.error(screen.getByRole("img", { name: "Historique" }));
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getByText("Historique")).toBeInTheDocument();
  expect(screen.getByTestId("shot-frame")).toBeInTheDocument();
});
```

`WelcomePage.test.tsx` — add:

```tsx
it("walks through the features, privacy, how it works and the FAQ", () => {
  renderPage();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Vos options Interactive Brokers, lues stratégie par stratégie.");
  for (const id of ["dashboard", "positions", "wheel", "journal-wheel", "condors", "history"]) {
    expect(document.querySelector(`img[src^="/welcome/${id}."]`)).not.toBeNull();
  }
  expect(screen.getByRole("link", { name: /sécurité/i })).toHaveAttribute("href", "/help#security");
  expect(screen.getByText("Est-ce gratuit ?")).toBeInTheDocument();
  expect(screen.getByText("Aucun frais d'utilisation.")).toBeInTheDocument();
});
```

- [x] **Step 2: Run to verify they fail** — `npx vitest run src/components/welcome src/pages/WelcomePage` → FAIL.

- [x] **Step 3: Implement**

`welcome/shots.ts`:

```ts
/**
 * The shots of /welcome (sub-project 41). Read by the page to show them and by
 * apps/web/scripts/screenshots.mjs to take them from the demo: one list, so a shot cannot be
 * shown without being taken.
 */
export type ShotId = "dashboard" | "positions" | "wheel" | "journal-wheel" | "condors" | "history";

export interface ShotSpec {
  id: ShotId;
  /** Route of the demo account. */
  route: string;
  /** CSS selector that must be visible before the capture. */
  waitFor: string;
  prepare?: "expand-first-condor" | "open-first-chart";
}

export const SHOT_WIDTH = 1600;
export const SHOT_HEIGHT = 1000;
export const SHOT_THEMES = ["light", "dark"] as const;
export const SHOT_LANGUAGES = ["fr", "en"] as const;

export const SHOTS: readonly ShotSpec[] = [
  { id: "dashboard", route: "/accounts/demo/dashboard", waitFor: "main h1" },
  { id: "positions", route: "/accounts/demo/positions", waitFor: "main table" },
  { id: "wheel", route: "/accounts/demo/positions/wheel", waitFor: "main table", prepare: "open-first-chart" },
  { id: "journal-wheel", route: "/accounts/demo/journal/wheel", waitFor: "main table" },
  { id: "condors", route: "/accounts/demo/positions/condors", waitFor: "main table", prepare: "expand-first-condor" },
  { id: "history", route: "/accounts/demo/history", waitFor: "main [role=table], main table" },
];

export function shotPath(id: ShotId, theme: (typeof SHOT_THEMES)[number], lang: (typeof SHOT_LANGUAGES)[number]): string {
  return `/welcome/${id}.${theme}.${lang}.webp`;
}
```

(Check each `waitFor` against the real page: if the page renders no `<main>`, use the page's `h1`/table selector that exists — `AppLayout` wraps pages in `SidebarInset`, whose element to verify.)

`components/welcome/ShotFrame.tsx`:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@ib/ui/lib/utils";
import { useTheme } from "@/hooks/useTheme";
import { SHOT_HEIGHT, SHOT_WIDTH, shotPath, type ShotId } from "@/welcome/shots";

export function ShotFrame({ id, alt, className }: { id: ShotId; alt: string; className?: string }) {
  const { i18n } = useTranslation();
  const { isDark } = useTheme();
  const [failed, setFailed] = useState(false);
  const src = shotPath(id, isDark ? "dark" : "light", i18n.language.startsWith("en") ? "en" : "fr");
  return (
    <figure data-testid="shot-frame" className={cn("overflow-hidden rounded-lg border border-border bg-card shadow-card", className)}>
      <div className="flex gap-1 border-b border-border px-3 py-2" aria-hidden="true">
        <span className="size-2 rounded-full bg-muted-foreground/30" />
        <span className="size-2 rounded-full bg-muted-foreground/30" />
        <span className="size-2 rounded-full bg-muted-foreground/30" />
      </div>
      {failed ? (
        <div className="flex aspect-[16/10] items-center justify-center p-4 text-sm text-muted-foreground">{alt}</div>
      ) : (
        <a href={src} target="_blank" rel="noopener">
          <img src={src} alt={alt} width={SHOT_WIDTH} height={SHOT_HEIGHT} loading="lazy" className="h-auto w-full" onError={() => setFailed(true)} />
        </a>
      )}
    </figure>
  );
}
```

`WelcomePage.tsx` — full page, sections in the spec §3 order (hero with `h1` + sub-sentence + `WelcomeActions` + `ShotFrame id="dashboard"`; four `FeatureSection`s alternating `md:flex-row` / `md:flex-row-reverse` with `positions`, `wheel`, `journal-wheel`, `condors`; an « Et aussi » row with `ShotFrame id="history"` at `md:w-1/2` and a list Historique / Consistance / Secteur et Score / Suggestion de position; the privacy `Card` `border-l-4 border-l-primary` with `<Link to="/help#security">`; three numbered steps linking to `/help#statement`, `/help#flex`, `/help#agent`; the FAQ as five `<details className="rounded-md border border-border p-3"><summary className="cursor-pointer font-medium">…</summary><p className="mt-2 text-sm text-muted-foreground">…</p></details>`; a footer with Aide, Paramètres and `welcome.footer.shots`). Every string from `t("welcome.…")`.

i18n — add under `welcome` in both files (FR shown; write the EN equivalents with the same keys):

```json
"title": "Vos options Interactive Brokers, lues stratégie par stratégie.",
"subtitle": "Wheel, LEAPS, Condors : la couverture de chaque vente, le moment de racheter, le capital engagé et le rendement — calculés dans votre navigateur, à partir de vos relevés IB.",
"heroAlt": "Tableau de bord d'un compte de démonstration",
"features": {
  "positions": { "title": "Chaque vente, sa couverture", "text": "Cash, actions, LEAPS ou spread : chaque option vendue affiche ce qui la couvre, et ce qui ne l'est pas clignote dans la barre de titre. Une décision de rachat tient compte du temps qui reste, pas seulement du prix.", "alt": "Positions avec leur couverture et la décision de rachat" },
  "wheel": { "title": "La Wheel, cycle par cycle", "text": "Puts vendus, assignations, calls couverts et rappels se suivent sur le graphe du sous-jacent, au prix de chaque lot.", "alt": "Positions de la Wheel et graphe de cours" },
  "journal": { "title": "Des journaux reconstitués", "text": "Chaque stratégie a son journal, son capital immobilisé et son rendement mensuel, recalculés depuis l'historique de vos transactions.", "alt": "Journal de la Wheel" },
  "condors": { "title": "Un condor par ligne", "text": "Crédit reçu, coût de clôture, P/L réalisé et latent ; les jambes se déplient sous leur condor.", "alt": "Positions Condors, un condor déplié" }
},
"more": { "title": "Et aussi", "items": ["Un historique complet, filtrable par colonne", "Une page Consistance qui vérifie positions et cash", "Une table Secteur et Score commune à vos comptes", "Une suggestion de position par secteur"], "alt": "Historique des transactions" },
"privacy": { "title": "Vos données ne quittent pas votre ordinateur", "text": "Tout le calcul se fait dans votre navigateur. Le serveur ne voit jamais vos transactions ni vos positions ; la sauvegarde, facultative, est chiffrée avant de partir.", "link": "La sécurité de vos données" },
"how": { "title": "Comment ça marche", "steps": [
  { "title": "Un relevé HTML", "text": "Exportez un relevé d'activité du Client Portal et importez-le." },
  { "title": "Une Flex Query", "text": "Branchez une Flex Query pour une mise à jour quotidienne." },
  { "title": "L'agent local, facultatif", "text": "Il lit TWS sur votre ordinateur pour les données du jour." }
]},
"faq": { "title": "Questions fréquentes", "items": [
  { "q": "Est-ce gratuit ?", "a": "Aucun frais d'utilisation." },
  { "q": "Faut-il un compte serveur ?", "a": "Non. Il ne sert qu'au relais Flex quand l'agent local manque et à la sauvegarde chiffrée, tous deux facultatifs." },
  { "q": "Mes identifiants IB sont-ils demandés ?", "a": "Jamais. L'application lit des relevés que vous exportez, une Flex Query en lecture seule et, si vous l'installez, TWS sur votre propre ordinateur." },
  { "q": "Fonctionne-t-elle hors ligne ?", "a": "Oui, une fois ouverte : elle s'installe et garde vos données dans le navigateur. Seule la synchronisation demande le réseau." },
  { "q": "Quelles stratégies ?", "a": "La Wheel, les LEAPS et les Iron Condors ; le reste est suivi dans Autres." }
]},
"footer": { "shots": "Les captures montrent des données fictives." }
```

- [x] **Step 4: Run** — `npx vitest run src/components/welcome src/pages/WelcomePage` → PASS.

- [x] **Step 5: Commit** — `git add -A apps/web/src && git commit -m "Accueil : le contenu de la page et ses cadres de capture"`

---

### Task 4: Le calendrier et les prix de la démo

**Files:**
- Create: `apps/web/src/demo/calendar.ts`, `apps/web/src/demo/calendar.test.ts`, `apps/web/src/demo/prices.ts`, `apps/web/src/demo/prices.test.ts`

**Interfaces:**
- Produces (`calendar.ts`):
  - `nyDay(now: Date): string` — `YYYY-MM-DD` du jour calendaire à New York
  - `addDays(day: string, n: number): string`
  - `isWeekend(day: string): boolean`
  - `referenceDay(now: Date): string` — `nyDay(now)`, ramené au vendredi un week-end
  - `marketDaysBefore(reference: string, n: number): string` — le n-ième jour ouvré avant (n = 0 → la référence)
  - `fridayOnOrAfter(day: string): string`
  - `calendarDaysBetween(from: string, to: string): number`
- Produces (`prices.ts`):
  - `DEMO_TICKERS` (liste lue par le scénario et l'agent), `MAX_AGO = 520`
  - `closeAgo(ticker: string, ago: number): number` — clôture `ago` jours ouvrés avant la référence (XSP suit SPY)
  - `barsFor(ticker: string, reference: string): PriceBar[]` (type `PriceBar` de `@/agent/client`), 521 barres, dates croissantes, dernière = `reference`
  - `optionMark(spot: number, strike: number, right: "C" | "P", days: number, vol: number): number`
  - `VOLATILITY: Record<string, number>`

- [x] **Step 1: Write the failing tests**

`calendar.test.ts`:

```ts
import { expect, it } from "vitest";
import { addDays, calendarDaysBetween, fridayOnOrAfter, marketDaysBefore, nyDay, referenceDay } from "@/demo/calendar";

it("reads the New York calendar day, not the machine's", () => {
  expect(nyDay(new Date("2026-09-26T02:00:00Z"))).toBe("2026-09-25"); // 22:00 in New York
});

it("rolls a weekend back to Friday", () => {
  expect(referenceDay(new Date("2026-09-26T15:00:00Z"))).toBe("2026-09-25");
  expect(referenceDay(new Date("2026-09-27T15:00:00Z"))).toBe("2026-09-25");
  expect(referenceDay(new Date("2026-09-28T15:00:00Z"))).toBe("2026-09-28");
});

it("counts market days back, weekends skipped", () => {
  expect(marketDaysBefore("2026-09-28", 0)).toBe("2026-09-28");
  expect(marketDaysBefore("2026-09-28", 1)).toBe("2026-09-25");
  expect(marketDaysBefore("2026-09-28", 5)).toBe("2026-09-21");
});

it("finds the Friday on or after a day", () => {
  expect(fridayOnOrAfter("2026-09-25")).toBe("2026-09-25");
  expect(fridayOnOrAfter("2026-09-26")).toBe("2026-10-02");
  expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  expect(calendarDaysBetween("2026-09-25", "2026-10-02")).toBe(7);
});
```

`prices.test.ts`:

```ts
import { expect, it } from "vitest";
import { DEMO_TICKERS, MAX_AGO, barsFor, closeAgo, optionMark } from "@/demo/prices";

it("is deterministic and never uses Math.random", () => {
  const spy = vi.spyOn(Math, "random");
  expect(closeAgo("AAPL", 100)).toBe(closeAgo("AAPL", 100));
  expect(spy).not.toHaveBeenCalled();
});

it("gives every ticker a positive, plausible path", () => {
  for (const ticker of DEMO_TICKERS) {
    for (let ago = 0; ago <= MAX_AGO; ago += 1) expect(closeAgo(ticker, ago)).toBeGreaterThan(1);
  }
});

it("prices XSP on SPY", () => {
  expect(closeAgo("XSP", 10)).toBe(closeAgo("SPY", 10));
});

it("ends the bars on the reference day with its close", () => {
  const bars = barsFor("MSFT", "2026-09-25");
  expect(bars).toHaveLength(MAX_AGO + 1);
  expect(bars.at(-1)).toMatchObject({ date: "2026-09-25", close: closeAgo("MSFT", 0) });
  expect(bars.every((b) => b.low <= Math.min(b.open, b.close) && b.high >= Math.max(b.open, b.close))).toBe(true);
});

it("prices an option at intrinsic plus time value", () => {
  expect(optionMark(100, 90, "C", 0, 0.25)).toBe(10);
  expect(optionMark(100, 110, "C", 0, 0.25)).toBe(0.01);
  expect(optionMark(100, 100, "P", 30, 0.25)).toBeGreaterThan(optionMark(100, 90, "P", 30, 0.25));
});
```

(Import `vi` from vitest in `prices.test.ts`.)

- [x] **Step 2: Run** — `npx vitest run src/demo/calendar src/demo/prices` → FAIL.

- [x] **Step 3: Implement**

`calendar.ts`:

```ts
const NY_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

export function nyDay(now: Date): string {
  return NY_DAY.format(now);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isWeekend(day: string): boolean {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

export function referenceDay(now: Date): string {
  let day = nyDay(now);
  while (isWeekend(day)) day = addDays(day, -1);
  return day;
}

export function marketDaysBefore(reference: string, n: number): string {
  let day = reference;
  for (let left = n; left > 0; ) {
    day = addDays(day, -1);
    if (!isWeekend(day)) left -= 1;
  }
  return day;
}

export function fridayOnOrAfter(day: string): string {
  let d = day;
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 5) d = addDays(d, 1);
  return d;
}

export function calendarDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
```

`prices.ts`:

```ts
import type { PriceBar } from "@/agent/client";
import { marketDaysBefore } from "@/demo/calendar";

/**
 * Synthetic prices of the demo (sub-project 41, spec §5.1): a path per ticker drawn around
 * anchor levels, indexed by market days before the reference day, so the story reads the same
 * whatever the day of the visit. Never IB's market data.
 */
export const MAX_AGO = 520;

/** [market days ago, level] pairs, oldest first; linear between them. */
const ANCHORS: Record<string, readonly (readonly [number, number])[]> = {
  AAPL: [[520, 165], [380, 175], [300, 160], [220, 185], [120, 205], [0, 228]],
  AMD: [[520, 150], [380, 160], [300, 120], [200, 125], [100, 135], [0, 138]],
  KO: [[520, 58], [380, 60], [250, 63], [150, 61], [0, 66]],
  MSFT: [[520, 380], [380, 400], [250, 430], [150, 410], [60, 445], [0, 470]],
  NVDA: [[520, 110], [380, 120], [250, 135], [120, 150], [0, 175]],
  JPM: [[520, 180], [380, 195], [250, 205], [100, 230], [0, 245]],
  DIS: [[520, 95], [380, 100], [250, 92], [100, 105], [0, 112]],
  SPY: [[520, 500], [380, 520], [250, 545], [120, 560], [0, 590]],
};

export const DEMO_TICKERS = [...Object.keys(ANCHORS), "XSP"] as const;

export const VOLATILITY: Record<string, number> = { AAPL: 0.25, AMD: 0.45, KO: 0.15, MSFT: 0.25, NVDA: 0.45, JPM: 0.22, DIS: 0.28, SPY: 0.15, XSP: 0.15 };

function seedOf(ticker: string): number {
  let h = 2166136261;
  for (const c of ticker) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** mulberry32: a small deterministic generator. */
function generator(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function anchorAt(ticker: string, ago: number): number {
  const points = ANCHORS[ticker];
  for (let i = 0; i < points.length - 1; i += 1) {
    const [a0, p0] = points[i];
    const [a1, p1] = points[i + 1];
    if (ago <= a0 && ago >= a1) return p0 + ((a0 - ago) / (a0 - a1)) * (p1 - p0);
  }
  return points.at(-1)![1];
}

const round2 = (x: number) => Math.round(x * 100) / 100;

const paths = new Map<string, { close: number[]; open: number[]; high: number[]; low: number[]; volume: number[] }>();

function pathOf(ticker: string) {
  const base = ticker === "XSP" ? "SPY" : ticker;
  let path = paths.get(base);
  if (path) return path;
  const next = generator(seedOf(base));
  const normal = () => Math.sqrt(-2 * Math.log(next() || 1e-12)) * Math.cos(2 * Math.PI * next());
  path = { close: [], open: [], high: [], low: [], volume: [] };
  let noise = 0;
  let previous = anchorAt(base, MAX_AGO);
  for (let ago = MAX_AGO; ago >= 0; ago -= 1) {
    noise = 0.9 * noise + 0.012 * normal();
    const close = round2(anchorAt(base, ago) * (1 + noise));
    const open = round2(previous * (1 + 0.004 * normal()));
    const spread = Math.abs(0.008 * normal());
    path.close[ago] = close;
    path.open[ago] = open;
    path.high[ago] = round2(Math.max(open, close) * (1 + spread));
    path.low[ago] = round2(Math.min(open, close) * (1 - spread));
    path.volume[ago] = Math.round(1_000_000 * (1 + next()));
    previous = close;
  }
  paths.set(base, path);
  return path;
}

export function closeAgo(ticker: string, ago: number): number {
  return pathOf(ticker).close[ago];
}

export function barsFor(ticker: string, reference: string): PriceBar[] {
  const path = pathOf(ticker);
  const bars: PriceBar[] = [];
  for (let ago = MAX_AGO; ago >= 0; ago -= 1) {
    bars.push({ date: marketDaysBefore(reference, ago), open: path.open[ago], high: path.high[ago], low: path.low[ago], close: path.close[ago], volume: path.volume[ago] });
  }
  return bars;
}

export function optionMark(spot: number, strike: number, right: "C" | "P", days: number, vol: number): number {
  const intrinsic = right === "C" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  const sd = spot * vol * Math.sqrt(Math.max(days, 0) / 365);
  const timeValue = sd === 0 ? 0 : 0.4 * sd * Math.exp(-(((spot - strike) / sd) ** 2) / 2);
  return Math.max(0.01, round2(intrinsic + timeValue));
}
```

(Check the `date` format `lightweight-charts` expects from `PriceBar` in `PositionChartRow`/`PriceChart`: if the agent sends `YYYYMMDD` or another form, `barsFor` produces that form — read one bar of `apps/web/src/mocks/` or the agent's `/bars` handler in `apps/tws-agent` first.)

- [x] **Step 4: Run** — `npx vitest run src/demo/calendar src/demo/prices` → PASS.

- [x] **Step 5: Commit** — `git add apps/web/src/demo && git commit -m "Démo : calendrier et prix synthétiques"`

---

### Task 5: Le scénario, le générateur et leur oracle

**Files:**
- Create: `apps/web/src/demo/scenario.ts`, `apps/web/src/demo/generate.ts`, `apps/web/src/demo/generate.test.ts`

**Interfaces:**
- Consumes: task 4 (`calendar.ts`, `prices.ts`) ; `@ib/ledger` (`Transaction`, `Position`, `packedOptionSymbol`, `runningBalances`, `dayOf`, `buildJournals`, `anchoredBalances`, `ACTIVABLE_STRATEGIES`, `DEFAULT_MULTIPLIER`) ; `@ib/coverage` (`buildRiskReport`, `saleInstants`) ; `CashPointRecord` de `@/db/schema`.
- Produces:
  - `DemoEvent` (union, `scenario.ts`) et `DEMO_SCENARIO: readonly DemoEvent[]`
  - `interface DemoWorld { reference: string; transactions: Transaction[]; positions: Position[]; previousMarks: Map<string, number>; cashPoints: CashPointRecord[]; cashAvailable: number }` (`previousMarks` : prix de la veille par `conid`, pour le P/L du jour)
  - `generateDemo(now: Date): DemoWorld`
  - `DEMO_IB_ACCOUNT = "U0000000"`, `DEMO_CURRENCIES = ["USD", "EUR"] as const`

- [x] **Step 1: Write the failing oracle** — `generate.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { ACTIVABLE_STRATEGIES, anchoredBalances, buildJournals } from "@ib/ledger";
import { buildRiskReport, saleInstants } from "@ib/coverage";
import { DEMO_CURRENCIES, generateDemo } from "@/demo/generate";

// A Monday before the open, a Friday evening, a Saturday, a mid-week afternoon.
const VISITS = ["2026-09-28T12:00:00Z", "2026-09-25T23:30:00Z", "2026-09-26T15:00:00Z", "2026-11-18T19:00:00Z"];

describe.each(VISITS)("the demo seen on %s", (visit) => {
  const world = generateDemo(new Date(visit));
  const snapshot = { asOf: world.reference, positions: world.positions };
  const journals = buildJournals(world.transactions, snapshot, undefined, ACTIVABLE_STRATEGIES);

  it("rebuilds its own portfolio without a gap", () => {
    expect(journals.reconciliation.asOf).not.toBeNull();
    expect(journals.reconciliation.differences).toEqual([]);
    expect(journals.reconciliation.orphans).toEqual([]);
  });

  it("anchors its cash without a gap", () => {
    const { checks } = anchoredBalances(world.transactions, DEMO_CURRENCIES, world.cashPoints);
    expect(checks.every((c) => c.start !== null && c.start.gap === 0)).toBe(true);
  });

  it("tells a full story in every strategy", () => {
    for (const strategy of ["wheel", "leaps", "condors"] as const) {
      const rows = journals.rows.filter((r) => r.strategy === strategy);
      expect(rows.some((r) => r.endWhen === null), `${strategy} open`).toBe(true);
      expect(rows.some((r) => r.endWhen !== null), `${strategy} closed`).toBe(true);
    }
    expect(journals.rows.some((r) => r.strategy === "others")).toBe(true);
  });

  it("has a buy-back decision, an uncovered sale and an open complete condor", () => {
    const soldAt = saleInstants(journals.rows);
    const report = buildRiskReport(world.positions, world.cashAvailable, { asOf: world.reference, soldAt });
    expect(report.positions.some((p) => p.decision === "buy back")).toBe(true);
    expect(report.positions.some((p) => p.uncoveredQuantity > 0)).toBe(true);
    expect(report.structures.some((s) => s.symbol === "XSP")).toBe(true);
  });

  it("leaves no open option expired at the reference day", () => {
    const options = world.positions.filter((p) => p.secType === "OPT");
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((p) => p.expiry !== null && p.expiry > world.reference)).toBe(true);
  });

  it("dates every transaction before the reference day", () => {
    expect(world.transactions.every((t) => t.when.slice(0, 10) < world.reference)).toBe(true);
  });
});

it("generates the same world twice for the same visit", () => {
  expect(generateDemo(new Date(VISITS[0]))).toEqual(generateDemo(new Date(VISITS[0])));
});
```

(Check the field names against `packages/ledger/src/journals/types.ts` before running: `JournalRow.strategy` and its values, `endWhen`. Adapt the test to the real names, never the reverse.)

- [x] **Step 2: Run** — `npx vitest run src/demo/generate` → FAIL.

- [x] **Step 3: Implement the scenario** — `scenario.ts`

```ts
/**
 * The story of the demo account (sub-project 41, spec §5), in market days before the reference
 * day. Strikes are absolute: the price paths of prices.ts are fixed relative to that day, so
 * each outcome — assignment, call-away, expiry — is known when the scenario is written, and
 * generate.test.ts checks it on several visit days.
 */
export type DemoEvent =
  | { type: "deposit"; ago: number; amount: number }
  | { type: "interest"; ago: number; amount: number }
  | { type: "dividend"; ago: number; ticker: string; perShare: number; shares: number }
  | { type: "buyStock"; ago: number; ticker: string; quantity: number }
  | { type: "sellOption"; id: string; ago: number; ticker: string; right: "C" | "P"; strike: number; dte: number; contracts: number }
  | { type: "buyOption"; id: string; ago: number; ticker: string; right: "C" | "P"; strike: number; dte: number; contracts: number }
  | { type: "buyBack"; id: string; ago: number }
  | { type: "sellCondor"; id: string; ago: number; ticker: string; putShort: number; putLong: number; callShort: number; callLong: number; dte: number; contracts: number };

export const DEMO_SCENARIO: readonly DemoEvent[] = [
  { type: "deposit", ago: 390, amount: 150_000 },
  // Wheel, AAPL: a whole cycle — put assigned, a call expires, the next call calls the shares away.
  { type: "sellOption", id: "aapl-put", ago: 360, ticker: "AAPL", right: "P", strike: 170, dte: 30, contracts: 2 },
  { type: "sellOption", id: "aapl-call-1", ago: 330, ticker: "AAPL", right: "C", strike: 175, dte: 45, contracts: 2 },
  { type: "dividend", ago: 300, ticker: "AAPL", perShare: 0.25, shares: 200 },
  { type: "sellOption", id: "aapl-call-2", ago: 290, ticker: "AAPL", right: "C", strike: 170, dte: 60, contracts: 2 },
  // Wheel, AMD: assigned, a call expires, a call still open on the shares held.
  { type: "sellOption", id: "amd-put", ago: 320, ticker: "AMD", right: "P", strike: 135, dte: 30, contracts: 1 },
  { type: "sellOption", id: "amd-call-1", ago: 200, ticker: "AMD", right: "C", strike: 140, dte: 45, contracts: 1 },
  { type: "sellOption", id: "amd-call-2", ago: 20, ticker: "AMD", right: "C", strike: 145, dte: 35, contracts: 1 },
  // Others, KO: shares bought at the market, then taken into the Wheel by a covered call.
  { type: "buyStock", ago: 250, ticker: "KO", quantity: 200 },
  { type: "dividend", ago: 180, ticker: "KO", perShare: 0.485, shares: 200 },
  { type: "sellOption", id: "ko-call-1", ago: 60, ticker: "KO", right: "C", strike: 68, dte: 45, contracts: 2 },
  { type: "sellOption", id: "ko-call-2", ago: 15, ticker: "KO", right: "C", strike: 69, dte: 40, contracts: 2 },
  // Wheel, MSFT: a put bought back early, a put to buy back now.
  { type: "sellOption", id: "msft-put-1", ago: 150, ticker: "MSFT", right: "P", strike: 390, dte: 45, contracts: 1 },
  { type: "buyBack", id: "msft-put-1", ago: 130 },
  { type: "sellOption", id: "msft-put-2", ago: 20, ticker: "MSFT", right: "P", strike: 430, dte: 30, contracts: 1 },
  { type: "sellOption", id: "aapl-put-2", ago: 10, ticker: "AAPL", right: "P", strike: 215, dte: 30, contracts: 1 },
  // LEAPS: NVDA with a call sold against it, JPM alone; an older NVDA LEAPS sold at a profit.
  { type: "buyOption", id: "nvda-leaps", ago: 300, ticker: "NVDA", right: "C", strike: 120, dte: 540, contracts: 2 },
  { type: "sellOption", id: "nvda-call", ago: 12, ticker: "NVDA", right: "C", strike: 190, dte: 30, contracts: 1 },
  { type: "buyOption", id: "jpm-leaps", ago: 200, ticker: "JPM", right: "C", strike: 200, dte: 600, contracts: 1 },
  { type: "buyOption", id: "nvda-leaps-old", ago: 380, ticker: "NVDA", right: "C", strike: 110, dte: 400, contracts: 1 },
  { type: "buyBack", id: "nvda-leaps-old", ago: 140 },
  // Condors on XSP: one expired out of the money, one open.
  { type: "sellCondor", id: "xsp-1", ago: 100, ticker: "XSP", putShort: 520, putLong: 510, callShort: 600, callLong: 610, dte: 30, contracts: 2 },
  { type: "sellCondor", id: "xsp-2", ago: 10, ticker: "XSP", putShort: 560, putLong: 550, callShort: 615, callLong: 625, dte: 35, contracts: 2 },
  // Others: a naked call, the one uncovered position of the title bar.
  { type: "sellOption", id: "dis-call", ago: 8, ticker: "DIS", right: "C", strike: 125, dte: 30, contracts: 1 },
  { type: "interest", ago: 350, amount: 45.1 },
  { type: "interest", ago: 250, amount: 61.3 },
  { type: "interest", ago: 150, amount: 55.8 },
  { type: "interest", ago: 50, amount: 70.2 },
];
```

(`buyBack` closes the position opened under `id`, whatever its side: it buys back a sale and sells a purchase.)

- [x] **Step 4: Implement the generator** — `generate.ts`

```ts
import { DEFAULT_MULTIPLIER, dayOf, packedOptionSymbol, runningBalances, type Position, type Transaction } from "@ib/ledger";
import type { CashPointRecord } from "@/db/schema";
import { DEMO_ACCOUNT_ID } from "@/demo/mode";
import { addDays, calendarDaysBetween, fridayOnOrAfter, marketDaysBefore, referenceDay } from "@/demo/calendar";
import { VOLATILITY, closeAgo, optionMark } from "@/demo/prices";
import { DEMO_SCENARIO, type DemoEvent } from "@/demo/scenario";

export const DEMO_IB_ACCOUNT = "U0000000";
export const DEMO_CURRENCIES = ["USD", "EUR"] as const;
const OPTION_COMMISSION = 0.65;
const STOCK_COMMISSION = 1;

export interface DemoWorld {
  reference: string;
  transactions: Transaction[];
  positions: Position[];
  /** Mark of the day before, by conid: the day's P&L of the simulated agent. */
  previousMarks: Map<string, number>;
  cashPoints: CashPointRecord[];
  cashAvailable: number;
}

interface OpenOption { id: string; ticker: string; right: "C" | "P"; strike: number; expiry: string; contracts: number /* signed */ }

const round2 = (x: number) => Math.round(x * 100) / 100;

export function generateDemo(now: Date): DemoWorld {
  const reference = referenceDay(now);
  const dayAt = (ago: number) => marketDaysBefore(reference, ago);
  // Market days between a day and the reference: the index of prices.ts.
  const agoOf = (day: string) => {
    let ago = 0;
    while (dayAt(ago) > day) ago += 1;
    return ago;
  };
  const transactions: Transaction[] = [];
  const open = new Map<string, OpenOption[]>();
  let serial = 0;

  const push = (t: Omit<Transaction, "accountId" | "source" | "externalId" | "description"> & { description?: string }, cash = false) => {
    serial += 1;
    transactions.push({
      accountId: DEMO_ACCOUNT_ID,
      source: "flex",
      externalId: `${cash ? "flex:cash" : "flex:trade"}:demo-${serial}`,
      description: t.description ?? "",
      ...t,
    } as Transaction);
  };

  const optionTrade = (o: Omit<OpenOption, "id" | "contracts">, contracts: number, price: number, when: string, commission: number | null) =>
    push({
      kind: "trade",
      symbol: packedOptionSymbol(o.ticker, o.expiry, o.right, o.strike)!,
      secType: "OPT",
      right: o.right,
      strike: o.strike,
      expiry: o.expiry,
      quantity: contracts,
      price,
      amount: round2(-contracts * price * DEFAULT_MULTIPLIER),
      commission,
      currency: "USD",
      when,
    });

  const stockTrade = (ticker: string, quantity: number, price: number, when: string, commission: number) =>
    push({ kind: "trade", symbol: ticker, secType: "STK", right: "", strike: null, expiry: null, quantity, price, amount: round2(-quantity * price), commission, currency: "USD", when });

  const markOn = (o: Omit<OpenOption, "id" | "contracts">, day: string) =>
    optionMark(closeAgo(o.ticker, agoOf(day)), o.strike, o.right, calendarDaysBetween(day, o.expiry), VOLATILITY[o.ticker]);

  // Expiry of every open option whose expiry falls before `day`: expired, assigned or exercised
  // at 20:00, the shape the journals infer (price 0, no commission, shares at the strike).
  const settleBefore = (day: string) => {
    for (const [id, legs] of open) {
      const remaining = legs.filter((leg) => {
        if (leg.expiry >= day) return true;
        const spot = closeAgo(leg.ticker, agoOf(leg.expiry));
        const inTheMoney = leg.right === "C" ? spot > leg.strike : spot < leg.strike;
        const when = `${leg.expiry}T20:00:00.000Z`;
        if (inTheMoney && leg.ticker === "XSP") throw new Error(`demo: XSP leg ${leg.right}${leg.strike} in the money at ${leg.expiry}`);
        optionTrade(leg, -leg.contracts, 0, when, null);
        if (inTheMoney) stockTrade(leg.ticker, (leg.right === "P" ? -1 : 1) * leg.contracts * DEFAULT_MULTIPLIER, leg.strike, when, 0);
        return false;
      });
      if (remaining.length === 0) open.delete(id);
      else open.set(id, remaining);
    }
  };

  const events = [...DEMO_SCENARIO].sort((a, b) => b.ago - a.ago);
  for (const event of events) {
    const day = dayAt(event.ago);
    settleBefore(day);
    apply(event, day);
  }
  settleBefore(reference);

  function apply(event: DemoEvent, day: string) {
    const when = `${day}T14:30:00.000Z`;
    const spot = (ticker: string) => closeAgo(ticker, agoOf(day));
    switch (event.type) {
      case "deposit":
        return push({ kind: "transfer", symbol: "", secType: "", right: "", strike: null, expiry: null, quantity: null, price: null, amount: event.amount, commission: null, currency: "USD", when: `${day}T00:00:00.000Z`, description: "ELECTRONIC FUND TRANSFER" }, true);
      case "interest":
        return push({ kind: "interest", symbol: "", secType: "", right: "", strike: null, expiry: null, quantity: null, price: null, amount: event.amount, commission: null, currency: "USD", when: `${day}T00:00:00.000Z`, description: "USD CREDIT INT" }, true);
      case "dividend":
        return push({ kind: "dividend", symbol: event.ticker, secType: "STK", right: "", strike: null, expiry: null, quantity: null, price: null, amount: round2(event.perShare * event.shares), commission: null, currency: "USD", when: `${day}T00:00:00.000Z`, description: `${event.ticker} CASH DIVIDEND` }, true);
      case "buyStock":
        return stockTrade(event.ticker, event.quantity, spot(event.ticker), when, -STOCK_COMMISSION);
      case "sellOption":
      case "buyOption": {
        const sign = event.type === "sellOption" ? -1 : 1;
        const leg = { ticker: event.ticker, right: event.right, strike: event.strike, expiry: fridayOnOrAfter(addDays(day, event.dte)) };
        optionTrade(leg, sign * event.contracts, markOn(leg, day), when, round2(-OPTION_COMMISSION * event.contracts));
        open.set(event.id, [{ id: event.id, ...leg, contracts: sign * event.contracts }]);
        return;
      }
      case "buyBack": {
        for (const leg of open.get(event.id) ?? []) optionTrade(leg, -leg.contracts, markOn(leg, day), when, round2(-OPTION_COMMISSION * Math.abs(leg.contracts)));
        open.delete(event.id);
        return;
      }
      case "sellCondor": {
        const expiry = fridayOnOrAfter(addDays(day, event.dte));
        const legs: OpenOption[] = [
          { id: event.id, ticker: event.ticker, right: "P", strike: event.putLong, expiry, contracts: event.contracts },
          { id: event.id, ticker: event.ticker, right: "P", strike: event.putShort, expiry, contracts: -event.contracts },
          { id: event.id, ticker: event.ticker, right: "C", strike: event.callShort, expiry, contracts: -event.contracts },
          { id: event.id, ticker: event.ticker, right: "C", strike: event.callLong, expiry, contracts: event.contracts },
        ];
        for (const leg of legs) optionTrade(leg, leg.contracts, markOn(leg, day), when, round2(-OPTION_COMMISSION * event.contracts));
        open.set(event.id, legs);
        return;
      }
    }
  }

  const { positions, previousMarks } = positionsAt(transactions, reference, dayAt(1), agoOf);
  const rows = runningBalances(transactions, DEMO_CURRENCIES);
  const first = dayOf(rows[0].transaction.when);
  const last = rows[rows.length - 1];
  const importedAt = now.toISOString();
  const cashPoints = DEMO_CURRENCIES.flatMap((currency): CashPointRecord[] => [
    { accountId: DEMO_ACCOUNT_ID, currency, kind: "start", asOf: first, amount: 0, source: "flex", importedAt },
    { accountId: DEMO_ACCOUNT_ID, currency, kind: "end", asOf: dayOf(last.transaction.when), amount: last.balances[currency], source: "flex", importedAt },
  ]);
  return { reference, transactions, positions, previousMarks, cashPoints, cashAvailable: round2(last.balances.USD) };
}
```

and, in the same file, `positionsAt`: sum the signed `quantity` of every `trade` per contract (`STK` by ticker; `OPT` by ticker + right + strike + expiry), drop zeros, keep a running average opening price per contract (adding in the current direction raises the cost, reducing scales it, zero resets), and build each `Position`:

```ts
function positionsAt(transactions: readonly Transaction[], reference: string, previousDay: string, agoOf: (day: string) => number) {
  interface Book { ticker: string; secType: "STK" | "OPT"; right: "C" | "P" | ""; strike: number | null; expiry: string | null; quantity: number; cost: number }
  const books = new Map<string, Book>();
  for (const t of transactions) {
    if (t.kind !== "trade" || t.quantity === null || t.price === null) continue;
    const ticker = t.secType === "OPT" ? t.symbol.slice(0, 6).trim() : t.symbol;
    const key = [ticker, t.secType, t.right, t.strike ?? "", t.expiry ?? ""].join("|");
    const book = books.get(key) ?? { ticker, secType: t.secType as "STK" | "OPT", right: t.right, strike: t.strike, expiry: t.expiry, quantity: 0, cost: 0 };
    const next = book.quantity + t.quantity;
    if (book.quantity === 0 || Math.sign(t.quantity) === Math.sign(book.quantity)) book.cost += t.quantity * t.price;
    else book.cost = Math.sign(next) === Math.sign(book.quantity) ? book.cost * (next / book.quantity) : next * t.price;
    book.quantity = next;
    if (next === 0) book.cost = 0;
    books.set(key, book);
  }
  const positions: Position[] = [];
  const previousMarks = new Map<string, number>();
  for (const [key, b] of books) {
    if (b.quantity === 0) continue;
    const multiplier = b.secType === "OPT" ? DEFAULT_MULTIPLIER : 1;
    const markAt = (day: string) =>
      b.secType === "OPT"
        ? optionMark(closeAgo(b.ticker, agoOf(day)), b.strike!, b.right as "C" | "P", calendarDaysBetween(day, b.expiry!), VOLATILITY[b.ticker])
        : closeAgo(b.ticker, agoOf(day));
    const mark = markAt(reference);
    const avg = round2(b.cost / b.quantity);
    const conid = String(conidOf(key));
    previousMarks.set(conid, markAt(previousDay));
    positions.push({
      symbol: b.ticker, secType: b.secType, right: b.right, strike: b.strike, expiry: b.expiry, multiplier: b.secType === "OPT" ? DEFAULT_MULTIPLIER : null,
      quantity: b.quantity, avgPrice: avg, marketPrice: mark, marketValue: round2(b.quantity * mark * multiplier),
      unrealizedPnl: round2((mark - avg) * b.quantity * multiplier), dailyPnl: null, dayChange: null,
      currency: "USD", conid, description: b.secType === "OPT" ? `${b.ticker} ${b.expiry} ${b.strike} ${b.right}` : b.ticker,
    });
  }
  return { positions, previousMarks };
}

/** A stable positive integer per contract key: TWS's conId of the simulated agent. */
export function conidOf(key: string): number {
  let h = 5381;
  for (const c of key) h = (Math.imul(h, 33) ^ c.charCodeAt(0)) >>> 0;
  return (h % 900_000_000) + 100_000_000;
}
```

(The positions carry `dailyPnl`/`dayChange` `null`, as a Flex snapshot does; the simulated agent of task 6 gives the day's P&L.)

- [x] **Step 5: Run and tune** — `npx vitest run src/demo/generate`. If an assertion fails, **tune the scenario or the anchors of `prices.ts`** (a strike, a `dte`, an anchor level), never the assertion: each assertion is a promise of the spec. Common adjustments: the MSFT put must be deep enough out of the money for `buy back` (spec of sub-project 39: `C ≤ min(0,4 S, S r / (1,2 T) − 0,01)`); an XSP condor must stay out of the money at its expiry on every visit day; the NVDA/JPM LEAPS expiry must stay after the reference day. Re-run until PASS.

- [x] **Step 6: Commit** — `git add apps/web/src/demo && git commit -m "Démo : le scénario, son générateur et l'oracle de cohérence"`

---

### Task 6: L'agent simulé et le remplissage de la base de démo

**Files:**
- Create: `apps/web/src/demo/agent.ts`, `apps/web/src/demo/agent.test.ts`, `apps/web/src/demo/seed.ts`, `apps/web/src/demo/seed.test.ts`
- Modify: `apps/web/src/agent/client.ts`, `apps/web/src/main.tsx`

**Interfaces:**
- Consumes: `generateDemo`, `conidOf`, `DEMO_IB_ACCOUNT` (task 5) ; `barsFor`, `closeAgo`, `DEMO_TICKERS` (task 4) ; `parseAgentSnapshot`, `AgentSnapshotPayload` de `@ib/ib-parsers`.
- Produces:
  - `demoAgentJson(path: string, now?: Date): AgentFetchResult` — `/snapshot?…`, `/quotes?…&symbols=A,B`, `/bars?…&symbol=X` ; autre chemin → `{ ok: false, code: "agent-error" }`
  - `demoProbe(): AgentInfo` → `{ version: "demo" }`
  - `agentPayload(world: DemoWorld, now: Date): AgentSnapshotPayload`
  - `ensureDemoSeeded(db: AppDatabase, now?: Date): Promise<void>`
  - `DEMO_SECTORS: SectorRecord[]` (dans `seed.ts`)

- [x] **Step 1: Write the failing tests**

`agent.test.ts`:

```ts
import { expect, it } from "vitest";
import { parseAgentQuotes, parseAgentSnapshot } from "@ib/ib-parsers";
import { demoAgentJson } from "@/demo/agent";
import { generateDemo } from "@/demo/generate";

const NOW = new Date("2026-09-25T19:00:00Z");

it("answers /snapshot in the agent's own format, for the demo IB account", () => {
  const result = demoAgentJson("/snapshot?port=7496", NOW);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const parsed = parseAgentSnapshot(result.payload, "demo");
  expect(parsed.accounts).toEqual(["U0000000"]);
  expect(parsed.transactions).toEqual([]);
  const world = generateDemo(NOW);
  const qty = (ps: { symbol: string; quantity: number; strike: number | null }[]) => ps.map((p) => `${p.symbol}|${p.strike}|${p.quantity}`).sort();
  expect(qty(parsed.positions)).toEqual(qty(world.positions));
  expect(parsed.positions.some((p) => p.dailyPnl !== null && p.dayChange !== null)).toBe(true);
});

it("answers /bars with two years ending on the reference day", () => {
  const result = demoAgentJson("/bars?port=7496&symbol=MSFT&currency=USD", NOW);
  expect(result.ok && (result.payload as { bars: unknown[] }).bars.length).toBe(521);
});

it("answers /quotes with last and close", () => {
  const result = demoAgentJson("/quotes?port=7496&symbols=AAPL%2CKO", NOW);
  expect(result.ok).toBe(true);
  if (result.ok) expect([...parseAgentQuotes(result.payload).keys()].sort()).toEqual(["AAPL", "KO"]);
});
```

`seed.test.ts`:

```ts
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/db/schema";
import { ensureDemoSeeded } from "@/demo/seed";
import { syncAgent } from "@/agent/sync";
import { fetchBars, fetchQuotes, fetchSnapshot, probeAgent } from "@/agent/client";

const NOW = new Date("2026-09-25T19:00:00Z");

beforeEach(async () => {
  await Promise.all([db.accounts.clear(), db.transactions.clear(), db.snapshots.clear(), db.cashPoints.clear(), db.sectors.clear()]);
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

it("seeds the demo account once", async () => {
  await ensureDemoSeeded(db, NOW);
  await ensureDemoSeeded(db, NOW);
  const account = await db.accounts.get("demo");
  expect(account).toMatchObject({ label: "Démo", ibAccountId: "U0000000", twsPort: 7496, strategies: ["wheel", "leaps", "condors"] });
  expect(await db.snapshots.get("demo")).toMatchObject({ source: "flex" });
  const count = await db.transactions.where("accountId").equals("demo").count();
  expect(count).toBeGreaterThan(30);
  await ensureDemoSeeded(db, NOW);
  expect(await db.transactions.where("accountId").equals("demo").count()).toBe(count);
});

it("never calls the real agent in the demo, and a full pass goes through the real pipeline", async () => {
  window.sessionStorage.setItem("ib2:demo", "1");
  const spy = vi.spyOn(globalThis, "fetch");
  await ensureDemoSeeded(db, NOW);
  expect(await probeAgent()).toEqual({ version: "demo" });
  const outcome = await syncAgent({ db, fetchSnapshot, now: () => NOW }, (await db.accounts.get("demo"))!);
  expect(outcome.status).toBe("ok");
  expect(await db.snapshots.get("demo")).toMatchObject({ source: "agent" });
  expect((await fetchBars(7496, "AAPL")).ok).toBe(true);
  expect((await fetchQuotes(7496, ["AAPL"])).ok).toBe(true);
  expect(spy).not.toHaveBeenCalled();
});
```

(`strategies` must equal `ACTIVABLE_STRATEGIES`' order; read it from `@ib/ledger` in the assertion if it differs.)

- [x] **Step 2: Run** — `npx vitest run src/demo/agent src/demo/seed` → FAIL.

- [x] **Step 3: Implement** — `demo/agent.ts`

```ts
import type { AgentSnapshotPayload } from "@ib/ib-parsers";
import type { AgentFetchResult, AgentInfo } from "@/agent/client";
import { referenceDay } from "@/demo/calendar";
import { DEMO_IB_ACCOUNT, conidOf, generateDemo, type DemoWorld } from "@/demo/generate";
import { barsFor, closeAgo } from "@/demo/prices";

/**
 * The simulated agent (sub-project 41, spec §6): answers what apps/tws-agent answers, in its
 * format, so the real pipeline — parseAgentSnapshot, syncAgent, quotes — runs unchanged. Never
 * a request to 127.0.0.1:8100.
 */
export function demoProbe(): AgentInfo {
  return { version: "demo" };
}

let cached: { day: string; world: DemoWorld } | null = null;
function worldAt(now: Date): DemoWorld {
  const day = referenceDay(now);
  if (cached?.day !== day) cached = { day, world: generateDemo(now) };
  return cached.world;
}

export function agentPayload(world: DemoWorld, now: Date): AgentSnapshotPayload {
  return {
    accounts: [DEMO_IB_ACCOUNT],
    fetchedAt: now.toISOString(),
    cashAvailable: world.cashAvailable,
    executions: [],
    positions: world.positions.map((p) => {
      const multiplier = p.multiplier ?? 1;
      const previous = world.previousMarks.get(p.conid) ?? p.marketPrice!;
      const dailyPnL = Math.round((p.marketPrice! - previous) * p.quantity * multiplier * 100) / 100;
      return {
        conId: Number(p.conid),
        symbol: p.symbol,
        localSymbol: p.secType === "OPT" ? packed(p) : p.symbol,
        secType: p.secType,
        right: p.right,
        strike: p.strike ?? 0,
        lastTradeDateOrContractMonth: p.expiry ? p.expiry.replaceAll("-", "") : "",
        multiplier: p.secType === "OPT" ? String(multiplier) : "",
        currency: p.currency,
        position: p.quantity,
        averageCost: p.avgPrice! * multiplier,
        marketPrice: p.marketPrice!,
        marketValue: p.marketValue!,
        unrealizedPNL: p.unrealizedPnl!,
        pnl: { dailyPnL, value: p.marketValue },
      };
    }),
  };
}

export function demoAgentJson(path: string, now = new Date()): AgentFetchResult {
  const url = new URL(path, "http://demo.invalid");
  const world = worldAt(now);
  switch (url.pathname) {
    case "/snapshot":
      return { ok: true, payload: agentPayload(world, now) };
    case "/bars": {
      const symbol = url.searchParams.get("symbol") ?? "";
      return { ok: true, payload: { symbol, fetchedAt: now.toISOString(), bars: knownTicker(symbol) ? barsFor(symbol, world.reference) : [] } };
    }
    case "/quotes": {
      const symbols = (url.searchParams.get("symbols") ?? "").split(",").filter(Boolean);
      return { ok: true, payload: { quotes: symbols.map((symbol) => ({ symbol, last: knownTicker(symbol) ? closeAgo(symbol, 0) : null, close: knownTicker(symbol) ? closeAgo(symbol, 1) : null })) } };
    }
    default:
      return { ok: false, code: "agent-error" };
  }
}
```

with `packed(p)` = `packedOptionSymbol(p.symbol, p.expiry, p.right, p.strike)` (from `@ib/ledger`) and `knownTicker(s)` = `(DEMO_TICKERS as readonly string[]).includes(s)`. Remove the unused `conidOf` import if `Number(p.conid)` suffices. Check the `/quotes` payload shape against `parseAgentQuotes` (`{ quotes: [{ symbol, last, close }] }`) and the `/bars` payload against `BarsResponse`.

`agent/client.ts` — the demo branch, at the two transport points (keeps `exclusiveTws` around it):

```ts
import { isDemo } from "@/demo/mode";
// probeAgent, first line:
  if (isDemo()) return (await import("@/demo/agent")).demoProbe();
// getAgentJson, first line:
  if (isDemo()) return (await import("@/demo/agent")).demoAgentJson(path);
// fetchBars, inside exclusiveTws, first line:
    if (isDemo()) {
      const result = (await import("@/demo/agent")).demoAgentJson(`/bars?port=${port}&symbol=${encodeURIComponent(symbol)}&currency=${encodeURIComponent(currency)}`);
      return result.ok ? { ok: true, payload: result.payload as BarsResponse } : result;
    }
```

Add to the file's doc comment: « En démonstration (sous-projet 41), aucune requête ne part : `src/demo/agent.ts` répond à la place de l'agent. » Look for any other `fetch(\`${AGENT_URL}` in `apps/web/src` (`grep -rn AGENT_URL apps/web/src`), the Flex relay through the agent included: each gets the same guard, or is unreachable in the demo by task 7's `pickFlexRelay` — say which in a comment.

`demo/seed.ts`:

```ts
import { ACTIVABLE_STRATEGIES } from "@ib/ledger";
import type { AppDatabase, SectorRecord } from "@/db/schema";
import { DEMO_ACCOUNT_ID } from "@/demo/mode";
import { DEMO_IB_ACCOUNT, generateDemo } from "@/demo/generate";

const at = (now: Date) => now.toISOString();

function demoSectors(now: Date): SectorRecord[] {
  const rows: [string, string, string, number][] = [
    ["AAPL", "Apple", "Technologie", 8], ["AMD", "Advanced Micro Devices", "Semi-conducteurs", 6], ["KO", "Coca-Cola", "Consommation de base", 7],
    ["MSFT", "Microsoft", "Technologie", 9], ["NVDA", "NVIDIA", "Semi-conducteurs", 8], ["JPM", "JPMorgan Chase", "Finance", 7],
    ["DIS", "Walt Disney", "Communication", 5], ["XSP", "Mini-SPX", "Indice", 7],
  ];
  return rows.map(([ticker, name, category, score]) => ({ ticker, name, category, score, status: "", updatedAt: at(now) }));
}

/** Writes the demo account on an empty demo base, once (sub-project 41, spec §4.2). */
export async function ensureDemoSeeded(db: AppDatabase, now = new Date()): Promise<void> {
  if (await db.accounts.get(DEMO_ACCOUNT_ID)) return;
  const world = generateDemo(now);
  await db.transaction("rw", [db.accounts, db.transactions, db.snapshots, db.cashPoints, db.sectors], async () => {
    if (await db.accounts.get(DEMO_ACCOUNT_ID)) return;
    await db.accounts.put({ id: DEMO_ACCOUNT_ID, label: "Démo", ibAccountId: DEMO_IB_ACCOUNT, createdAt: at(now), warnedDroppedKinds: [], twsPort: 7496, strategies: [...ACTIVABLE_STRATEGIES] });
    await db.transactions.bulkPut(world.transactions);
    // A Flex snapshot on the reference day: the app never opens without one; the first pass
    // of the simulated agent replaces it (spec §6).
    await db.snapshots.put({ accountId: DEMO_ACCOUNT_ID, source: "flex", asOf: world.reference, importedAt: at(now), positions: world.positions, cashAvailable: world.cashAvailable });
    await db.cashPoints.bulkPut(world.cashPoints);
    await db.sectors.bulkPut(demoSectors(now));
  });
}
```

(The `status` of a sector row: check the values the Sectors page accepts, in `db/sectors.ts`, and use the one for "no status".)

`main.tsx` — wait for the seed before mounting:

```tsx
import { isDemo } from "@/demo/mode";
// …
async function start() {
  // The demo base fills itself before the first render (sub-project 41): no page may meet it empty.
  if (isDemo()) await (await import("@/demo/seed")).ensureDemoSeeded(db);
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void start();
```

- [x] **Step 4: Run** — `npx vitest run src/demo src/agent` → PASS.

- [x] **Step 5: Commit** — `git add -A apps/web/src && git commit -m "Démo : l'agent simulé et le remplissage de la base de démo"`

---

### Task 7: Entrer, quitter, et ce que la démo désactive

**Files:**
- Create: `apps/web/src/components/DemoBanner.tsx`, `apps/web/src/components/DemoBanner.test.tsx`
- Modify: `apps/web/src/demo/mode.ts` (+ test), `apps/web/src/routes/AppLayout.tsx`, `apps/web/src/pages/WelcomePage.tsx` (+ test), `apps/web/src/pages/AccountsPage.tsx` (+ test), `apps/web/src/components/AccountSwitcher.tsx` (+ test), `apps/web/src/pages/SourcesPage.tsx` (+ test), `apps/web/src/components/settings/BackupCard.tsx` (+ test), `apps/web/src/flex/relay.ts` (+ test), `apps/web/src/i18n/{fr,en}.json`

**Interfaces:**
- Produces (dans `mode.ts`) : `enterDemo(): void`, `clearDemo(db: Dexie): Promise<void>`, `leaveDemo(db: Dexie, destination?: string): Promise<void>` (défaut `/welcome`) ; `FlexRelayUnavailable` gagne `"demo"` ; clés i18n `demo.banner` (« Mode démonstration — données fictives » / « Demo mode — fictitious data »), `demo.leave` (« Quitter la démo » / « Leave the demo »), `demo.continue` (« Continuer la démo » / « Continue the demo »), `demo.unavailable` (« Indisponible en démonstration » / « Unavailable in the demo »), `demo.accountsTitle` (« Vous êtes en démonstration » / « You are in the demo »), `demo.accountsText` (« Quittez la démo pour ajouter votre compte IB. » / « Leave the demo to add your IB account. »).

- [x] **Step 1: Write the failing tests**

`mode.test.ts` — add:

```ts
import Dexie from "dexie";
import { AppDatabase } from "@/db/schema";
import { DEMO_DB_NAME, clearDemo, enterDemo, leaveDemo, navigation } from "@/demo/mode";

it("enters the demo on its dashboard", () => {
  const assign = vi.spyOn(navigation, "assign").mockImplementation(() => {});
  enterDemo();
  expect(window.sessionStorage.getItem("ib2:demo")).toBe("1");
  expect(assign).toHaveBeenCalledWith("/accounts/demo/dashboard");
});

it("leaves nothing behind, and touches neither the real base nor the real keys", async () => {
  const real = new AppDatabase("ib-analyzer");
  await real.accounts.put({ id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] });
  window.localStorage.setItem("ib2:lastAccountId", "alpha");
  window.sessionStorage.setItem("ib2:demo", "1");
  const demo = new AppDatabase(DEMO_DB_NAME);
  await demo.accounts.put({ id: "demo", label: "Démo", ibAccountId: "U0000000", createdAt: "", warnedDroppedKinds: [] });
  window.localStorage.setItem("ib2:demo:lastAccountId", "demo");
  const assign = vi.spyOn(navigation, "assign").mockImplementation(() => {});
  await leaveDemo(demo, "/accounts");
  expect(await Dexie.exists(DEMO_DB_NAME)).toBe(false);
  expect(window.localStorage.getItem("ib2:demo:lastAccountId")).toBeNull();
  expect(window.sessionStorage.getItem("ib2:demo")).toBeNull();
  expect(window.localStorage.getItem("ib2:lastAccountId")).toBe("alpha");
  expect(await real.accounts.get("alpha")).toBeDefined();
  expect(assign).toHaveBeenCalledWith("/accounts");
  real.close();
});
```

`DemoBanner.test.tsx`:

```tsx
it("shows nothing outside the demo", () => {
  renderBanner();
  expect(screen.queryByText("Mode démonstration — données fictives")).toBeNull();
});

it("says it is the demo and leaves it to the welcome page", async () => {
  window.sessionStorage.setItem("ib2:demo", "1");
  const assign = vi.spyOn(navigation, "assign").mockImplementation(() => {});
  renderBanner();
  await userEvent.setup().click(screen.getByRole("button", { name: "Quitter la démo" }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith("/welcome"));
});
```

(`renderBanner` wraps `<DemoBanner />` in `I18nextProvider` and `DbProvider`; `afterEach` clears `sessionStorage` and restores mocks.)

`WelcomePage.test.tsx` — add: outside the demo, clicking « Explorer la démo » calls `navigation.assign("/accounts/demo/dashboard")`; in the demo, the page shows the banner, a link « Continuer la démo » to `/accounts/demo/dashboard`, and « Ajouter un compte IB » is a button that ends in `navigation.assign("/accounts")`.

`AccountsPage.test.tsx` — add: in the demo, no « Ajouter ce compte » button, the text « Vous êtes en démonstration », and a « Quitter la démo » button.

`AccountSwitcher.test.tsx` — add: in the demo, the option « Quitter la démo » replaces « Ajouter un compte… ».

`SourcesPage.test.tsx` — add, in the demo, the account `demo` seeded: every write control is disabled — the file input (`getByLabelText` of `sources.import.button`), « Relire les relevés », « Supprimer les transactions », the Flex credentials submit, the relay radios, the TWS port save, « Supprimer ce compte » — the notice « Indisponible en démonstration » shows, and a strategy checkbox stays enabled.

`BackupCard.test.tsx` — add: in the demo, export and import buttons and every server button are disabled, with « Indisponible en démonstration ».

`relay.test.ts` — add: in the demo, `pickFlexRelay("agent", true, "authenticated")` → `{ relay: null, reason: "demo" }`.

- [x] **Step 2: Run** — `npx vitest run src/demo src/components src/pages src/flex` → FAIL.

- [x] **Step 3: Implement**

`mode.ts` — add:

```ts
import Dexie from "dexie";

export function enterDemo(): void {
  try {
    window.sessionStorage.setItem(DEMO_FLAG, "1");
  } catch {
    return; // No per-tab storage: the demo cannot be kept apart, so it does not start.
  }
  navigation.assign(`/accounts/${DEMO_ACCOUNT_ID}/dashboard`);
}

/** Deletes the demo base and every demo key; the real base and keys are never touched. */
export async function clearDemo(db: Dexie): Promise<void> {
  db.close();
  await Dexie.delete(DEMO_DB_NAME);
  try {
    const doomed: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("ib2:demo:")) doomed.push(key);
    }
    doomed.forEach((key) => window.localStorage.removeItem(key));
    window.sessionStorage.removeItem(DEMO_FLAG);
  } catch {
    // Best-effort, like every other storage access.
  }
}

export async function leaveDemo(db: Dexie, destination = "/welcome"): Promise<void> {
  await clearDemo(db);
  navigation.assign(destination);
}
```

`DemoBanner.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { Button } from "@ib/ui/button";
import { useDb } from "@/db/DbProvider";
import { isDemo, leaveDemo } from "@/demo/mode";

export function DemoBanner() {
  const { t } = useTranslation();
  const db = useDb();
  if (!isDemo()) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-3 bg-warning/15 px-4 py-2 text-sm">
      <span>{t("demo.banner")}</span>
      <Button variant="outline" size="sm" onClick={() => void leaveDemo(db)}>
        {t("demo.leave")}
      </Button>
    </div>
  );
}
```

`AppLayout.tsx`: `<DemoBanner />` first inside `inset`, above `<header>`.

`WelcomePage.tsx`: `<DemoBanner />` at the top of the page; in `WelcomeActions`, `const demo = isDemo();` — outside the demo: `<Link to="/accounts">` + `<Button variant="outline" onClick={enterDemo}>{t("welcome.exploreDemo")}</Button>`; in the demo: `<Button onClick={() => void leaveDemo(db, "/accounts")}>{t("welcome.addAccount")}</Button>` + `<Link to="/accounts/demo/dashboard" className={cn(buttonVariants({ variant: "outline" }))}>{t("demo.continue")}</Link>`.

`AccountsPage.tsx`: first thing of the component, `if (isDemo()) return <DemoAccountsNotice />;` — a `Card` with `demo.accountsTitle`, `demo.accountsText` and a button `leaveDemo(db, "/accounts")`.

`AccountSwitcher.tsx`: `const LEAVE_DEMO = "__leave_demo__";` — in the demo, the last item is `<SelectItem value={LEAVE_DEMO}>{t("demo.leave")}</SelectItem>` instead of `ADD_ACCOUNT`, and `handleChange` calls `void leaveDemo(db)` on it (`db` from `useDb()`).

`SourcesPage.tsx`: `const demo = isDemo();` at the top; add `|| demo` to every write control of the table in spec §4.4 (file input and its button, replay, purge, statement delete, Flex credentials submit and clear, `FlexRelayRadio` — `disabled={demo}` on the `RadioGroup` —, `SyncCard` run, `AgentCard` port save — the agent refresh button stays: it runs the simulated agent —, delete account); a `<p className="text-sm text-muted-foreground">{t("demo.unavailable")}</p>` at the top of the page in the demo. `StrategiesCard` is unchanged. In the relay-reason chain (`choice.reason === …`), add the `"demo"` branch → `t("demo.unavailable")`.

`BackupCard.tsx`: `const demo = isDemo();` — `serverDisabled` gains `|| demo`, export and import buttons and the file input gain `|| demo`, and a line `demo.unavailable` shows in the demo.

`relay.ts`: `FlexRelayUnavailable` gains `"demo"`; first line of `pickFlexRelay`: `if (isDemo()) return { relay: null, reason: "demo" };` with a comment « Le compte démo n'a aucun jeton, et aucune requête Flex ne part d'une démonstration (sous-projet 41). »

- [x] **Step 4: Run** — `npx vitest run src/demo src/components src/pages src/flex src/routes` → PASS.

- [x] **Step 5: Commit** — `git add -A apps/web/src && git commit -m "Démo : entrer, quitter, et ce que la démonstration désactive"`

---

### Task 8: Les captures générées

**Files:**
- Create: `apps/web/scripts/screenshots.mjs`, `apps/web/src/welcome/shots.test.ts`, `apps/web/public/welcome/*.webp` (24 fichiers générés)
- Modify: `package.json` (racine : script `screenshots`), `apps/web/package.json` (devDependency `sharp`), `apps/web/pwa.config.ts` (+ `pwa.config.test.ts`)

**Interfaces:**
- Consumes: `SHOTS`, `SHOT_THEMES`, `SHOT_LANGUAGES`, `SHOT_WIDTH`, `SHOT_HEIGHT` (task 3) ; the demo (tasks 5-7) ; `devPorts` de `tools/dev-env/ports.mjs`.

- [x] **Step 1: Write the failing tests**

`welcome/shots.test.ts`:

```ts
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { SHOTS, SHOT_LANGUAGES, SHOT_THEMES, shotPath } from "@/welcome/shots";

const PUBLIC = fileURLToPath(new URL("../../public", import.meta.url));

it("has every shot the welcome page shows, in every theme and language", () => {
  const missing = SHOTS.flatMap((s) => SHOT_THEMES.flatMap((theme) => SHOT_LANGUAGES.map((lang) => shotPath(s.id, theme, lang)))).filter((p) => !existsSync(`${PUBLIC}${p}`));
  expect(missing).toEqual([]);
});
```

`pwa.config.test.ts` — add: `expect(pwaOptions.workbox?.globIgnores).toEqual(["agent/**", "welcome/**"]);`

- [x] **Step 2: Run** — `npx vitest run src/welcome pwa.config` → FAIL.

- [x] **Step 3: Implement**

`pwa.config.ts`: `globIgnores: ["agent/**", "welcome/**"]`, with the comment « Les captures de `/welcome` : des images de vitrine pour un visiteur en ligne, qui n'ont pas à peser sur chaque installation (sous-projet 41). »

`pnpm --filter web add -D sharp` (then check `pnpm-lock.yaml` changed and `sharp`'s install script ran: `node -e "require('sharp')"` from `apps/web`).

Root `package.json`: `"screenshots": "node apps/web/scripts/screenshots.mjs"`.

`apps/web/scripts/screenshots.mjs`:

```js
#!/usr/bin/env node
// Régénère les captures de /welcome depuis la démonstration (sous-projet 41, spec §7) :
// `pnpm screenshots`. Démarre ou réutilise le Vite du checkout (tools/dev-env/ports.mjs), ouvre
// l'application en mode démo, horloge figée, et écrit public/welcome/<id>.<thème>.<langue>.webp.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { devPorts } from "../../../tools/dev-env/ports.mjs";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(WEB, "..", "..");
const OUT = join(WEB, "public", "welcome");
const BASE = `http://127.0.0.1:${devPorts(`${ROOT}/`).web}`;
// A Friday during the session, New York time: every capture shows the same day.
const FROZEN = new Date("2026-09-25T15:00:00-04:00");
const VIEWPORT = { width: 1280, height: 800 };
const CHART_SETTLE_MS = 1200;

async function isUp() {
  try {
    return (await fetch(BASE, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

async function ensureVite() {
  if (await isUp()) return null;
  const port = new URL(BASE).port;
  const server = spawn("pnpm", ["--filter", "web", "exec", "vite", "--port", port, "--strictPort"], { cwd: ROOT, detached: true, stdio: "ignore" });
  for (let i = 0; i < 60; i += 1) {
    if (await isUp()) return server;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite did not answer on ${BASE}`);
}

```

Node 22 cannot import `src/welcome/shots.ts` directly: the manifest is loaded **through the running Vite**, from the page, as `run-frontend/driver.mjs` does for `seed.ts`. Continue the script (the `for` loops below go inside the `try`, after the manifest):

```js
const server = await ensureVite();
const { chromium } = await import(pathToFileURL(join(WEB, "node_modules/playwright/index.mjs")).href);
const sharp = (await import("sharp")).default;
const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });

async function openDemo(theme) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, reducedMotion: "reduce", colorScheme: theme });
  await context.addInitScript((t) => {
    window.sessionStorage.setItem("ib2:demo", "1");
    window.localStorage.setItem("ib2:theme", t);
  }, theme);
  const page = await context.newPage();
  await page.clock.setFixedTime(FROZEN);
  return { context, page };
}

try {
  const first = await openDemo("light");
  await first.page.goto(`${BASE}/welcome`, { waitUntil: "networkidle" });
  const manifest = await first.page.evaluate(() =>
    import("/src/welcome/shots.ts").then((m) => ({ shots: m.SHOTS, themes: m.SHOT_THEMES, languages: m.SHOT_LANGUAGES, width: m.SHOT_WIDTH, height: m.SHOT_HEIGHT })),
  );
  await first.context.close();
  // … the loops below …
} finally {
  await browser.close();
  if (server) process.kill(-server.pid, "SIGTERM");
}
```

The loops, inside the `try`:

```js
for (const theme of manifest.themes) {
  for (const lang of manifest.languages) {
    const { context, page } = await openDemo(theme);
    for (const shot of manifest.shots) {
      await page.goto(`${BASE}${shot.route}`, { waitUntil: "networkidle" });
      await page.evaluate((l) => import("/src/i18n/index.ts").then((m) => m.default.changeLanguage(l)), lang);
      await page.getByText(/En direct|Live/).first().waitFor({ timeout: 15_000 });
      await page.locator(shot.waitFor).first().waitFor({ timeout: 15_000 });
      if (shot.prepare) await PREPARE[shot.prepare](page);
      await page.evaluate(() => document.fonts.ready);
      if ((await page.locator("[_echarts_instance_]").count()) > 0) await page.waitForTimeout(CHART_SETTLE_MS);
      const png = await page.screenshot();
      const file = join(OUT, `${shot.id}.${theme}.${lang}.webp`);
      await sharp(png).resize(manifest.width, manifest.height).webp({ quality: 85 }).toFile(file);
      console.log(file);
    }
    await context.close();
  }
}
```

Define `PREPARE` (an object of async functions taking the page) above the `try`:

- `"expand-first-condor"`: click the first row toggle of the Condors table — read `StrategyPositionsPage`/`condorPositions` rendering to find its accessible name (a button with `aria-expanded`), then `page.getByRole("button", { expanded: false }).first().click()` scoped to that table.
- `"open-first-chart"`: open the price chart of the first ticker of the Wheel page — read `components/PositionTable.tsx` and `PositionChartRow.tsx` for the control that opens a chart row, click it, then wait for the chart's `canvas`.

The `En direct` wait: check the exact label of `snapshot.live` in `fr.json`/`en.json` (« En direct, {{time}} ») and match on its fixed part in both languages.

Then generate: `pnpm screenshots`. **Open every file** — at least the six `light.fr` ones with the Read tool — and check: the demo banner is visible, « En direct » shows, the Wheel shot has a chart with its levels, the Condors shot has an expanded condor, no « — » where a value is expected, no error. Fix the scenario or the preparation if a shot is wrong, then regenerate.

- [x] **Step 4: Run** — `npx vitest run src/welcome pwa.config` → PASS ; `du -sh apps/web/public/welcome` → under 4 Mo.

- [x] **Step 5: Commit** — `git add package.json apps/web/package.json pnpm-lock.yaml apps/web/pwa.config.ts apps/web/pwa.config.test.ts apps/web/scripts/screenshots.mjs apps/web/src/welcome apps/web/public/welcome && git commit -m "Accueil : captures générées depuis la démo par pnpm screenshots"`

---

### Task 9: De bout en bout — entrer dans la démo et la quitter sur un vrai build

**Files:**
- Create: `apps/web/e2e-offline/demo.spec.ts`

**Interfaces:**
- Consumes: `startServer`, `DIST` (`e2e-offline/server.ts`, `global-setup.ts`).

- [x] **Step 1: Write the test**

```ts
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { DIST } from "./global-setup";
import { startServer, type StaticServer } from "./server";

let server: StaticServer;
test.beforeEach(async () => {
  server = await startServer(join(DIST, "a"));
});
test.afterEach(async () => {
  await server.stop().catch(() => {});
});

test("un navigateur neuf arrive sur l'accueil, explore la démo et la quitte sans trace", async ({ page }) => {
  await page.goto(`${server.url}/`);
  await page.waitForURL(/\/welcome$/);
  await page.getByRole("button", { name: "Explorer la démo" }).click();
  await page.waitForURL(/\/accounts\/demo\/dashboard$/);
  await expect(page.getByRole("status").filter({ hasText: "Mode démonstration" })).toBeVisible();
  await expect(page.getByText(/En direct/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Quitter la démo" }).click();
  await page.waitForURL(/\/welcome$/);
  const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(names).not.toContain("ib-analyzer-demo");
  const accounts = await page.evaluate(() => sessionStorage.getItem("ib2:demo"));
  expect(accounts).toBeNull();
});

test("les captures ne sont pas pré-cachées", async ({ page }) => {
  await page.goto(`${server.url}/welcome`);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const urls = (await Promise.all(keys.map(async (k) => (await (await caches.open(k)).keys()).map((r) => r.url)))).flat();
    return urls.filter((u) => u.includes("/welcome/"));
  });
  expect(cached).toEqual([]);
});
```

(The route `/` must not be a server prefix of `server.ts`; check that the static server serves `public/welcome/*.webp` from the build — Vite copies `public/` into `dist/`.)

- [x] **Step 2: Run** — `pnpm --filter web e2e:offline` → PASS (the whole suite: the 7 existing tests still pass).

- [x] **Step 3: Commit** — `git add apps/web/e2e-offline/demo.spec.ts && git commit -m "e2e : entrer dans la démo et la quitter sur un vrai build"`

---

### Task 10: Documentation, vérification finale, instance de relecture

**Files:**
- Modify: `CLAUDE.md`, `.claude/skills/run-frontend/SKILL.md`, `docs/specs/2026-09-29-page-accueil-et-demo-design.md`

- [x] **Step 1: CLAUDE.md** — add three rules to « Règles qui mordent si on les oublie », after the rule « La base locale appartient au navigateur » :

```markdown
- **Un navigateur sans compte arrive sur `/welcome`** (sous-projet 41) : `RootRedirect` y mène,
  la page reste accessible avec des comptes — c'est le lien qu'on partage —, et le menu sans
  compte offre « Ajouter un compte IB » et « Découvrir IB Analyzer ». `/accounts` reste la page
  de gestion ; aucune présentation n'y revit.
- **La démonstration a sa propre base, jamais un compte dans la vraie** : `isDemo()`
  (`apps/web/src/demo/mode.ts`) est le seul lecteur du drapeau `sessionStorage` `ib2:demo`, par
  onglet ; `schema.ts` en tire le nom de la base au chargement du module (`ib-analyzer-demo`),
  seule exception à « une seule base par origine », et entrer ou quitter recharge toujours la
  page. Les clés d'affichage du `localStorage` passent par `storageKey` (`ib2:demo:…`). En démo,
  `agent/client.ts` délègue à `src/demo/agent.ts` et **aucune requête ne part vers l'agent réel** ;
  Sources, sauvegarde et relais Flex sont grisés. La graine est un scénario (`demo/scenario.ts`)
  dont `generate.ts` calcule snapshot et cash ; `generate.test.ts` la tient sans écart de
  reconstitution ni de cash sur plusieurs jours de visite. Hors `mode.ts`, tout `src/demo/` se
  charge par `import()`.
- **Les captures de `/welcome` se régénèrent, jamais à la main** : `pnpm screenshots` lit le
  manifeste `src/welcome/shots.ts`, ouvre la démo horloge figée et écrit
  `public/welcome/<id>.<thème>.<langue>.webp`, exclus du pré-cache. Un test exige les quatre
  fichiers de chaque capture déclarée.
```

Registry: add `| 41 | La page d'accueil, la démonstration et ses captures | fait (2026-09-29) |`. In « Outillage », after the `run-frontend` paragraph: « `pnpm screenshots` régénère les captures de `/welcome` depuis la démonstration (sous-projet 41). »

- [x] **Step 2: run-frontend** — in `SKILL.md`, a short section « Captures de la vitrine » : `pnpm screenshots`, not the driver; `--seed` stays the developers' check tool.

- [x] **Step 3: Spec** — `Statut : implémenté (<date>).`

- [x] **Step 4: `pnpm check`** at the repository root, **once** → lint, typecheck, build, all tests PASS. Fix anything that fails, re-run.

- [x] **Step 5: Commit** — `git commit -am "Sous-projet 41 : documentation"`

- [x] **Step 6: Instance de relecture** — `pnpm dev:start` in the worktree; give Seb the two URLs (Vite and Django of the worktree's slot) and the path to try: `/` on a fresh profile → `/welcome` → « Explorer la démo » → « Quitter la démo ». Stop it with `pnpm dev:stop` **before** any merge.
