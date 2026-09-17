# Sous-projet 11 — La page Consistance et ses indicateurs permanents

Statut : implémenté (2026-09-11).

Trois vérifications disent aujourd'hui si l'application peut être crue, et chacune est rangée
sous l'écran qui l'a vue naître : les positions non couvertes au Dashboard, la reconstitution du
portefeuille contre le snapshot dans les quatre Journaux, la cohérence du cash dans l'Historique.
Il faut ouvrir trois pages pour savoir si tout va bien, et rien ne le signale ailleurs.

Ce sous-projet les réunit dans une page **Consistance** et fait apparaître en permanence, dans la
barre de titre, deux verdicts : **Couverture** et **Reconstitution**. Un clic sur l'un ou l'autre
ouvre la page.

---

## 1. Périmètre

Dans le périmètre :

- deux indicateurs dans la barre de titre, à droite du nom du compte, liés à la page Consistance ;
- une page `/accounts/:id/consistency`, entrée de menu sous Sources de données ;
- le déplacement de trois cartes vers cette page : positions non couvertes (Dashboard),
  reconstitution du portefeuille (Journaux), cohérence du cash (Historique) ;
- un fournisseur de contexte qui calcule une seule fois, dans la coquille, les journaux et le
  rapport de risque du compte affiché.

Hors périmètre, déclaré tel :

- **un troisième indicateur pour le cash** : la carte « Cohérence du cash » rejoint la page, mais
  la barre de titre n'en porte pas de verdict ;
- **les écarts d'identité** (`identityIssues`) : ils restent sur Sources de données ;
- **un nouveau calcul** : aucune fonction de `packages/ledger` ni de `packages/coverage` ne change.
  Les verdicts se lisent dans ce que `buildRiskReport` et `buildJournals` rendent déjà ;
- **les indicateurs hors compte** : Paramètres, Aide et la page de compte inconnu n'affichent pas
  de nom de compte, donc pas d'indicateurs.

---

## 2. Verdicts

`apps/web/src/lib/consistency.ts`, fonctions pures, sans React :

```ts
export type ConsistencyStatus = "ok" | "alert" | "unknown";
export interface CoverageVerdict { status: ConsistencyStatus; loading: boolean; uncovered: number }
export interface ReconstitutionVerdict { status: ConsistencyStatus; loading: boolean; gaps: number; asOf: string | null }

/** `report` au sens de `RiskReportView.report` : `undefined` en chargement, `null` sans snapshot. */
export function coverageVerdict(report: RiskReport | null | undefined): CoverageVerdict;
export function reconstitutionVerdict(journals: JournalsView): ReconstitutionVerdict;
```

`loading` distingue le chargement de l'absence de snapshot ; `uncovered` et `gaps` (écarts plus
orphelines) portent le nombre que la barre de titre annonce, 0 hors `alert` ; `asOf` date le
snapshot contre lequel le rejeu a été vérifié.

| Verdict | `ok` | `alert` | `unknown` |
|---|---|---|---|
| Couverture | `uncovered(report)` vide | `uncovered(report)` non vide | `report` `undefined` ou `null` |
| Reconstitution | `asOf` présent, `differences` et `orphans` vides | `asOf` présent, au moins un écart **ou** une orpheline | `journals.status === "loading"`, ou `asOf === null` |

La Reconstitution suit la carte existante, qui quitte l'état « conforme » dès qu'une ligne
orpheline existe, même sans écart.

**Un écart de reconstitution est une alerte.** Le spec des journaux (§4, §7.2) le présentait
comme « une information, jamais une erreur ». Ce sous-projet remplace cette phrase : un
historique tronqué — `alpha` relevés seuls, figé à 4 écarts jusqu'au sous-projet 10 — garde
son indicateur Reconstitution rouge en permanence. C'est voulu : l'indicateur dit que le
portefeuille reconstitué ne peut pas être cru, quelle qu'en soit la raison. La carte continue
d'expliquer qu'un historique incomplet suffit à le produire.

---

## 3. Barre de titre

`apps/web/src/components/ConsistencyIndicators.tsx`, rendu par `AppLayout` à droite de la barre
(`ml-auto`), **seulement quand un compte est affiché** (`scoped` non nul).

- Un unique `<Link>` vers `/accounts/:id/consistency`, arrondi, sans bordure, fond `muted` au
  survol et au focus clavier.
- Deux paires côte à côte, séparées par un espace : `Couverture` + icône, `Reconstitution` +
  icône. L'icône est `ShieldCheck` (lucide), celle de l'état vide de la carte des positions non
  couvertes.
- Couleur de l'icône par état : `text-success` pour `ok`, `text-destructive` pour `alert`,
  `text-muted-foreground` pour `unknown`. Les libellés restent en `text-muted-foreground`, et
  passent en `text-foreground` au survol et au focus clavier, avec le fond.
