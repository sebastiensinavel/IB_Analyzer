# Sous-projet 28 — Premiers pas : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal :** rendre l'arrivée d'un nouvel utilisateur compréhensible — ce qu'est l'application,
ce qu'il crée en « ajoutant un compte », ce que la connexion ouvre et pourquoi elle est
facultative, et quelle est sa première action utile.

**Architecture :** aucun changement de donnée, de flux, de route ni de serveur. Un bloc
d'accueil et un formulaire renommé sur la page Comptes ; un libellé « Compte serveur »
facultatif aux trois endroits où « Se connecter » apparaît ; une carte « Première étape »
rendue tant que rien n'a jamais alimenté le compte, sur Sources de données et sur le tableau
de bord ; l'Aide réorganisée en premiers pas. Tout le nouveau texte passe par i18n.

**Tech Stack :** TypeScript, React 19, react-router, react-i18next, Dexie 4, Vitest sur
`fake-indexeddb`, Testing Library, base-ui (shadcn).

**Spec :** `docs/specs/2026-09-22-premiers-pas-design.md`

## Global Constraints

- **Rien dans `apps/api`. Rien dans `packages/`.** Ce sous-projet vit entièrement dans
  `apps/web` et dans `docs/`. Une tâche qui semble réclamer un endpoint, un modèle ou une
  migration est un **signal d'arrêt** : s'arrêter et demander.
- **Aucun changement de comportement.** La validation du formulaire d'ajout crée le compte et
  navigue vers `/accounts/:id/sources`, exactement comme aujourd'hui. Aucune route n'est
  ajoutée, supprimée ni protégée. Aucune table Dexie n'est touchée, aucune migration.
- **La connexion n'est jamais exigée.** Tout texte ajouté doit le rendre évident. Aucune garde,
  aucun rebond vers `/login`.
- **Aucun nom de domaine dans un fichier versionné.** La page Aide continue de lire
  `window.location.origin` ; aucune commande n'est écrite en dur.
- **Textes** : aucune chaîne visible en dur dans un composant. Toute chaîne passe par
  `apps/web/src/i18n/fr.json` **et** `apps/web/src/i18n/en.json`, les deux mis à jour dans le
  même commit. L'anglais est une traduction fidèle, jamais un résumé.
- **Un test doit échouer si le comportement change.** Pas de test qui couvre des lignes sans
  rien fixer. Aucun hook n'est moqué : les tests de page sèment la base
  (`fake-indexeddb`) et rendent le vrai composant.
- **Commits en français**, sujet à l'impératif, et **la case du plan cochée dans le même
  commit que la tâche**.
- **Commande de test ciblée** : depuis `apps/web`, `npx vitest run <motif>`. La forme
  `pnpm --filter web test -- <motif>` **ne filtre pas** (le script est `vitest run`).
- **`pnpm check` une seule fois, à la fin** (tâche 10). Il lance lint, typage, build et tous
  les tests.

## Structure des fichiers

| Fichier | Responsabilité | Tâches |
|---|---|---|
| `apps/web/src/db/hooks.ts` | `useNeverFed` : rien n'a jamais alimenté ce compte | 1 |
| `apps/web/src/db/hooks.test.tsx` | fixe les quatre états du hook | 1 |
| `apps/web/src/components/FirstStepCard.tsx` | la carte « Première étape » | 2 |
| `apps/web/src/components/FirstStepCard.test.tsx` | fixe ses deux liens et son texte | 2 |
| `apps/web/src/pages/SourcesPage.tsx` | la carte en tête de page | 3 |
| `apps/web/src/pages/SourcesPage.test.tsx` | présente sur un compte neuf, absente après un import | 3 |
| `apps/web/src/pages/DashboardPage.tsx` | la carte à la place de « Aucune position » | 4 |
| `apps/web/src/pages/DashboardPage.test.tsx` | les deux branches | 4 |
| `apps/web/src/pages/AccountsPage.tsx` | bloc d'accueil (5), formulaire renommé (6), lien de session (7) | 5, 6, 7 |
| `apps/web/src/pages/AccountsPage.test.tsx` | fixe les trois | 5, 6, 7 |
| `apps/web/src/components/SessionMenuItem.tsx` | « Compte serveur », facultatif | 7 |
| `apps/web/src/components/SessionMenuItem.test.tsx` | fixe le libellé | 7 |
| `apps/web/src/pages/SettingsPage.tsx` | carte Compte : même libellé | 7 |
| `apps/web/src/pages/SettingsPage.test.tsx` | fixe le libellé | 7 |
| `apps/web/src/pages/LoginPage.tsx` | titre « Compte serveur », introduction, retour | 8 |
| `apps/web/src/pages/LoginPage.test.tsx` | fixe l'introduction et le retour | 8 |
| `apps/web/src/pages/HelpPage.tsx` | sections réordonnées, `id` d'ancrage | 9 |
| `apps/web/src/pages/HelpPage.test.tsx` | fixe l'ordre et les ancres | 9 |
| `apps/web/src/i18n/{fr,en}.json` | tous les textes | 2, 5, 6, 7, 8, 9 |
| `docs/specs/2026-09-03-architecture-design.md` | §9, note du sous-projet 28 | 10 |
| `CLAUDE.md` | le registre des sous-projets | 10 |

---

## Task 1 : `useNeverFed`, le critère « rien n'a jamais alimenté ce compte »

**Files:**
- Modify: `apps/web/src/db/hooks.ts`
- Test: `apps/web/src/db/hooks.test.tsx`

**Interfaces:**
- Consumes : `useAccount(id)` et `useImports(accountId)`, déjà dans le même fichier.
- Produces : `export function useNeverFed(accountId: string): boolean | undefined`.
  `undefined` tant qu'une des deux requêtes n'a pas répondu ; `true` quand aucun
  `ImportRecord` n'existe pour le compte **et** que `lastAgentSyncAt` est absent de sa fiche ;
  `false` sinon. Les tâches 3 et 4 l'utilisent.

- [x] **Step 1: Write the failing test**

Ajouter à la fin de `apps/web/src/db/hooks.test.tsx`. Ajouter `useNeverFed` à l'import déjà
présent depuis `@/db/hooks`.