- **Couverture en `alert` clignote** : `motion-safe:animate-pulse` sur l'icône seule, fondu
  d'opacité doux. Un système réglé sur « réduire les animations » garde le rouge sans le
  mouvement. Reconstitution en `alert` ne clignote jamais. Aucun état `ok` ou `unknown` ne
  clignote.
- Sous le point de rupture `sm`, les libellés sont masqués (`hidden sm:inline`), les icônes
  restent.
- Le lien porte un `aria-label`, repris en `title`, qui dit les deux états en une phrase :

  | Verdict | Texte (fr) |
  |---|---|
  | Couverture `ok` | « Couverture : aucune position non couverte » |
  | Couverture `alert` | « Couverture : {count} position(s) non couverte(s) » (pluriel i18next) |
  | Couverture `unknown` | « Couverture : aucun snapshot de positions » |
  | Reconstitution `ok` | « Reconstitution : conforme au snapshot du {date} » |
  | Reconstitution `alert` | « Reconstitution : {count} écart(s) avec le snapshot du {date} », où `count` = écarts + orphelines |
  | Reconstitution `unknown` | « Reconstitution : aucun snapshot de positions » |

  Les deux phrases sont jointes par « . ». Pendant le chargement, chacune dit « Couverture :
  chargement… », « Reconstitution : chargement… » au lieu de « aucun snapshot ». La date passe
  par `formatSnapshotDate` (`lib/format.ts`), extraite de `ReconciliationCard` : `asOf` tel quel
  s'il fait 10 caractères, `formatDateTime` sinon.

---

## 4. Calcul partagé

`apps/web/src/db/AccountDataProvider.tsx` :

```tsx
export function AccountDataProvider({ accountId, children }: { accountId: string; children: ReactNode });
export function useAccountJournals(): JournalsView;
export function useAccountRiskReport(): RiskReportView;
```

- Le fournisseur appelle une fois `useJournals(accountId)` et `useRiskReport(accountId)`
  (`db/hooks.ts`, inchangés) et publie les deux vues dans un contexte.
- `AppLayout` le monte autour de la barre de titre et de l'`Outlet` quand `scoped` est non nul.
  Sans compte affiché, il n'est pas monté.
- Les deux hooks consommateurs **lèvent une erreur hors du fournisseur**. Un repli silencieux sur
  `useJournals` referait le double calcul sans que rien ne le montre.
- `ConsistencyIndicators`, `ConsistencyPage`, `JournalPage`, `StatsPage`, `SourcesPage`,
  `DashboardPage` et `PositionsPage` lisent le contexte ; **aucune page n'appelle plus
  `useJournals` ni `useRiskReport` directement.**

Conséquence assumée : `buildJournals` tourne désormais sur toutes les pages d'un compte, y
compris Dashboard, Positions et Historique, qui ne le calculaient pas. C'est le prix d'un
indicateur toujours visible. En échange, un changement du ledger ne déclenche qu'un rejeu quelle
que soit la page, et passer d'un journal à l'autre ne recalcule plus rien — chaque page le
recalculait à son montage.

---

## 5. Page Consistance

`apps/web/src/pages/ConsistencyPage.tsx`, route `consistency` sous `/accounts/:accountId`.

En-tête comme le Dashboard : titre `nav.consistency` à gauche, `SnapshotStatus` à droite. Puis
trois cartes empilées, pleine largeur, dans cet ordre, chacune avec un `CardHeader` titré :

1. **Positions non couvertes** — `components/UncoveredCard.tsx`, extrait du Dashboard sans
   changement de rendu : badge portant le nombre (`warning` s'il est non nul, `outline` sinon),
   liste `formatContract` + quantité non couverte en `text-destructive`, état vide `ShieldCheck`
   vert « Aucune position non couverte. ». **État nouveau sans snapshot** (`report === null`) :
   pas de badge, texte neutre « Aucun snapshot de positions : importez un relevé HTML ou une
   réponse Flex, ou lancez l'agent. » et un lien vers Sources de données — les clés
   `reconciliation.none` et `reconciliation.noneLink`, la phrase de la carte voisine.
2. **Reconstitution du portefeuille** — `ReconciliationCard`, ses trois états inchangés. Le
   composant gagne un titre.
3. **Cohérence du cash** — `CashCheckCard`, ses quatre états inchangés, alimentée par
   `anchoredBalances(ledger, BALANCE_CURRENCIES, points)` avec `useLedger` et `useCashPoints`.
   Le composant gagne un titre. **Toujours affichée**, même sur un ledger vide : elle y dit
   « aucun Cash Report » avec son lien vers les sources, là où l'Historique la masquait.

`BALANCE_CURRENCIES` quitte `HistoryPage.tsx` pour un module `lib/currencies.ts`, importé par
l'Historique et par Consistance. Une seule définition.

Chargement : une ligne « Chargement… » tant que le rapport, les journaux, le ledger ou les points
de cash ne sont pas prêts.

---

## 6. Ce qui quitte les autres pages

- **Dashboard** : la carte des positions non couvertes. La carte « Marge de cash » garde sa
  demi-largeur dans la grille `md:grid-cols-2`. L'état vide sans snapshot ne change pas.
- **Journaux** (les quatre) : `ReconciliationCard`. Rien d'autre.
- **Historique** : `CashCheckCard`. Le calage des soldes reste. `history.columns.balanceHint`
  cesse de citer « la carte au-dessus du tableau » et renvoie à la page Consistance.

---

## 7. Menu, route, traductions

- `lib/navigation.ts`, section `nav.sections.configuration` : entrée `nav.consistency`, icône
  `ShieldCheck`, `accountPath("consistency")`, **entre** Sources de données et Paramètres.
- `routes/router.tsx` : `{ path: "consistency", element: <ConsistencyPage /> }`.
- `i18n/fr.json` et `i18n/en.json`, mêmes clés dans les deux :
  - `nav.consistency` : « Consistance » / « Consistency » ;
  - `consistency.uncovered.title` et `consistency.uncovered.empty`, déménagés de
    `dashboard.uncoveredCard.*`, qui disparaît ; `consistency.reconciliation.title`,
    `consistency.cash.title` ;
  - `consistency.indicators.coverage.*` et `consistency.indicators.reconstitution.*` : `label`,
    `ok`, `alert_one`, `alert_other`, `unknown`, `loading` — les phrases du §3 ;
  - l'état sans snapshot de la carte des non couvertes réutilise `reconciliation.none` et
    `reconciliation.noneLink`.

---

## 8. Tests

`fake-indexeddb`, ledger semé en base, **jamais un hook moqué**. Un utilitaire de rendu commun
aux tests de pages monte `AccountDataProvider` avec le compte de la route.

- **`lib/consistency.test.ts`** : chaque case des tables du §2, dont « orpheline sans écart →
  `alert` », « `asOf` nul → `unknown` », « chargement → `unknown` ».
- **`AccountDataProvider.test.tsx`** : chaque hook consommateur lève une erreur hors du
  fournisseur ; dans le fournisseur, il suit la base (un snapshot écrit après le rendu change la
  vue sans recharger).
- **`AppLayout.test.tsx`** : sur un compte semé, les indicateurs sont présents, le lien pointe
  vers `/accounts/:id/consistency` et son nom accessible dit les deux états ; Couverture rouge
  porte la classe de clignotement, Reconstitution rouge ne la porte pas, un état vert non plus ;
  sans snapshot les deux sont gris ; sur `/settings` aucun indicateur. L'entrée Consistance
  apparaît dans le menu, juste après Sources de données.
- **`router.test.tsx`** : la route `consistency` rend la page.
- **`ConsistencyPage.test.tsx`** : reprend les tests qui partent des autres pages — liste et état
  vide des non couvertes (Dashboard), trois états de la reconstitution (Journal), calage sur le
  point de fin et « aucun Cash Report » (Historique) — et ajoute l'état sans snapshot de la carte
  des non couvertes et la carte cash affichée sur un ledger vide.
- **Absences qui mordent** : `DashboardPage.test.tsx` vérifie que « Positions non couvertes »
  n'est plus rendu, `JournalPage.test.tsx` que le texte de reconciliation ne l'est plus sur un
  compte conforme, `HistoryPage.test.tsx` que la carte cash ne l'est plus sur un ledger calé.
  Chacun échoue si la carte revient.

Vérification finale : `pnpm check`, puis captures `run-frontend` lues une à une — barre de titre
avec Couverture rouge et Reconstitution verte sur `--seed`, les deux grises sur `--empty`, thème
sombre, largeur 400 px ; pages Consistance, Dashboard, un Journal et Historique.

---

## 9. Documentation

- Spec d'architecture, §9 : note du 2026-09-11, ligne Consistance dans la section Configuration
  et indicateurs de la barre de titre.
- `CLAUDE.md` : sous-projet 11 dans la table, et la règle « les verdicts de cohérence sont
  calculés une fois, dans la coquille (`AccountDataProvider`) ; aucune page n'appelle
  `useJournals` ni `useRiskReport` directement ».
- Spec des journaux §7.2 et spec du sous-projet 9 §6.1 : non réécrits, ce spec les remplace pour
  l'emplacement des cartes et pour le statut d'un écart.