```tsx
/**
 * The criterion behind the « Première étape » card: a statement import and a Flex sync both
 * write an ImportRecord, the agent writes none but stamps `lastAgentSyncAt`. A refused import
 * counts — the user acted, and the import report answers them from then on.
 */
describe("useNeverFed", () => {
  it("is undefined while the queries have not answered", () => {
    const { result } = renderHook(() => useNeverFed("nope"), { wrapper });
    expect(result.current).toBeUndefined();
  });

  it("is true on an account nothing has ever fed", async () => {
    const account = await seedAccount();
    const { result } = renderHook(() => useNeverFed(account.id), { wrapper });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("is false once an import has been recorded, even a refused one", async () => {
    const account = await seedAccount();
    await db.imports.add({
      accountId: account.id,
      source: "statement_html",
      at: "2026-09-01T10:00:00.000Z",
      fileName: "refused.htm",
      period: null,
      imported: 0,
      skipped: 0,
      dropped: [],
      issues: [{ severity: "error", code: "normalization", detail: "nope" }],
    });
    const { result } = renderHook(() => useNeverFed(account.id), { wrapper });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("is false once the agent has passed, which writes no import record", async () => {
    const account = await seedAccount();
    await db.accounts.update(account.id, { lastAgentSyncAt: "2026-09-22T12:00:00.000Z" });
    const { result } = renderHook(() => useNeverFed(account.id), { wrapper });
    await waitFor(() => expect(result.current).toBe(false));
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Depuis `apps/web` : `npx vitest run src/db/hooks.test.tsx -t useNeverFed`
Attendu : échec, `useNeverFed` n'est pas exporté par `@/db/hooks`.

- [x] **Step 3: Write the implementation**

Ajouter dans `apps/web/src/db/hooks.ts`, juste après `useImports` :

```ts
/**
 * True when nothing has ever fed this account. Both a statement import and a Flex sync go
 * through `importFile`, so both leave an `ImportRecord` — a refused one included, which is
 * wanted: the user acted, and the import report answers them from then on. The agent writes
 * no record at all (see `ImportRecord.source`) and stamps `lastAgentSyncAt` instead, so the
 * account record is the second half of the criterion.
 *
 * `undefined` while either query is still answering: a caller that rendered on a bare `false`
 * would flash a card away a moment after showing it.
 */
export function useNeverFed(accountId: string): boolean | undefined {
  const account = useAccount(accountId);
  const imports = useImports(accountId);
  if (account === undefined || imports === undefined) return undefined;
  return imports.length === 0 && account?.lastAgentSyncAt === undefined;
}
```

- [x] **Step 4: Run the test to verify it passes**

Depuis `apps/web` : `npx vitest run src/db/hooks.test.tsx -t useNeverFed`
Attendu : quatre tests au vert.

- [x] **Step 5: Commit**

Cocher les cases de la tâche 1 dans ce plan, puis :

```bash
git add apps/web/src/db/hooks.ts apps/web/src/db/hooks.test.tsx docs/plans/2026-09-22-premiers-pas.md
git commit -m "Ajoute useNeverFed, le critère du compte jamais alimenté"
```

---

## Task 2 : la carte « Première étape »

**Files:**
- Create: `apps/web/src/components/FirstStepCard.tsx`
- Create: `apps/web/src/components/FirstStepCard.test.tsx`
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`

**Interfaces:**
- Consumes : rien de la tâche 1 — la carte ne décide pas de sa propre visibilité, ses appelants
  le font.
- Produces : `export function FirstStepCard(props: { accountId: string; showSourcesLink?: boolean }): JSX.Element`.
  `showSourcesLink` vaut `true` par défaut ; la page Sources de données passe `false`, on y est
  déjà. Les tâches 3 et 4 l'utilisent.

- [x] **Step 1: Write the failing test**

Créer `apps/web/src/components/FirstStepCard.test.tsx` :

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import i18n from "@/i18n";
import { FirstStepCard } from "./FirstStepCard";

function renderCard(showSourcesLink?: boolean) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <FirstStepCard accountId="beta" showSourcesLink={showSourcesLink} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe("FirstStepCard", () => {
  it("names the two ways to feed an account and links to both pages", () => {
    renderCard();
    expect(screen.getByText("Première étape")).toBeInTheDocument();
    expect(screen.getByText(/relevé d'activité HTML/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aller aux sources de données" })).toHaveAttribute(
      "href",
      "/accounts/beta/sources",
    );
    expect(screen.getByRole("link", { name: "Comment obtenir un relevé" })).toHaveAttribute("href", "/help#statement");
  });

  // On the Sources page itself, a link to the Sources page is noise; the Help link is not.
  it("drops the sources link when asked, keeping the help link", () => {
    renderCard(false);
    expect(screen.queryByRole("link", { name: "Aller aux sources de données" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Comment obtenir un relevé" })).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Depuis `apps/web` : `npx vitest run src/components/FirstStepCard.test.tsx`
Attendu : échec, le module `./FirstStepCard` n'existe pas.

- [x] **Step 3: Add the texts**

Dans `apps/web/src/i18n/fr.json`, ajouter un bloc `firstStep` **après** le bloc `accounts` :

```json
  "firstStep": {
    "title": "Première étape",
    "text": "Importez un relevé d'activité HTML exporté du Client Portal, ou renseignez le jeton et l'identifiant de votre Flex Query. Le tableau de bord se remplit dès le premier import.",
    "sourcesLink": "Aller aux sources de données",
    "helpLink": "Comment obtenir un relevé"
  },
```

Et dans `apps/web/src/i18n/en.json`, au même endroit :

```json
  "firstStep": {
    "title": "First step",
    "text": "Import an activity statement in HTML exported from the Client Portal, or fill in your Flex Query token and id. The dashboard fills up with the first import.",
    "sourcesLink": "Go to data sources",
    "helpLink": "How to get a statement"
  },
```

- [x] **Step 4: Write the implementation**

Créer `apps/web/src/components/FirstStepCard.tsx` :

```tsx
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
```

- [x] **Step 5: Run the tests to verify they pass**

Depuis `apps/web` : `npx vitest run src/components/FirstStepCard.test.tsx src/i18n`
Attendu : tout au vert, parité des clés comprise.

- [x] **Step 6: Commit**

Cocher les cases de la tâche 2, puis :

```bash
git add apps/web/src/components/FirstStepCard.tsx apps/web/src/components/FirstStepCard.test.tsx apps/web/src/i18n/fr.json apps/web/src/i18n/en.json docs/plans/2026-09-22-premiers-pas.md
git commit -m "Ajoute la carte Première étape"
```

---

## Task 3 : la carte en tête de Sources de données

**Files:**
- Modify: `apps/web/src/pages/SourcesPage.tsx`
- Test: `apps/web/src/pages/SourcesPage.test.tsx`

**Interfaces:**
- Consumes : `useNeverFed` (tâche 1), `FirstStepCard` (tâche 2).
- Produces : rien.

- [x] **Step 1: Write the failing test**

Ajouter dans `apps/web/src/pages/SourcesPage.test.tsx`, dans le `describe` principal :

```tsx
  it("opens with the first-step card while nothing has ever fed the account", async () => {
    renderSources();
    expect(await screen.findByText("Première étape")).toBeInTheDocument();
    // We are already on Sources: only the help link is offered here.
    expect(screen.queryByRole("link", { name: "Aller aux sources de données" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Comment obtenir un relevé" })).toBeInTheDocument();
  });

  it("drops the first-step card once an import has been recorded", async () => {
    await db.imports.add({
      accountId: "test",
      source: "statement_html",
      at: "2026-09-01T10:00:00.000Z",
      fileName: "x.htm",
      period: null,
      imported: 3,
      skipped: 0,
      dropped: [],
      issues: [],
    });
    renderSources();
    expect(await screen.findByText("Compte")).toBeInTheDocument();
    expect(screen.queryByText("Première étape")).not.toBeInTheDocument();
  });
```

- [x] **Step 2: Run the test to verify it fails**

Depuis `apps/web` : `npx vitest run src/pages/SourcesPage.test.tsx -t "first-step"`
Attendu : échec, « Première étape » introuvable.

- [x] **Step 3: Write the implementation**

Dans `apps/web/src/pages/SourcesPage.tsx` :

1. Ajouter aux imports :

```ts
import { FirstStepCard } from "@/components/FirstStepCard";
```

et ajouter `useNeverFed` à l'import existant depuis `@/db/hooks`.

2. Dans le corps de `SourcesPage`, à côté des autres hooks (avant tout `return` conditionnel,
   la règle des hooks l'impose) :

```ts
  const neverFed = useNeverFed(accountId);
```

3. Dans le JSX du `return` principal, **juste après** le `<h1>` et **avant** la carte
   `sources.account.title` :

```tsx
      {neverFed === true && <FirstStepCard accountId={account.id} showSourcesLink={false} />}
```

- [x] **Step 4: Run the tests to verify they pass**

Depuis `apps/web` : `npx vitest run src/pages/SourcesPage.test.tsx`
Attendu : tout le fichier au vert, les tests existants compris.

- [x] **Step 5: Commit**

Cocher les cases de la tâche 3, puis :

```bash
git add apps/web/src/pages/SourcesPage.tsx apps/web/src/pages/SourcesPage.test.tsx docs/plans/2026-09-22-premiers-pas.md
git commit -m "Ouvre Sources de données par la carte Première étape"
```

---

## Task 4 : la carte à la place d'un tableau de bord vide

**Files:**
- Modify: `apps/web/src/pages/DashboardPage.tsx`
- Test: `apps/web/src/pages/DashboardPage.test.tsx`

**Interfaces:**
- Consumes : `useNeverFed` (tâche 1), `FirstStepCard` (tâche 2).
- Produces : rien.

**Contexte :** `DashboardPage` rend aujourd'hui une carte `noPositions` (texte
`positions.empty` et lien `positions.emptyLink`) dans deux endroits : un `return` anticipé
quand `report === null && !stats`, et une cellule du `return` principal. **Seul le `return`
anticipé change** : atteindre le second suppose des statistiques, donc des transactions, donc
un import ou une passe d'agent — `neverFed` y est forcément `false`.

- [ ] **Step 1: Repair the existing empty-state test, then write the failing ones**

**Un test existant casse sous ce changement, et c'est attendu.**
`it("shows the empty state with a link to the data sources without a snapshot")` rend le
compte `alpha` sans transaction, sans snapshot **et sans import** : il passe donc par le
`return` anticipé, où `neverFed` vaudra désormais `true`. Son intention est de fixer l'état
vide **d'un compte déjà alimenté**, pas celui d'un compte neuf — que les nouveaux tests
couvrent. Lui donner de quoi être ce qu'il teste, en tête de ce test :

```tsx
    await db.imports.add({
      accountId: "alpha",
      source: "statement_html",
      at: "2026-09-01T10:00:00.000Z",
      fileName: "x.htm",
      period: null,
      imported: 0,
      skipped: 0,
      dropped: [],
      issues: [],
    });
```

Et ajouter `db.imports.clear()` au `beforeEach` du fichier, pour que cet import ne fuie pas
dans les tests suivants.

L'autre test qui cherche le même texte, `it("keeps the journal cards without a snapshot, …")`,
sème des transactions : il a donc des statistiques, passe par le `return` principal, et n'est
pas concerné. Ne pas y toucher.

Ajouter ensuite dans `apps/web/src/pages/DashboardPage.test.tsx`.

```tsx
describe("DashboardPage: a brand new account", () => {
  beforeEach(async () => {
    await db.accounts.clear();
    await db.accounts.add({ id: "neuf", label: "Neuf", ibAccountId: "U0000009", createdAt: "", warnedDroppedKinds: [] });
  });

  it("shows the first step instead of an empty page", async () => {
    renderDashboard("neuf");
    expect(await screen.findByText("Première étape")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aller aux sources de données" })).toHaveAttribute(
      "href",
      "/accounts/neuf/sources",
    );
    expect(screen.queryByText(/Aucune position —/)).not.toBeInTheDocument();
  });

  it("goes back to « Aucune position » once an import happened without a snapshot", async () => {
    await db.imports.add({
      accountId: "neuf",
      source: "statement_html",
      at: "2026-09-01T10:00:00.000Z",
      fileName: "x.htm",
      period: null,
      imported: 0,
      skipped: 0,
      dropped: [],
      issues: [],
    });
    renderDashboard("neuf");
    expect(await screen.findByText(/Aucune position —/)).toBeInTheDocument();
    expect(screen.queryByText("Première étape")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Depuis `apps/web` : `npx vitest run src/pages/DashboardPage.test.tsx -t "brand new"`
Attendu : échec sur le premier test, « Première étape » introuvable.

- [ ] **Step 3: Write the implementation**

Dans `apps/web/src/pages/DashboardPage.tsx` :

1. Ajouter aux imports :

```ts
import { FirstStepCard } from "@/components/FirstStepCard";
import { useNeverFed } from "@/db/hooks";
```

2. Dans le corps, à côté des autres hooks, avant le `return` de chargement :

```ts
  const neverFed = useNeverFed(accountId);
```

3. Remplacer le `return` anticipé existant

```tsx
  if (report === null && !stats) {
    return (
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {title}
        {noPositions}
        <PositionSuggestionsCard accountId={accountId} report={report} />
      </div>
    );
  }
```

par

```tsx
  if (report === null && !stats) {
    // An account nothing has ever fed gets a first step rather than an empty page: this is
    // where « Ouvrir » lands a newcomer straight after they added their account. While
    // `neverFed` is still undefined, neither card is rendered — showing one and swapping it a
    // moment later reads as a glitch.
    return (
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {title}
        {neverFed === true && <FirstStepCard accountId={accountId} />}
        {neverFed === false && noPositions}
        <PositionSuggestionsCard accountId={accountId} report={report} />
      </div>
    );
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Depuis `apps/web` : `npx vitest run src/pages/DashboardPage.test.tsx`
Attendu : tout le fichier au vert.

- [ ] **Step 5: Commit**

Cocher les cases de la tâche 4, puis :

```bash
git add apps/web/src/pages/DashboardPage.tsx apps/web/src/pages/DashboardPage.test.tsx docs/plans/2026-09-22-premiers-pas.md
git commit -m "Remplace le tableau de bord vide d'un compte neuf par la première étape"
```

---

## Task 5 : le bloc d'accueil de la page Comptes

**Files:**
- Modify: `apps/web/src/pages/AccountsPage.tsx`
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Test: `apps/web/src/pages/AccountsPage.test.tsx`

**Interfaces:**
- Consumes : rien.
- Produces : un composant local `WelcomeCard` **non exporté**, rendu en tête de
  `AccountsPage`. Aucune autre tâche ne l'utilise.

- [ ] **Step 1: Write the failing test**

Ajouter dans `apps/web/src/pages/AccountsPage.test.tsx`, dans le `describe("AccountsPage")` :

```tsx
  it("opens with what the application is, and says data stays in this browser", async () => {
    renderPage();
    expect(await screen.findByText(/Analysez vos portefeuilles Interactive Brokers/)).toBeInTheDocument();
    expect(screen.getByText(/le serveur ne voit jamais vos transactions/)).toBeInTheDocument();
    expect(screen.getByText("Comment ça marche")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Premiers pas" })).toHaveAttribute("href", "/help");
  });

  // Decided 2026-09-22: adding an account does not wipe the page a newcomer just read — the
  // same page keeps serving to add another account and to open one.
  it("keeps the welcome block once accounts exist", async () => {
    await db.accounts.add({ id: "alpha", label: "Alpha", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] });
    renderPage();
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText(/Analysez vos portefeuilles Interactive Brokers/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Depuis `apps/web` : `npx vitest run src/pages/AccountsPage.test.tsx -t "welcome"`
Attendu : échec, l'accroche est introuvable.

- [ ] **Step 3: Add the texts**

Dans `apps/web/src/i18n/fr.json`, dans le bloc `accounts`, ajouter la clé `welcome` juste
après `"title"` :

```json
    "welcome": {
      "tagline": "Analysez vos portefeuilles Interactive Brokers, actions et options.",
      "benefits": [
        "Couverture de vos ventes d'options et cash requis, à tout instant.",
        "Journaux Wheel, LEAPS et Condors reconstitués depuis votre historique.",
        "Historique complet, positions et statistiques par stratégie."
      ],
      "privacy": "Vos données restent dans ce navigateur : le serveur ne voit jamais vos transactions ni vos positions.",
      "howTitle": "Comment ça marche",
      "steps": [
        "Ajoutez un compte IB ci-dessous.",
        "Importez un relevé d'activité, ou branchez une Flex Query.",
        "Lisez votre tableau de bord ; l'agent local, facultatif, ajoute les données en direct."
      ],
      "helpLink": "Premiers pas"
    },
```

Dans `apps/web/src/i18n/en.json`, au même endroit :

```json
    "welcome": {
      "tagline": "Analyse your Interactive Brokers portfolios, shares and options.",
      "benefits": [
        "Coverage of your option sales and the cash they require, at any time.",
        "Wheel, LEAPS and Condor journals rebuilt from your own history.",
        "Full history, positions and per-strategy statistics."
      ],
      "privacy": "Your data stays in this browser: the server never sees your transactions or your positions.",
      "howTitle": "How it works",
      "steps": [
        "Add an IB account below.",
        "Import an activity statement, or set up a Flex Query.",
        "Read your dashboard; the local agent, optional, adds live data."
      ],
      "helpLink": "Getting started"
    },
```

- [ ] **Step 4: Write the implementation**

Dans `apps/web/src/pages/AccountsPage.tsx` :

1. Rendre `<WelcomeCard />` en tête, **juste après** le `<div>` de l'en-tête et **avant** la
   carte qui liste les comptes :

```tsx
      <WelcomeCard />
```

2. Ajouter ce composant en bas du fichier, à côté de `SessionCorner` :

```tsx
/**
 * `/accounts` is the landing page of a device with no local account, and the only route a
 * newcomer reaches on their own: nothing else tells them what this application is. Rendered
 * whatever the number of accounts — decided 2026-09-22 — because the page keeps serving to
 * add another account and to open one, and a block that vanished on the first add would
 * change the page under the user right after they acted.
 */
function WelcomeCard() {
  const { t } = useTranslation();
  const benefits = t("accounts.welcome.benefits", { returnObjects: true }) as string[];
  const steps = t("accounts.welcome.steps", { returnObjects: true }) as string[];

  return (
    <Card>
      <CardHeader>
        <CardTitle>IB Analyzer</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p>{t("accounts.welcome.tagline")}</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {benefits.map((benefit) => (
            <li key={benefit}>{benefit}</li>
          ))}
        </ul>
        <p className="rounded-md bg-muted px-3 py-2">{t("accounts.welcome.privacy")}</p>
        <div className="flex flex-col gap-1">
          <p className="font-medium">{t("accounts.welcome.howTitle")}</p>
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
        <div>
          <Link to="/help" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            {t("accounts.welcome.helpLink")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
```

`Card`, `CardHeader`, `CardTitle`, `CardContent`, `Link`, `buttonVariants`, `cn` et
`useTranslation` sont déjà importés par le fichier.

- [ ] **Step 5: Run the tests to verify they pass**

Depuis `apps/web` : `npx vitest run src/pages/AccountsPage.test.tsx src/i18n`
Attendu : tout au vert.

- [ ] **Step 6: Commit**

Cocher les cases de la tâche 5, puis :

```bash
git add apps/web/src/pages/AccountsPage.tsx apps/web/src/pages/AccountsPage.test.tsx apps/web/src/i18n/fr.json apps/web/src/i18n/en.json docs/plans/2026-09-22-premiers-pas.md
git commit -m "Ouvre la page Comptes sur ce qu'est l'application"
```

---

## Task 6 : « Ajouter un compte IB », pas « Créer le compte »

**Files:**
- Modify: `apps/web/src/pages/AccountsPage.tsx`
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Test: `apps/web/src/pages/AccountsPage.test.tsx`

**Interfaces:**
- Consumes : rien.
- Produces : rien. **La validation du formulaire ne change pas** : `createAccount` puis
  `navigate("/accounts/:id/sources")`.

- [ ] **Step 1: Update the existing tests and add the new ones**

Dans `apps/web/src/pages/AccountsPage.test.tsx`, les trois tests existants nomment les
anciens libellés. Les mettre à jour :

- `it("says there is no account yet", …)` : attendre `/Aucun compte IB pour l'instant/`.
- `it("creates an account and lands on its data sources", …)` : `getByLabelText("Nom")` et
  `getByRole("button", { name: "Ajouter ce compte" })`. **Ne pas toucher aux deux assertions
  de fin** : la navigation vers `/accounts/beta/sources` et la ligne en base restent le
  comportement attendu.
- `it("shows the error for a bad IB id and creates nothing", …)` : mêmes deux remplacements.

Puis ajouter :

```tsx
  it("says what an account here is, and what the IB id is for", async () => {
    renderPage();
    expect(await screen.findByText("Ajouter un compte IB")).toBeInTheDocument();
    expect(screen.getByText(/compte Interactive Brokers que vous suivez/)).toBeInTheDocument();
    expect(screen.getByText(/vérifier que les fichiers importés et l'agent local/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Depuis `apps/web` : `npx vitest run src/pages/AccountsPage.test.tsx`
Attendu : échec des quatre tests ci-dessus, les libellés n'existent pas encore.

- [ ] **Step 3: Change the texts**

Dans `apps/web/src/i18n/fr.json`, bloc `accounts` :

```json
    "title": "Vos comptes Interactive Brokers",
    "empty": "Aucun compte IB pour l'instant. Ajoutez le premier ci-dessous.",
    "addTitle": "Ajouter un compte IB",
    "addHint": "Un compte ici est un compte Interactive Brokers que vous suivez. Il est créé dans ce navigateur ; rien n'est envoyé.",
    "label": "Nom",
    "labelPlaceholder": "Compte marge",
    "ibAccountId": "Identifiant de compte IB",
    "ibAccountIdHint": "Tel qu'affiché dans le Client Portal, ex. U1234567. Il sert à vérifier que les fichiers importés et l'agent local sont bien ceux de ce compte.",
    "create": "Ajouter ce compte",
```

Dans `apps/web/src/i18n/en.json`, bloc `accounts` :

```json
    "title": "Your Interactive Brokers accounts",
    "empty": "No IB account yet. Add the first one below.",
    "addTitle": "Add an IB account",
    "addHint": "An account here is an Interactive Brokers account you track. It is created in this browser; nothing is sent.",
    "label": "Name",
    "labelPlaceholder": "Margin account",
    "ibAccountId": "IB account id",
    "ibAccountIdHint": "As shown in the Client Portal, e.g. U1234567. It checks that imported files and the local agent really belong to this account.",
    "create": "Add this account",
```

Les clés `open`, `add` et `errors.*` ne changent pas.

- [ ] **Step 4: Change the form**

Dans `apps/web/src/pages/AccountsPage.tsx`, la carte du formulaire devient :

```tsx
      <Card>
        <CardHeader>
          <CardTitle>{t("accounts.addTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t("accounts.addHint")}</p>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {t("accounts.label")}
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t("accounts.labelPlaceholder")}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t("accounts.ibAccountId")}
              <Input value={ibAccountId} onChange={(e) => setIbAccountId(e.target.value)} placeholder="U1234567" required />
            </label>
            <p className="-mt-2 text-xs text-muted-foreground">{t("accounts.ibAccountIdHint")}</p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit">{t("accounts.create")}</Button>
          </form>
        </CardContent>
      </Card>
```

`handleSubmit` n'est pas touché.

- [ ] **Step 5: Run the tests to verify they pass**

Depuis `apps/web` : `npx vitest run src/pages/AccountsPage.test.tsx src/i18n`
Attendu : tout au vert, la navigation vers `/accounts/beta/sources` comprise.

- [ ] **Step 6: Commit**

Cocher les cases de la tâche 6, puis :

```bash
git add apps/web/src/pages/AccountsPage.tsx apps/web/src/pages/AccountsPage.test.tsx apps/web/src/i18n/fr.json apps/web/src/i18n/en.json docs/plans/2026-09-22-premiers-pas.md
git commit -m "Nomme l'ajout d'un compte IB pour ce qu'il est"
```

---

## Task 7 : « Compte serveur », facultatif, aux trois endroits

**Files:**
- Modify: `apps/web/src/pages/AccountsPage.tsx` (`SessionCorner`)
- Modify: `apps/web/src/components/SessionMenuItem.tsx`
- Modify: `apps/web/src/pages/SettingsPage.tsx`
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Test: `apps/web/src/pages/AccountsPage.test.tsx`, `apps/web/src/components/SessionMenuItem.test.tsx`,
  `apps/web/src/pages/SettingsPage.test.tsx`

**Interfaces:**
- Consumes : rien.
- Produces : trois clés i18n, `auth.serverAccount`, `auth.optional` et
  `auth.serverAccountTitle`, utilisées par la tâche 8. `auth.signIn` **reste** et garde son
  texte : c'est le libellé du bouton de validation de la page de connexion.

**Il existe un quatrième `auth.signIn`, et il ne change pas.**
`apps/web/src/pages/SourcesPage.tsx` (carte Synchronisation, variable `showSignIn`) offre un
lien de connexion quand le relais serveur est autorisé, l'agent absent et la session anonyme.
Là, se connecter n'est pas facultatif : c'est ce qui manque pour faire ce que l'utilisateur
vient de demander, et l'appeler « facultatif » contredirait le message juste à côté. **Ce lien
garde `auth.signIn` et n'est pas touché par cette tâche.** Décidé au scan préalable du
2026-09-22.

**Forme retenue, identique aux trois endroits :** le lien porte `title` et `aria-label` valant
`auth.serverAccountTitle` ; son contenu visible est `auth.serverAccount` suivi de
`auth.optional` en petit et atténué. L'`aria-label` donne donc le nom accessible : les tests
interrogent le lien par `{ name: /Compte serveur, facultatif/ }`, et le mot visible par
`getByText("facultatif")`.

- [ ] **Step 1: Write the failing tests**

Dans `apps/web/src/pages/AccountsPage.test.tsx`, `describe("AccountsPage: session")`,
remplacer les recherches `{ name: "Se connecter" }` par la nouvelle forme, dans les quatre
tests qui en portent, et ajouter l'assertion du mot visible dans le premier :

```tsx
  it("offers a way to sign in when anonymous", async () => {
    renderWithSession(async () => jsonResponse({}, 401));
    const link = await screen.findByRole("link", { name: /Compte serveur, facultatif/ });
    expect(link).toHaveAttribute("href", "/login");
    // The word must be readable, not only announced: a newcomer has to see the server is optional.
    expect(screen.getByText("facultatif")).toBeInTheDocument();
  });
```

Les trois autres tests du bloc (`unreachable`, `signed in`, `loading`) gardent leur structure,
avec `{ name: /Compte serveur, facultatif/ }` à la place de `{ name: "Se connecter" }`.

Dans `apps/web/src/components/SessionMenuItem.test.tsx`, remplacer de même
`{ name: "Se connecter" }` par `{ name: /Compte serveur, facultatif/ }` dans les tests
`anonymous`, `unreachable` et tout test de déconnexion qui l'utilise, et ajouter dans le test
`anonymous` :

```tsx
    expect(screen.getByText("facultatif")).toBeInTheDocument();
```

Dans `apps/web/src/pages/SettingsPage.test.tsx`, ajouter :

Ce fichier n'a pas de moquage de `useSession` : il rend un vrai `SessionProvider` et moque
`fetch`. Son premier test, `it("offers only a sign-in link when anonymous, …")`, cherche
`{ name: "Se connecter" }` : c'est cette ligne qui change, et une assertion s'y ajoute.

```tsx
  it("offers only a sign-in link when anonymous, no account-management cards", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 401));

    renderPage();

    expect(await screen.findByText("Non connecté.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Compte serveur, facultatif/ })).toHaveAttribute("href", "/login");
    // The word must be readable, not only announced.
    expect(screen.getByText("facultatif")).toBeInTheDocument();
    expect(screen.queryByText("Changer le mot de passe")).not.toBeInTheDocument();
    expect(screen.queryByText("Authentification à deux facteurs")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Depuis `apps/web` :
`npx vitest run src/pages/AccountsPage.test.tsx src/components/SessionMenuItem.test.tsx src/pages/SettingsPage.test.tsx`
Attendu : échec, aucun lien ne porte ce nom.

- [ ] **Step 3: Add the texts**

Dans `apps/web/src/i18n/fr.json`, bloc `auth`, après `"signOut"` :

```json
    "serverAccount": "Compte serveur",
    "optional": "facultatif",
    "serverAccountTitle": "Compte serveur, facultatif : relais Flex Query et sauvegarde chiffrée.",
```

Dans `apps/web/src/i18n/en.json`, bloc `auth` :

```json
    "serverAccount": "Server account",
    "optional": "optional",
    "serverAccountTitle": "Server account, optional: Flex Query relay and encrypted backup.",
```

- [ ] **Step 4: Change the three places**

Dans `apps/web/src/pages/AccountsPage.tsx`, `SessionCorner`, le `return` final :

```tsx
  return (
    // `cn(...)` is not decoration: `buttonVariants` emits both `border-transparent` (base)
    // and `border-border` (outline), and only tailwind-merge picks the winner.
    <Link
      to="/login"
      title={t("auth.serverAccountTitle")}
      aria-label={t("auth.serverAccountTitle")}
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
    >
      {t("auth.serverAccount")}
      <span className="text-xs font-normal text-muted-foreground">{t("auth.optional")}</span>
    </Link>
  );
```

Dans `apps/web/src/components/SessionMenuItem.tsx`, le `return` final :

```tsx
  return (
    <Link
      to="/login"
      title={t("auth.serverAccountTitle")}
      aria-label={t("auth.serverAccountTitle")}
      className="flex w-full items-center gap-1.5 px-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <LogIn className="size-3.5" />
      {t("auth.serverAccount")}
      <span className="opacity-70">{t("auth.optional")}</span>
    </Link>
  );
```

Dans `apps/web/src/pages/SettingsPage.tsx`, la branche `anonymous`/`unreachable` de la carte
Compte :

```tsx
              <Link
                to="/login"
                title={t("auth.serverAccountTitle")}
                aria-label={t("auth.serverAccountTitle")}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
              >
                {t("auth.serverAccount")}
                <span className="text-xs font-normal text-muted-foreground">{t("auth.optional")}</span>
              </Link>
```

`SettingsPage.tsx` importe `buttonVariants` mais pas `cn` : ajouter
`import { cn } from "@ib/ui/lib/utils";`.

- [ ] **Step 5: Run the tests to verify they pass**

Depuis `apps/web` :
`npx vitest run src/pages/AccountsPage.test.tsx src/components/SessionMenuItem.test.tsx src/pages/SettingsPage.test.tsx src/i18n`
Attendu : tout au vert.

- [ ] **Step 6: Commit**

Cocher les cases de la tâche 7, puis :

```bash
git add apps/web/src/pages/AccountsPage.tsx apps/web/src/pages/AccountsPage.test.tsx apps/web/src/components/SessionMenuItem.tsx apps/web/src/components/SessionMenuItem.test.tsx apps/web/src/pages/SettingsPage.tsx apps/web/src/pages/SettingsPage.test.tsx apps/web/src/i18n/fr.json apps/web/src/i18n/en.json docs/plans/2026-09-22-premiers-pas.md
git commit -m "Nomme la connexion compte serveur et la dit facultative"
```

---

## Task 8 : la page de connexion dit ce qu'elle ouvre

**Files:**
- Modify: `apps/web/src/pages/LoginPage.tsx`
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Test: `apps/web/src/pages/LoginPage.test.tsx`

**Interfaces:**
- Consumes : `auth.serverAccount` (tâche 7).
- Produces : rien.

- [ ] **Step 1: Write the failing test**

Ajouter dans `apps/web/src/pages/LoginPage.test.tsx` :

```tsx
  it("says what a server account opens, what works without one, and that it is by invitation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    renderPage();
    expect(await screen.findByText(/relais de votre Flex Query par le serveur/)).toBeInTheDocument();
    expect(screen.getByText(/Tout le reste fonctionne sans/)).toBeInTheDocument();
    expect(screen.getByText(/L'accès se fait sur invitation/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retour" })).toHaveAttribute("href", "/");
  });
```

Ce fichier interroge le bouton de validation par `{ name: /se connecter|sign in/i }` : ce
bouton garde `auth.signIn`, les tests existants ne changent pas.

- [ ] **Step 2: Run the test to verify it fails**

Depuis `apps/web` : `npx vitest run src/pages/LoginPage.test.tsx -t invitation`
Attendu : échec, l'introduction n'existe pas.

- [ ] **Step 3: Add the texts**

Dans `apps/web/src/i18n/fr.json`, bloc `auth` :

```json
    "intro": {
      "opens": "Un compte serveur ouvre deux choses : le relais de votre Flex Query par le serveur quand l'agent local est absent, et la sauvegarde chiffrée de vos données.",
      "without": "Tout le reste fonctionne sans : relevés, Flex Query par l'agent local, journaux, positions.",
      "invitation": "L'accès se fait sur invitation. Sans invitation, il ne vous manque rien : fermez cette page et continuez."
    },
    "back": "Retour",
```

Dans `apps/web/src/i18n/en.json`, bloc `auth` :

```json
    "intro": {
      "opens": "A server account opens two things: the server relaying your Flex Query when the local agent is absent, and the encrypted backup of your data.",
      "without": "Everything else works without it: statements, Flex Query through the local agent, journals, positions.",
      "invitation": "Access is by invitation. Without one you are missing nothing: close this page and carry on."
    },
    "back": "Back",
```

- [ ] **Step 4: Write the implementation**

Dans `apps/web/src/pages/LoginPage.tsx`, entre l'en-tête et la `<Card>`, insérer le titre et
l'introduction :

```tsx
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-lg font-semibold tracking-tight">{t("auth.serverAccount")}</h1>
        {/* No route is protected (spec §7.3): reaching this page is always a choice. Saying so
            here is what keeps a newcomer from reading a closed door where there is an option. */}
        <p className="text-sm text-muted-foreground">{t("auth.intro.opens")}</p>
        <p className="text-sm text-muted-foreground">{t("auth.intro.without")}</p>
        <p className="text-sm text-muted-foreground">{t("auth.intro.invitation")}</p>
      </div>
```

Et sous la `<Card>`, un retour vers l'écran d'où l'on vient :

```tsx
      <div>
        <Link to={from} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          {t("auth.back")}
        </Link>
      </div>
```

`from` est déjà calculé dans le composant ; `Link` est déjà importé.

- [ ] **Step 5: Run the tests to verify they pass**

Depuis `apps/web` : `npx vitest run src/pages/LoginPage.test.tsx src/i18n`
Attendu : tout au vert, les tests d'identifiants refusés et de serveur injoignable compris.

- [ ] **Step 6: Commit**

Cocher les cases de la tâche 8, puis :

```bash
git add apps/web/src/pages/LoginPage.tsx apps/web/src/pages/LoginPage.test.tsx apps/web/src/i18n/fr.json apps/web/src/i18n/en.json docs/plans/2026-09-22-premiers-pas.md
git commit -m "Dit sur la page de connexion ce qu'un compte serveur ouvre"
```

---

## Task 9 : l'Aide en premiers pas

**Files:**
- Modify: `apps/web/src/pages/HelpPage.tsx`
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Test: `apps/web/src/pages/HelpPage.test.tsx`

**Interfaces:**
- Consumes : rien.
- Produces : les ancres `#statement` et `#flex`, visées par `FirstStepCard` (tâche 2).

**Deux faits à ne pas réinventer :**

1. `checkSections` (`packages/ib-parsers/src/flex.ts`) n'exige que **quatre** sections :
   Trades, Cash Transactions, Open Positions, Cash Report. **Corporate Actions est lu mais
   jamais vérifié** : décochée, elle ne produit aucun avertissement et les opérations sur
   titres manquent en silence. L'Aide nomme donc les cinq.
2. **L'Aide fait cocher « Select All » par section**, jamais des colonnes une à une (spec
   §5.1). Aucune liste de colonnes n'est écrite.

**Les chemins de menu du Client Portal ne sont pas vérifiables par un agent** : ils sont
écrits tels que le spec §5 les donne, et Seb les vérifie à la relecture de la branche. Ne pas
tenter d'ouvrir le Client Portal ; ne pas inventer un autre chemin.

- [ ] **Step 1: Write the failing test**

Ajouter dans `apps/web/src/pages/HelpPage.test.tsx` :

`CardTitle` (`packages/ui/src/components/ui/card.tsx`) rend un `div` portant
`data-slot="card-title"`, **pas un titre** : l'ordre se lit sur cet attribut, jamais par
`getAllByRole("heading")`, qui ne trouverait rien.

```tsx
  it("opens on what the application is, then the two data sources, then the agent", async () => {
    mockIndex(new Response("", { status: 404 }));
    const { container } = render(<MemoryRouter><HelpPage /></MemoryRouter>);
    await screen.findByText("L'application");
    const titles = [...container.querySelectorAll("[data-slot=card-title]")].map((el) => el.textContent);
    expect(titles).toEqual([
      "L'application",
      "1. Obtenir un relevé d'activité",
      "2. Configurer une Flex Query",
      "3. L'agent local",
      "4. Installer uv",
      "5. Installer l'agent",
      "6. Le configurer et le lancer",
      "7. Régler l'API de TWS",
      "8. La permission du navigateur",
      "9. Renseigner le port",
    ]);
  });

  it("anchors the two sections the first-step card points at", async () => {
    mockIndex(new Response("", { status: 404 }));
    const { container } = render(<MemoryRouter><HelpPage /></MemoryRouter>);
    await screen.findByText("L'application");
    expect(container.querySelector("#statement")).not.toBeNull();
    expect(container.querySelector("#flex")).not.toBeNull();
  });

  // Listing columns one by one would be long to follow and wrong the day the parser reads one
  // more; Corporate Actions is named because nothing warns when it is missing.
  it("tells the user to select all of each section, and names the five", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText(/Select All/)).toBeInTheDocument();
    for (const section of ["Trades", "Cash Transactions", "Corporate Actions", "Open Positions", "Cash Report"]) {
      expect(screen.getByText(new RegExp(section))).toBeInTheDocument();
    }
  });
```

`Card` étale ses props sur son `div` racine : `id` y passe tel quel, rien à changer dans
`packages/ui`.

- [ ] **Step 2: Run the test to verify it fails**

Depuis `apps/web` : `npx vitest run src/pages/HelpPage.test.tsx`
Attendu : échec des trois nouveaux tests.

- [ ] **Step 3: Add the texts**

Dans `apps/web/src/i18n/fr.json`, bloc `help`, ajouter **avant** `"what"` :

```json
    "app": {
      "title": "L'application",
      "text": "IB Analyzer analyse vos portefeuilles Interactive Brokers, actions et options : couverture de vos ventes d'options et cash requis, journaux Wheel, LEAPS et Condors reconstitués depuis votre historique, historique complet, positions et statistiques par stratégie.",
      "privacy": "Vos données restent dans ce navigateur : le serveur ne voit jamais vos transactions ni vos positions.",
      "tiers": [
        "Un relevé d'activité HTML seul, ou une Flex Query seule, suffit : historique, positions, couverture et journaux.",
        "Les deux ensemble ajoutent l'historique au-delà des 365 jours de la Flex Query.",
        "L'agent local, facultatif, ajoute les positions et les exécutions du jour."
      ]
    },
    "statement": {
      "title": "1. Obtenir un relevé d'activité",
      "text": "Dans le Client Portal : Performance & Reports › Statements › Activity. Choisissez la période la plus longue proposée, le format HTML, et téléchargez.",
      "items": [
        "Un relevé par année pour remonter loin : « Sources de données › Importer des fichiers » accepte plusieurs fichiers à la fois et les écrit dans l'ordre de leurs périodes.",
        "Le fichier est conservé dans ce navigateur pour pouvoir être rejoué ; « Relire les relevés » reconstruit tout depuis les fichiers gardés.",
        "Un relevé porte aussi vos positions et votre cash à sa fin de période : un seul fichier suffit à remplir l'application."
      ]
    },
    "flex": {
      "title": "2. Configurer une Flex Query",
      "text": "Dans le Client Portal : Performance & Reports › Flex Queries. Créez une Activity Flex Query, période « Last 365 days », format XML.",
      "selectAll": "Dans chaque section, cochez « Select All » plutôt que les champs un par un : c'est plus rapide, et rien ne manquera le jour où l'application lira une colonne de plus.",
      "sectionsTitle": "Les sections à inclure",
      "sections": [
        "Trades",
        "Cash Transactions",
        "Corporate Actions",
        "Open Positions",
        "Cash Report"
      ],
      "corporateActions": "Corporate Actions est la seule dont l'absence ne déclenche aucun avertissement : sans elle, splits et fusions manquent en silence.",
      "token": "Activez ensuite le Flex Web Service et copiez le jeton ; notez l'identifiant de la requête. Saisissez les deux dans « Sources de données › Flex Query ».",
      "missing": "Ce que l'application ne trouve pas est listé dans Sources de données à chaque synchronisation."
    },
```

Et renuméroter les titres existants du même bloc : `"what"` devient `"3. L'agent local"`,
`"uv"` `"4. Installer uv"`, `"install"` `"5. Installer l'agent"`, `"configure"`
`"6. Le configurer et le lancer"`, `"tws"` `"7. Régler l'API de TWS"`, `"chrome"`
`"8. La permission du navigateur"`, `"port"` `"9. Renseigner le port"`. **Leurs autres clés
ne changent pas d'un mot.**

Dans `apps/web/src/i18n/en.json`, la traduction fidèle des mêmes clés, avec les mêmes numéros.
Les noms de sections de la Flex Query et « Select All » restent en anglais dans les deux
langues : ce sont les libellés de l'interface d'Interactive Brokers.

- [ ] **Step 4: Write the implementation**

Dans `apps/web/src/pages/HelpPage.tsx` :

1. `Section` accepte une ancre :

```tsx
function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <Card id={id}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">{children}</CardContent>
    </Card>
  );
}
```

2. Dans le JSX, **avant** la section `help.what`, insérer les trois nouvelles :

```tsx
      <Section title={t("help.app.title")}>
        <p className="text-muted-foreground">{t("help.app.text")}</p>
        <p className="rounded-md bg-muted px-3 py-2">{t("help.app.privacy")}</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {(t("help.app.tiers", { returnObjects: true }) as string[]).map((tier) => (
            <li key={tier}>{tier}</li>
          ))}
        </ul>
      </Section>

      <Section id="statement" title={t("help.statement.title")}>
        <p className="text-muted-foreground">{t("help.statement.text")}</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {(t("help.statement.items", { returnObjects: true }) as string[]).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Section>

      <Section id="flex" title={t("help.flex.title")}>
        <p className="text-muted-foreground">{t("help.flex.text")}</p>
        <p>{t("help.flex.selectAll")}</p>
        <div className="flex flex-col gap-1">
          <p className="font-medium">{t("help.flex.sectionsTitle")}</p>
          <ul className="list-disc space-y-1 pl-5 font-mono text-xs">
            {(t("help.flex.sections", { returnObjects: true }) as string[]).map((section) => (
              <li key={section}>{section}</li>
            ))}
          </ul>
        </div>
        <p className="text-muted-foreground">{t("help.flex.corporateActions")}</p>
        <p className="text-muted-foreground">{t("help.flex.token")}</p>
        <p className="text-muted-foreground">{t("help.flex.missing")}</p>
      </Section>
```

Les sections de l'agent gardent leur JSX mot pour mot, dans leur ordre actuel, après
celles-ci.

- [ ] **Step 5: Run the tests to verify they pass**

Depuis `apps/web` : `npx vitest run src/pages/HelpPage.test.tsx src/components/FirstStepCard.test.tsx src/i18n`
Attendu : tout au vert, les six tests existants de l'Aide compris.

- [ ] **Step 6: Commit**

Cocher les cases de la tâche 9, puis :

```bash
git add apps/web/src/pages/HelpPage.tsx apps/web/src/pages/HelpPage.test.tsx apps/web/src/i18n/fr.json apps/web/src/i18n/en.json docs/plans/2026-09-22-premiers-pas.md
git commit -m "Réorganise l'Aide en premiers pas"
```

---

## Task 10 : la documentation et la vérification d'ensemble

**Files:**
- Modify: `docs/specs/2026-09-03-architecture-design.md` (§9)
- Modify: `CLAUDE.md` (registre des sous-projets)
- Modify: `docs/specs/2026-09-22-premiers-pas-design.md` (statut)

**Interfaces:**
- Consumes : tout ce qui précède.
- Produces : rien.

- [ ] **Step 1: Note the change in the architecture spec**

À la fin du §9 de `docs/specs/2026-09-03-architecture-design.md`, ajouter :

```markdown
**Note du 2026-09-22** : la page Comptes s'ouvre sur un bloc d'accueil permanent — ce qu'est
l'application, la promesse que les données restent dans le navigateur, et les trois étapes du
démarrage —, et son formulaire dit « Ajouter un compte IB ». « Se connecter » s'appelle
« Compte serveur » et porte le mot « facultatif » partout où il apparaît. Une carte
« Première étape » tient lieu de page tant que rien n'a jamais alimenté un compte, sur
Sources de données et sur le tableau de bord. L'Aide est réorganisée en premiers pas :
l'application, le relevé d'activité, la Flex Query, puis l'agent
(`2026-09-22-premiers-pas-design.md`).
```

- [ ] **Step 2: Add the registry line in CLAUDE.md**

Dans le tableau des sous-projets de `CLAUDE.md`, après la ligne 27 :

```markdown
| 28 | Premiers pas : accueil, compte serveur facultatif, première étape, Aide | fait (2026-09-22) |
```

- [ ] **Step 3: Mark the spec done**

Dans `docs/specs/2026-09-22-premiers-pas-design.md`, remplacer `Statut : spécifié
(2026-09-22).` par `Statut : livré (2026-09-22).`

- [ ] **Step 4: Run the full check**

Depuis la racine du dépôt : `pnpm check`
Attendu : lint, typage, fraîcheur du schéma d'API, build et **tous** les tests au vert. Ne
rien conclure avant d'avoir lu la sortie ; un échec se corrige ici, il ne se reporte pas.

- [ ] **Step 5: Commit**

Cocher les cases de la tâche 10, puis :

```bash
git add CLAUDE.md docs/specs/2026-09-03-architecture-design.md docs/specs/2026-09-22-premiers-pas-design.md docs/plans/2026-09-22-premiers-pas.md
git commit -m "Consigne les premiers pas dans le spec et le registre"
```

- [ ] **Step 6: Start the dev instance for review**

Depuis le worktree : `pnpm dev:start`, puis donner les deux URL à Seb. **Ne pas arrêter
l'instance ni fusionner** : Seb regarde la branche avant de décider du merge (CLAUDE.md,
Workflow).

---

## Revue du plan contre le spec

- §2.1 bloc d'accueil → tâche 5. §2.2 formulaire renommé → tâche 6.
- §3.1 « Compte serveur » aux trois endroits, « facultatif » visible → tâche 7.
- §3.2 introduction et retour de la page de connexion → tâche 8.
- §4.1 la carte → tâche 2. §4.2 critère, Sources, tableau de bord → tâches 1, 3, 4.
- §5 Aide réorganisée, §5.1 tout cocher, Corporate Actions → tâche 9.
- §6 textes → tâches 2, 5, 6, 7, 8, 9, les deux langues à chaque fois.
- §7 tests → chaque tâche porte les siens ; la parité i18n est vérifiée à cinq reprises.
- §8 décisions → aucune tâche ne les rouvre ; la tâche 6 fixe explicitement que la navigation
  après validation ne change pas.
