# Sous-projet 21 — Recherche, tri et filtres des pages de stratégie

> **Pour un agent d'exécution :** SOUS-SKILL OBLIGATOIRE — `superpowers:subagent-driven-development`
> (recommandé) ou `superpowers:executing-plans`, tâche par tâche. Les étapes sont des cases à
> cocher (`- [ ]`), **cochées dans le worktree au fur et à mesure, dans le commit de la tâche**.

**But :** donner aux pages Positions des stratégies et aux quatre Journaux la recherche par
ticker, les boutons d'expiration et les en-têtes de colonne triables et filtrables de la vue
d'ensemble, et créer les pages Positions Condors et Positions Autres — en mettant le code en
commun plutôt qu'en le recopiant.

**Architecture :** le moteur de tri et de filtre (`lib/tableCriteria.ts`, `lib/tableView.ts`,
`useTableView`, `ColumnHeader`, `ActiveFilters`) est déjà générique sur la ligne et ne change
pas. Ce qui est cloué sur `AnalyzedPosition` — `PositionTable`, `PositionGroupCard` — devient
générique (`DataTable`, `FilteredTableBox`), la règle des encadrés visibles devient une fonction
pure (`lib/tableBoxes.ts`) que la vue d'ensemble adopte aussi, et `packages/coverage` gagne une
fonction unique de positions de stratégie couvrant les quatre stratégies.

**Pile :** TypeScript, React 19, react-router, react-i18next, Tailwind 4, shadcn sur base-ui,
Vitest + Testing Library + fake-indexeddb, pnpm workspaces.

**Spec :** `docs/specs/2026-09-18-tri-filtres-strategies-design.md` — à lire avec ce plan.

## Contraintes globales

- **Un encadré** = le bloc titré qui porte un tableau : son titre, ses pilules de filtre et sa
  grille. C'est le mot de la spec ; ne pas écrire « carte » pour ces blocs.
- **Rien ne quitte le navigateur.** Aucune table Dexie, aucune migration, aucun endpoint :
  l'état d'affichage vit dans `localStorage`. Une tâche qui semble réclamer un modèle ou une
  route d'API est un signal d'arrêt.
- **Une valeur absente reste `null`**, jamais `0`, et s'affiche « — ».
- **`POSITION_COLUMNS` reste l'unique définition des dix colonnes partagées** et
  `WHEEL_SHARE_COLUMNS` celle des neuf colonnes des actions assignées
  (`apps/web/src/lib/positionColumns.ts`). On n'en recode aucune ailleurs.
- **shadcn ici est base-ui** : `render={<X/>}`, jamais `asChild`.
- **`apps/web/src/pages/PositionsPage.test.tsx` ne doit pas être modifié** : c'est le filet de
  sécurité de tout le portage. S'il casse, c'est le code qui a tort.
- Commandes : `pnpm --filter web exec vitest run <chemin>` pour un test web,
  `pnpm --filter @ib/coverage exec vitest run <chemin>` pour `coverage`. `pnpm check` **une seule fois à
  la fin** (tâche 10) : il lance lint, typage, build et tous les tests.
- Chaque tâche finit par un commit dont le message est en français, à l'impératif, et se termine
  par la ligne `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## Carte des fichiers

| Fichier | Sort | Responsabilité |
|---|---|---|
| `apps/web/src/components/table/DataTable.tsx` | créé | Table sur des colonnes déclarées, en-tête simple ou interactif |
| `apps/web/src/components/PositionTable.tsx` | supprimé | Remplacé par le précédent |
| `apps/web/src/components/table/FilteredTableBox.tsx` | créé | L'encadré générique : titre, pilules, en-tête, corps |
| `apps/web/src/components/PositionGroupCard.tsx` | modifié | Devient l'adaptateur `AnalyzedPosition` de l'encadré |
| `apps/web/src/components/table/PageSearchInput.tsx` | créé | Le champ de recherche par ticker, partagé |
| `apps/web/src/lib/tableBoxes.ts` | créé | `searchBoxes`, `filterBoxes`, `activeExpiry` — purs |
| `apps/web/src/lib/strategyBoxes.ts` | créé | Quels encadrés chaque stratégie porte, dans quel ordre |
| `apps/web/src/lib/strategyColumns.ts` | créé | Specs des colonnes sur `StrategyLine` et `WheelShareLine` |
| `apps/web/src/lib/journalColumns.ts` | créé | `JOURNAL_COLUMNS` et leurs specs |
| `apps/web/src/hooks/useStrategyBoxViews.ts` | créé | Les cinq vues mémorisées d'une page de stratégie |
| `apps/web/src/lib/riskReport.ts` | modifié | `strategyCoverageBadges`/`Values` par stratégie |
| `apps/web/src/pages/PositionsPage.tsx` | modifié | Portée sur les briques communes, comportement inchangé |
| `apps/web/src/pages/StrategyPositionsPage.tsx` | réécrit | Une page pour les quatre stratégies |
| `apps/web/src/pages/JournalPage.tsx` | modifié | Recherche de page et en-têtes interactifs |
| `packages/coverage/src/strategy.ts` | modifié | `strategyPositions` pour les quatre stratégies |

---

## Tâche 1 : `DataTable`, la table sur colonnes déclarées

**Fichiers :**
- Créer : `apps/web/src/components/table/DataTable.tsx`
- Créer : `apps/web/src/components/table/DataTable.test.tsx`
- Supprimer : `apps/web/src/components/PositionTable.tsx`
- Modifier : `apps/web/src/components/PositionGroupCard.tsx` (imports),
  `apps/web/src/components/CashBalancesCard.tsx` (imports),
  `apps/web/src/pages/StrategyPositionsPage.tsx` (imports)

**Interfaces :**
- Produit : `ColumnDef { key: string; width?: string; numeric: boolean }`,
  `DataTable({ columns, minWidth?, children })`,
  `DataTableHeader<Row>({ columns, labelKey, interactive? })`,
  `InteractiveHeader<Row> { specs, view, facets, onSort, onCriterion }`.
- Consomme : `ColumnHeader` (`@/components/table/ColumnHeader`), inchangé.

- [x] **Étape 1 : écrire le test qui échoue**

Créer `apps/web/src/components/table/DataTable.test.tsx` :

```tsx
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { TableBody } from "@ib/ui/table";
import i18n from "@/i18n";
import { DataTable, DataTableHeader, type ColumnDef } from "@/components/table/DataTable";
import { EMPTY_VIEW, type ColumnSpec } from "@/lib/tableView";

const FIXED: ColumnDef[] = [
  { key: "position", width: "60%", numeric: false },
  { key: "quantity", width: "40%", numeric: true },
];

const AUTO: ColumnDef[] = [
  { key: "position", numeric: false },
  { key: "quantity", numeric: true },
];

const SPECS: ColumnSpec<{ quantity: number }>[] = [
  { key: "position", type: "text", sortable: true, value: () => "AAPL" },
  { key: "quantity", type: "number", sortable: true, value: (row) => row.quantity },
];

function renderTable(columns: ColumnDef[], interactive = false) {
  return render(
    <I18nextProvider i18n={i18n}>
      <DataTable columns={columns} minWidth="60rem">
        <DataTableHeader
          columns={columns}
          labelKey="positions.columns"
          interactive={
            interactive
              ? { specs: SPECS, view: EMPTY_VIEW, facets: {}, onSort: () => {}, onCriterion: () => {} }
              : undefined
          }
        />
        <TableBody />
      </DataTable>
    </I18nextProvider>,
  );
}

describe("DataTable", () => {
  it("lays out declared widths in a colgroup and fixes the layout", () => {
    renderTable(FIXED);
    const table = screen.getByRole("table");
    expect([...table.querySelectorAll("col")].map((col) => col.style.width)).toEqual(["60%", "40%"]);
    expect(table).toHaveClass("table-fixed");
    expect(table.style.minWidth).toBe("60rem");
  });

  it("leaves a table without widths to its content: no colgroup, no fixed layout", () => {
    renderTable(AUTO);
    const table = screen.getByRole("table");
    expect(table.querySelector("colgroup")).toBeNull();
    expect(table).not.toHaveClass("table-fixed");
  });

  it("translates each header under the given key and right-aligns the numeric ones", () => {
    renderTable(FIXED);
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).toEqual(["Position", "Qté"]);
    expect(headers[1]).toHaveClass("text-right");
  });

  it("gives no button to a plain header and one to an interactive one", () => {
    renderTable(FIXED);
    expect(within(screen.getAllByRole("columnheader")[0]).queryByRole("button")).not.toBeInTheDocument();
    renderTable(FIXED, true);
    const interactive = screen.getAllByRole("columnheader");
    expect(within(interactive[interactive.length - 1]).getByRole("button")).toBeInTheDocument();
  });
});
```

- [x] **Étape 2 : lancer le test, vérifier qu'il échoue**

Commande : `pnpm --filter web exec vitest run src/components/table/DataTable.test.tsx`
Attendu : ÉCHEC, « Failed to resolve import "@/components/table/DataTable" ».

- [x] **Étape 3 : écrire `DataTable.tsx`**

Créer `apps/web/src/components/table/DataTable.tsx` :

```tsx
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Table, TableHead, TableHeader, TableRow } from "@ib/ui/table";
import { ColumnHeader } from "@/components/table/ColumnHeader";
import type { ColumnSpec, Criterion, Facet, SortDirection, TableView } from "@/lib/tableView";
import { cn } from "@/lib/utils";

/** One column of a table: its i18n suffix, its share of the width when the table fixes them, its alignment. */
export interface ColumnDef {
  key: string;
  /** Share of the table. Absent on every column, the table lays itself out on its content. */
  width?: string;
  numeric: boolean;
}

/**
 * A table laid out on declared columns. With widths, a `colgroup` and a fixed layout, so several
 * tables of one page line up whatever their content and a long label wraps rather than pushing a
 * column out of sight; without, the browser sizes the columns on the content and a narrow screen
 * scrolls — what the seventeen columns of a journal need.
 */
export function DataTable({ columns, minWidth, children }: { columns: readonly ColumnDef[]; minWidth?: string; children: ReactNode }) {
  const fixed = columns.every((column) => column.width !== undefined);
  return (
    <Table className={cn(fixed && "table-fixed [&_td]:whitespace-normal [&_th]:whitespace-normal")} style={minWidth ? { minWidth } : undefined}>
      {fixed && (
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={{ width: column.width }} />
          ))}
        </colgroup>
      )}
      {children}
    </Table>
  );
}

export interface InteractiveHeader<Row> {
  /** Same keys and order as the columns: the header reads them index by index. */
  specs: readonly ColumnSpec<Row>[];
  view: TableView;
  facets: Readonly<Record<string, readonly Facet[]>>;
  onSort: (column: string, dir: SortDirection | null, additive: boolean) => void;
  onCriterion: (column: string, criterion: Criterion | null) => void;
}

/**
 * The header row. Sortable and filterable when `interactive` is given, plain otherwise — the cash
 * table, whose two or three lines sort nothing. A label wraps only where the widths are declared:
 * under an automatic layout, a wrapped header would widen its column instead of the table.
 */
export function DataTableHeader<Row>({
  columns,
  labelKey,
  interactive,
}: {
  columns: readonly ColumnDef[];
  labelKey: string;
  interactive?: InteractiveHeader<Row>;
}) {
  const { t } = useTranslation();
  return (
    <TableHeader>
      <TableRow>
        {columns.map((column, index) =>
          interactive ? (
            <ColumnHeader
              key={column.key}
              meta={interactive.specs[index]}
              label={t(`${labelKey}.${column.key}`)}
              view={interactive.view}
              facets={interactive.facets[column.key]}
              numeric={column.numeric}
              wrap={column.width !== undefined}
              className={cn(column.numeric && "text-right")}
              onSort={(dir, additive) => interactive.onSort(column.key, dir, additive)}
              onCriterion={(criterion) => interactive.onCriterion(column.key, criterion)}
            />
          ) : (
            <TableHead key={column.key} className={cn(column.numeric && "text-right")}>
              {t(`${labelKey}.${column.key}`)}
            </TableHead>
          ),
        )}
      </TableRow>
    </TableHeader>
  );
}
```

- [x] **Étape 4 : lancer le test, vérifier qu'il passe**

Commande : `pnpm --filter web exec vitest run src/components/table/DataTable.test.tsx`
Attendu : SUCCÈS, 4 tests.

- [x] **Étape 5 : brancher les trois appelants et supprimer `PositionTable`**

Dans `apps/web/src/components/PositionGroupCard.tsx`, remplacer l'import
`import { PositionTable, PositionTableHeader } from "@/components/PositionTable";` par :

```tsx
import { DataTable, DataTableHeader } from "@/components/table/DataTable";
```

et le corps du tableau par :

```tsx
        <DataTable columns={POSITION_COLUMNS} minWidth="60rem">
          <DataTableHeader
            columns={POSITION_COLUMNS}
            labelKey="positions.columns"
            interactive={{ specs, view: table.view, facets, onSort: table.setSort, onCriterion: table.setCriterion }}
          />
```

(la balise fermante `</PositionTable>` devient `</DataTable>`).

Dans `apps/web/src/components/CashBalancesCard.tsx`, remplacer
`import { PositionTable } from "@/components/PositionTable";` par
`import { DataTable } from "@/components/table/DataTable";`, et les balises `<PositionTable>` /
`</PositionTable>` par `<DataTable columns={POSITION_COLUMNS} minWidth="60rem">` / `</DataTable>`.
Le `TableHeader` écrit à la main dans ce fichier ne change pas : il laisse ses colonnes vides.

Dans `apps/web/src/pages/StrategyPositionsPage.tsx`, remplacer l'import par
`import { DataTable, DataTableHeader } from "@/components/table/DataTable";` et, dans `LinesCard`,
`<PositionTable>` par `<DataTable columns={POSITION_COLUMNS} minWidth="60rem">`,
`<PositionTableHeader />` par `<DataTableHeader columns={POSITION_COLUMNS} labelKey="positions.columns" />`
et la fermante par `</DataTable>` ; ajouter `import { POSITION_COLUMNS, WHEEL_SHARE_COLUMNS } from "@/lib/positionColumns";`
si `POSITION_COLUMNS` n'y est pas déjà importé.

Puis supprimer le fichier :

```bash
rm apps/web/src/components/PositionTable.tsx
```

- [x] **Étape 6 : vérifier que rien n'a bougé**

Commande : `pnpm --filter web exec vitest run src/pages/PositionsPage.test.tsx src/pages/StrategyPositionsPage.test.tsx src/components/CashBalancesCard.test.tsx`
Attendu : SUCCÈS, aucun test modifié. Le test « lines up the columns of every table on the page »
de `PositionsPage.test.tsx` prouve que les dix `<col>` sont toujours posés sur les quatre tables.

Commande : `pnpm --filter web typecheck`
Attendu : SUCCÈS (aucune référence restante à `@/components/PositionTable`).

- [x] **Étape 7 : commit**

```bash
git add apps/web/src/components apps/web/src/pages/StrategyPositionsPage.tsx
git commit -m "$(cat <<'MSG'
Généraliser la table de Positions en table sur colonnes déclarées

DataTable pose un colgroup et fixe la disposition quand les colonnes ont une
largeur, et laisse le navigateur faire quand elles n'en ont pas : les dix
colonnes partagées comme les dix-sept d'un journal tiennent dans le même
composant.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Tâche 2 : `FilteredTableBox`, l'encadré générique

**Fichiers :**
- Créer : `apps/web/src/components/table/FilteredTableBox.tsx`
- Créer : `apps/web/src/components/table/FilteredTableBox.test.tsx`
- Modifier : `apps/web/src/components/PositionGroupCard.tsx`

**Interfaces :**
- Consomme : `DataTable`, `DataTableHeader`, `ColumnDef` (tâche 1) ; `ActiveFilters`,
  `facetValues`, `TableViewState`.
- Produit : `FilteredTableBox<Row>(props)` avec
  `{ title?, columns, labelKey, minWidth?, specs, facetRows, rows, table, emptyKey, rowKey, renderRow }`.

- [x] **Étape 1 : écrire le test qui échoue**

Créer `apps/web/src/components/table/FilteredTableBox.test.tsx` :

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { TableCell, TableRow } from "@ib/ui/table";
import i18n from "@/i18n";
import { FilteredTableBox } from "@/components/table/FilteredTableBox";
import type { ColumnDef } from "@/components/table/DataTable";
import type { TableViewState } from "@/hooks/useTableView";
import { EMPTY_VIEW, type ColumnSpec, type TableView } from "@/lib/tableView";

interface Line {
  position: string;
  type: string;
}

const COLUMNS: ColumnDef[] = [
  { key: "position", width: "70%", numeric: false },
  { key: "type", width: "30%", numeric: false },
];

const SPECS: ColumnSpec<Line>[] = [
  { key: "position", type: "text", sortable: true, value: (line) => line.position },
  { key: "type", type: "enum", sortable: true, value: (line) => line.type },
];

const LINES: Line[] = [
  { position: "AAPL", type: "long_stock" },
  { position: "XOM Mar20'26 100 Put", type: "short_put" },
];

function table(view: TableView = EMPTY_VIEW): TableViewState {
  return { view, setCriterion: vi.fn(), setSort: vi.fn(), clearColumn: vi.fn(), clearAll: vi.fn() };
}

// Variadic, not a default parameter: a default also fires on an explicit `undefined`, so the
// "no title" case below would have received the title anyway and tested nothing.
function renderBox(rows: Line[], state = table(), ...titleArg: [title: string | undefined] | []) {
  const title = titleArg.length > 0 ? titleArg[0] : "Ventes d'options";
  return render(
    <I18nextProvider i18n={i18n}>
      <FilteredTableBox
        title={title}
        columns={COLUMNS}
        labelKey="positions.columns"
        specs={SPECS}
        facetRows={LINES}
        rows={rows}
        table={state}
        emptyKey="positions.noResults"
        rowKey={(line) => line.position}
        renderRow={(line) => (
          <TableRow>
            <TableCell>{line.position}</TableCell>
            <TableCell>{line.type}</TableCell>
          </TableRow>
        )}
      />
    </I18nextProvider>,
  );
}

describe("FilteredTableBox", () => {
  it("names the box for a screen reader and titles it", () => {
    renderBox(LINES);
    expect(within(screen.getByLabelText("Ventes d'options")).getByText("AAPL")).toBeInTheDocument();
  });

  it("renders no card header when it has no title", () => {
    renderBox(LINES, table(), undefined);
    expect(screen.queryByText("Ventes d'options")).not.toBeInTheDocument();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
  });

  it("keeps its headers and says so when the view empties it", () => {
    renderBox([]);
    expect(screen.getByText("Aucune position ne correspond.")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /^Position/ })).toBeInTheDocument();
  });

  it("counts the facets on every line of the box, not on the ones left", async () => {
    renderBox([LINES[0]]);
    const header = screen.getByRole("columnheader", { name: /^Type/ });
    await userEvent.click(within(header).getByRole("button"));
    // Both values of facetRows are offered, each counted once, although one row is displayed.
    // By regex: a facet's checkbox is named with its count too ("long_stock 1").
    expect(await screen.findByRole("checkbox", { name: /^long_stock/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /^short_put/ })).toBeInTheDocument();
  });

  it("shows a pill per filtered column, above the table", () => {
    renderBox(LINES, table({ sort: [], criteria: { position: "AAPL" } }));
    expect(screen.getByText("Position : AAPL")).toBeInTheDocument();
  });
});
```

- [x] **Étape 2 : lancer le test, vérifier qu'il échoue**

Commande : `pnpm --filter web exec vitest run src/components/table/FilteredTableBox.test.tsx`
Attendu : ÉCHEC, « Failed to resolve import "@/components/table/FilteredTableBox" ».

- [x] **Étape 3 : écrire `FilteredTableBox.tsx`**

Créer `apps/web/src/components/table/FilteredTableBox.tsx` :

```tsx
import { Fragment, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { TableBody, TableCell, TableRow } from "@ib/ui/table";
import { DataTable, DataTableHeader, type ColumnDef } from "@/components/table/DataTable";
import { ActiveFilters } from "@/components/table/ActiveFilters";
import type { TableViewState } from "@/hooks/useTableView";
import { facetValues, type ColumnSpec } from "@/lib/tableView";

export interface FilteredTableBoxProps<Row> {
  /** Absent: no card header — a page whose heading already names the single table. */
  title?: string;
  columns: readonly ColumnDef[];
  /** i18n prefix of the column labels, used by the header and by the filter pills. */
  labelKey: string;
  minWidth?: string;
  /** Same keys and order as `columns`. */
  specs: readonly ColumnSpec<Row>[];
  /** Every line of the box, before search and filters: what the facets count. */
  facetRows: readonly Row[];
  /** The lines the view keeps, in its order: what the table shows. */
  rows: readonly Row[];
  table: TableViewState;
  /** i18n key of the line shown when `rows` is empty. */
  emptyKey: string;
  rowKey: (row: Row) => string;
  renderRow: (row: Row) => ReactNode;
}

/**
 * One titled table with its own sort and filters: the pills that clear them, the interactive
 * header, and the rows. A column means something else from one box to the next — a Type, a
 * Decision, a Coverage — so each box holds its view apart, and the facets count the whole box so
 * that a value filtered out keeps its entry in the list that would bring it back.
 */
export function FilteredTableBox<Row>({
  title,
  columns,
  labelKey,
  minWidth,
  specs,
  facetRows,
  rows,
  table,
  emptyKey,
  rowKey,
  renderRow,
}: FilteredTableBoxProps<Row>) {
  const { t } = useTranslation();
  const facets = useMemo(
    () =>
      Object.fromEntries(
        specs
          .filter((spec) => spec.type === "enum")
          .map((spec) => {
            const criterion = table.view.criteria[spec.key];
            return [spec.key, facetValues(facetRows, spec, Array.isArray(criterion) ? criterion : [])];
          }),
      ),
    [facetRows, specs, table.view],
  );

  return (
    <Card aria-label={title}>
      {title !== undefined && (
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className="flex flex-col gap-3 overflow-x-auto">
        <ActiveFilters
          specs={specs}
          view={table.view}
          columnLabel={(key) => t(`${labelKey}.${key}`)}
          onClearColumn={table.clearColumn}
          onClearAll={table.clearAll}
        />
        <DataTable columns={columns} minWidth={minWidth}>
          <DataTableHeader
            columns={columns}
            labelKey={labelKey}
            interactive={{ specs, view: table.view, facets, onSort: table.setSort, onCriterion: table.setCriterion }}
          />
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-8 text-center text-sm text-muted-foreground">
                  {t(emptyKey)}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => <Fragment key={rowKey(row)}>{renderRow(row)}</Fragment>)
            )}
          </TableBody>
        </DataTable>
      </CardContent>
    </Card>
  );
}
```

- [x] **Étape 4 : lancer le test, vérifier qu'il passe**

Commande : `pnpm --filter web exec vitest run src/components/table/FilteredTableBox.test.tsx`
Attendu : SUCCÈS, 5 tests.

- [x] **Étape 5 : faire de `PositionGroupCard` l'adaptateur `AnalyzedPosition`**

Remplacer tout le corps de `apps/web/src/components/PositionGroupCard.tsx` par :

```tsx
import type { AnalyzedPosition } from "@ib/coverage";
import { PositionRow } from "@/components/PositionRow";
import { FilteredTableBox } from "@/components/table/FilteredTableBox";
import type { TableViewState } from "@/hooks/useTableView";
import { formatContract } from "@/lib/format";
import { POSITION_COLUMNS } from "@/lib/positionColumns";
import { coverageBadges } from "@/lib/riskReport";
import type { ColumnSpec } from "@/lib/tableView";

export interface PositionGroupCardProps {
  title: string;
  /** The group's positions in the snapshot, before search and filters: what the facets count. */
  positions: readonly AnalyzedPosition[];
  /** The same after the page search, this box's filters and its sort: what the table shows. */
  rows: readonly AnalyzedPosition[];
  /** This group's own view, held by the page so the expiry buttons can write in all four at once. */
  table: TableViewState;
  specs: readonly ColumnSpec<AnalyzedPosition>[];
  sectorOf: (symbol: string) => string | null;
}

/** One group of the Positions page: the shared ten columns over a whole IB position. */
export function PositionGroupCard({ title, positions, rows, table, specs, sectorOf }: PositionGroupCardProps) {
  return (
    <FilteredTableBox
      title={title}
      columns={POSITION_COLUMNS}
      labelKey="positions.columns"
      minWidth="60rem"
      specs={specs}
      facetRows={positions}
      rows={rows}
      table={table}
      emptyKey="positions.noResults"
      rowKey={(position) => position.description}
      renderRow={(position) => (
        <PositionRow
          values={{
            contract: formatContract(position),
            label: position.label,
            sector: sectorOf(position.symbol),
            marketValue: position.marketValue,
            quantity: position.quantity,
            avgPrice: position.avgPrice,
            lastPrice: position.lastPrice,
            unrealizedPnl: position.unrealizedPnl,
            decision: position.decision,
            coverage: coverageBadges(position),
          }}
        />
      )}
    />
  );
}
```

Le composant ne traduit plus rien lui-même — l'encadré s'en charge —, donc il n'importe plus
`react-i18next`.

- [x] **Étape 6 : vérifier que la vue d'ensemble n'a pas bougé**

Commande : `pnpm --filter web exec vitest run src/pages/PositionsPage.test.tsx`
Attendu : SUCCÈS, fichier de test non modifié.

- [x] **Étape 7 : commit**

```bash
git add apps/web/src/components
git commit -m "$(cat <<'MSG'
Extraire l'encadré filtrable des groupes de Positions

FilteredTableBox porte le titre, les pilules de filtre, l'en-tête interactif et
le corps d'un tableau, sur n'importe quelle ligne ; PositionGroupCard n'en est
plus que l'adaptateur pour une position IB.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Tâche 3 : `lib/tableBoxes.ts` et le portage de la vue d'ensemble

**Fichiers :**
- Créer : `apps/web/src/lib/tableBoxes.ts`, `apps/web/src/lib/tableBoxes.test.ts`
- Modifier : `apps/web/src/pages/PositionsPage.tsx`
- Ne pas toucher : `apps/web/src/pages/PositionsPage.test.tsx`

**Interfaces :**
- Consomme : `applyView`, `EMPTY_VIEW`, `ColumnSpec`, `PageSearch`, `TableView` (`@/lib/tableView`) ;
  `ExpiryChoice` (`@/lib/expiryFilter`).
- Produit :
  `TableBoxInput<Row> { id: string; title?: string; all: readonly Row[] }`,
  `SearchedBox<Row> extends TableBoxInput<Row> { searched: Row[] }`,
  `PreparedBox<Row> extends SearchedBox<Row> { facetRows: readonly Row[]; rows: Row[] }`,
  `searchBoxes(boxes, specs, search): SearchedBox<Row>[]`,
  `filterBoxes(boxes, specs, views, expiryActive): PreparedBox<Row>[]`,
  `activeExpiry(choices, ids, views): string | null`.

- [x] **Étape 1 : écrire le test qui échoue**

Créer `apps/web/src/lib/tableBoxes.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { activeExpiry, filterBoxes, searchBoxes, type TableBoxInput } from "@/lib/tableBoxes";
import { EMPTY_VIEW, type ColumnSpec, type TableView } from "@/lib/tableView";

interface Line {
  ticker: string;
  position: string;
  quantity: number;
}

const SPECS: ColumnSpec<Line>[] = [
  { key: "position", type: "text", sortable: true, value: (line) => line.position },
  { key: "quantity", type: "number", sortable: true, value: (line) => line.quantity },
];

const line = (ticker: string, position: string, quantity = 1): Line => ({ ticker, position, quantity });

const BOXES: TableBoxInput<Line>[] = [
  { id: "long", title: "Positions longues", all: [line("AAPL", "AAPL", 200)] },
  { id: "optionSells", title: "Ventes d'options", all: [line("XOM", "XOM Mar20'26 100 Put"), line("AAPL", "AAPL Feb20'26 155 Call")] },
  { id: "other", title: "Autres positions", all: [] },
];

const search = (text: string) => ({ text, ticker: (line: Line) => line.ticker });

describe("searchBoxes", () => {
  it("drops a box with no line at all, before anything is rendered", () => {
    expect(searchBoxes(BOXES, SPECS, search("")).map((box) => box.id)).toEqual(["long", "optionSells"]);
  });

  it("drops a box the page search empties, and keeps the lines it matches", () => {
    const searched = searchBoxes(BOXES, SPECS, search("=XOM"));
    expect(searched.map((box) => box.id)).toEqual(["optionSells"]);
    expect(searched[0].searched.map((line) => line.position)).toEqual(["XOM Mar20'26 100 Put"]);
  });

  it("keeps every box when the search is blank", () => {
    const searched = searchBoxes(BOXES, SPECS, search("  "));
    expect(searched.map((box) => box.searched.length)).toEqual([1, 2]);
  });
});

describe("filterBoxes", () => {
  const searched = () => searchBoxes(BOXES, SPECS, search(""));

  it("keeps a box its own column filter empties, so the filter can be cleared", () => {
    const views: Record<string, TableView> = { long: { sort: [], criteria: { quantity: ">1000" } } };
    const boxes = filterBoxes(searched(), SPECS, views, false);
    expect(boxes.map((box) => box.id)).toEqual(["long", "optionSells"]);
    expect(boxes[0].rows).toEqual([]);
  });

  it("drops a box an expiry empties, which no filter of its own could fill", () => {
    const views: Record<string, TableView> = { long: { sort: [], criteria: { position: "Mar20'26" } }, optionSells: { sort: [], criteria: { position: "Mar20'26" } } };
    const boxes = filterBoxes(searched(), SPECS, views, true);
    expect(boxes.map((box) => box.id)).toEqual(["optionSells"]);
    expect(boxes[0].rows.map((line) => line.position)).toEqual(["XOM Mar20'26 100 Put"]);
  });

  it("counts the facets on the whole box, whatever the search and the filters", () => {
    const boxes = filterBoxes(searchBoxes(BOXES, SPECS, search("=XOM")), SPECS, {}, false);
    expect(boxes[0].facetRows).toHaveLength(2);
    expect(boxes[0].rows).toHaveLength(1);
  });

  it("sorts on the box's own view", () => {
    const views: Record<string, TableView> = { optionSells: { sort: [{ column: "position", dir: "asc" }], criteria: {} } };
    const boxes = filterBoxes(searched(), SPECS, views, false);
    expect(boxes[1].rows.map((line) => line.position)).toEqual(["AAPL Feb20'26 155 Call", "XOM Mar20'26 100 Put"]);
  });

  it("treats a box with no stored view as unfiltered and unsorted", () => {
    expect(filterBoxes(searched(), SPECS, {}, false)[1].rows).toHaveLength(2);
  });
});

describe("activeExpiry", () => {
  const choices = [
    { expiry: "2026-02-20", label: "Feb20'26" },
    { expiry: "2026-03-20", label: "Mar20'26" },
  ];

  it("reads the expiry every declared box filters on", () => {
    const criteria = { sort: [], criteria: { position: "Mar20'26" } };
    expect(activeExpiry(choices, ["long", "optionSells"], { long: criteria, optionSells: criteria })).toBe("Mar20'26");
  });

  it("reads none when one box filters on something else", () => {
    expect(
      activeExpiry(choices, ["long", "optionSells"], {
        long: { sort: [], criteria: { position: "Mar20'26" } },
        optionSells: EMPTY_VIEW,
      }),
    ).toBeNull();
  });
});
```

- [x] **Étape 2 : lancer le test, vérifier qu'il échoue**

Commande : `pnpm --filter web exec vitest run src/lib/tableBoxes.test.ts`
Attendu : ÉCHEC, « Failed to resolve import "@/lib/tableBoxes" ».

- [x] **Étape 3 : écrire `tableBoxes.ts`**

Créer `apps/web/src/lib/tableBoxes.ts` :

```ts
import type { ExpiryChoice } from "@/lib/expiryFilter";
import { applyView, EMPTY_VIEW, type ColumnSpec, type PageSearch, type TableView } from "@/lib/tableView";

/**
 * Which boxes a positions page shows, and what each one holds (spec of sub-project 21, §3.3). Two
 * steps, because the expiry bar is built between them: it must offer the expiries of every box the
 * search left, including the ones the chosen expiry empties — otherwise the button that emptied
 * them would vanish from the bar and there would be no way back.
 */

export interface TableBoxInput<Row> {
  /** Suffix of the stored view's key, and the key React renders the box under. */
  id: string;
  title?: string;
  /** Every line of the box, before search and filters. */
  all: readonly Row[];
}

export interface SearchedBox<Row> extends TableBoxInput<Row> {
  searched: Row[];
}

export interface PreparedBox<Row> extends SearchedBox<Row> {
  /** `all`: the facets count the whole box, so a value filtered out keeps the entry that brings it back. */
  facetRows: readonly Row[];
  rows: Row[];
}

/**
 * The boxes the page search leaves: a box the search empties never renders, a box with no line
 * at all being the degenerate case of the same rule — the strategy holds nothing of that kind
 * even before a search runs. Losing the box traps nobody: the search means the same thing in
 * every box and is cleared from the top of the page, unlike a column filter.
 */
export function searchBoxes<Row>(
  boxes: readonly TableBoxInput<Row>[],
  specs: readonly ColumnSpec<Row>[],
  search: PageSearch<Row>,
): SearchedBox<Row>[] {
  const kept: SearchedBox<Row>[] = [];
  for (const box of boxes) {
    const searched = applyView(box.all, specs, EMPTY_VIEW, search);
    if (searched.length === 0) continue;
    kept.push({ ...box, searched });
  }
  return kept;
}

/**
 * The boxes left once each one's own view has run. A box emptied by its own column filters stays,
 * with its headers and its pills: they are the only way to clear them. A box emptied while an
 * expiry is chosen goes away instead — the shares have no expiry, and a grid nothing can fill
 * teaches nothing.
 */
export function filterBoxes<Row>(
  boxes: readonly SearchedBox<Row>[],
  specs: readonly ColumnSpec<Row>[],
  views: Readonly<Record<string, TableView>>,
  expiryActive: boolean,
): PreparedBox<Row>[] {
  const kept: PreparedBox<Row>[] = [];
  for (const box of boxes) {
    const rows = applyView(box.searched, specs, views[box.id] ?? EMPTY_VIEW);
    if (rows.length === 0 && expiryActive) continue;
    kept.push({ ...box, facetRows: box.all, rows });
  }
  return kept;
}

/**
 * The expiry the page is filtering on: the one whose label is the Position criterion of every
 * declared box, `null` otherwise. An expiry is a page-wide choice, so a box left out of it — a
 * hand-typed criterion in one box only — is not that choice.
 */
export function activeExpiry(
  choices: readonly ExpiryChoice[],
  ids: readonly string[],
  views: Readonly<Record<string, TableView>>,
): string | null {
  return choices.find((choice) => ids.every((id) => views[id]?.criteria.position === choice.label))?.label ?? null;
}
```

- [x] **Étape 4 : lancer le test, vérifier qu'il passe**

Commande : `pnpm --filter web exec vitest run src/lib/tableBoxes.test.ts`
Attendu : SUCCÈS, 10 tests.

- [x] **Étape 5 : porter `PositionsPage` dessus**

Dans `apps/web/src/pages/PositionsPage.tsx`, remplacer le bloc qui va de
`// Groups empty in the snapshot never show.` jusqu'à la ligne `.filter(({ rows }) => activeExpiry === null || rows.length > 0);`
par :

```tsx
  // Which boxes show, and what each one holds: lib/tableBoxes.ts, shared with the strategy pages.
  const ids = DETAIL_GROUPS.map((group) => group.id);
  const viewOf = Object.fromEntries(ids.map((id) => [id, views[id].view]));
  const searched = searchBoxes(
    groupedPositions(report.positions).map((group) => ({ id: group.id, title: t(groupTitleKey(group.id)), all: group.positions })),
    specs,
    { text: search.applied, ticker: (position: AnalyzedPosition) => position.symbol },
  );

  // The buttons follow the ticker search but never the column filters: the expiry chosen would
  // otherwise be the only one left to choose.
  const choices = expiryChoices(searched.flatMap((box) => box.searched), reportToday());
  const expiry = activeExpiry(choices, ids, viewOf);
  const boxes = filterBoxes(searched, specs, viewOf, expiry !== null);
```

Adapter les imports en tête de fichier :

```tsx
import { DETAIL_GROUPS, groupedPositions, type AnalyzedPosition } from "@ib/coverage";
import { activeExpiry, filterBoxes, searchBoxes } from "@/lib/tableBoxes";
```

et retirer `applyView, EMPTY_VIEW` de l'import de `@/lib/tableView` s'ils n'y servent plus.

`setExpiry` ne change pas : il écrit déjà le critère dans les quatre vues à la fois.

Enfin, le rendu remplace `activeExpiry` par `expiry` et `groups` par `boxes` :

```tsx
      <ExpiryFilterBar choices={choices} active={expiry} onPick={setExpiry} />

      {boxes.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("positions.noResults")}</p>
          </CardContent>
        </Card>
      )}

      {boxes.map((box) => (
        <PositionGroupCard
          key={box.id}
          title={box.title as string}
          positions={box.facetRows}
          rows={box.rows}
          table={views[box.id as DetailGroupId]}
          specs={specs}
          sectorOf={sectorOf}
        />
      ))}
```

en important `type DetailGroupId` depuis `@ib/coverage`.

- [x] **Étape 6 : vérifier que la vue d'ensemble n'a pas bougé d'un pixel**

Commande : `pnpm --filter web exec vitest run src/pages/PositionsPage.test.tsx`
Attendu : SUCCÈS, fichier de test non modifié — ses 25 tests, expirations comprises.

- [x] **Étape 7 : commit**

```bash
git add apps/web/src/lib/tableBoxes.ts apps/web/src/lib/tableBoxes.test.ts apps/web/src/pages/PositionsPage.tsx
git commit -m "$(cat <<'MSG'
Sortir la règle des encadrés visibles de la page Positions

searchBoxes, filterBoxes et activeExpiry disent en deux temps quels encadrés
une page montre : la barre d'expiration se construit entre les deux, sur les
lignes que la recherche a laissées, y compris celles des encadrés que
l'expiration vide — sans quoi le bouton choisi disparaîtrait de la barre.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Tâche 4 : le champ de recherche partagé

**Fichiers :**
- Créer : `apps/web/src/components/table/PageSearchInput.tsx`
- Modifier : `apps/web/src/pages/PositionsPage.tsx`, `apps/web/src/i18n/fr.json`,
  `apps/web/src/i18n/en.json`
- Ne pas toucher : `apps/web/src/pages/PositionsPage.test.tsx`

**Interfaces :**
- Consomme : `PageSearchState` (`@/hooks/useTableView`).
- Produit : `PageSearchInput({ search }: { search: PageSearchState })`, et les clés i18n
  `search.placeholder` / `search.label`.

- [x] **Étape 1 : déplacer les clés i18n**

Dans `apps/web/src/i18n/fr.json`, ajouter à la racine, en gardant l'ordre alphabétique des blocs
de premier niveau existants :

```json
  "search": {
    "label": "Rechercher un ticker",
    "placeholder": "Rechercher un ticker : AAPL, AAPL|MSFT…"
  },
```

et retirer `positions.searchLabel` et `positions.searchPlaceholder`.

Dans `apps/web/src/i18n/en.json`, de même :

```json
  "search": {
    "label": "Search a ticker",
    "placeholder": "Search a ticker: AAPL, AAPL|MSFT…"
  },
```

et retirer `positions.searchLabel` et `positions.searchPlaceholder`. **Ne pas toucher à
`journal.filterPlaceholder`** : la page Journal l'utilise encore jusqu'à la tâche 9.

- [x] **Étape 2 : écrire `PageSearchInput.tsx`**

Créer `apps/web/src/components/table/PageSearchInput.tsx` :

```tsx
import { useTranslation } from "react-i18next";
import { Input } from "@ib/ui/input";
import type { PageSearchState } from "@/hooks/useTableView";

/**
 * The ticker search of a page, the same on Positions, on every strategy's positions and on every
 * journal: one field above the tables, whose text filters them all. It takes the criterion grammar
 * of a column filter — `AAPL|MSFT`, `!SPY`, `=XOM` — and is remembered per account and per page.
 */
export function PageSearchInput({ search }: { search: PageSearchState }) {
  const { t } = useTranslation();
  return (
    <Input
      value={search.input}
      onChange={(event) => search.setInput(event.target.value)}
      placeholder={t("search.placeholder")}
      aria-label={t("search.label")}
      className="font-mono"
    />
  );
}
```

- [x] **Étape 3 : brancher la vue d'ensemble**

Dans `apps/web/src/pages/PositionsPage.tsx`, remplacer le bloc `<Input …/>` par
`<PageSearchInput search={search} />`, importer
`import { PageSearchInput } from "@/components/table/PageSearchInput";` et retirer l'import
désormais inutile de `@ib/ui/input`.

- [x] **Étape 4 : lancer les tests, vérifier qu'ils passent**

Commande : `pnpm --filter web exec vitest run src/pages/PositionsPage.test.tsx`
Attendu : SUCCÈS sans modifier le test — les libellés rendus (« Rechercher un ticker »,
« Rechercher un ticker : AAPL, AAPL|MSFT… ») sont exactement les mêmes, sous une autre clé.

Commande : `grep -rn "positions.searchPlaceholder\|positions.searchLabel" apps/web/src`
Attendu : aucune ligne.

- [x] **Étape 5 : commit**

```bash
git add apps/web/src/components/table/PageSearchInput.tsx apps/web/src/pages/PositionsPage.tsx apps/web/src/i18n
git commit -m "$(cat <<'MSG'
Partager le champ de recherche par ticker entre les pages

Les libellés passent de positions.* à search.*, une seule fois pour les six
pages qui vont le porter ; le texte affiché ne change pas.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Tâche 5 : `strategyPositions` dans `packages/coverage`

**Fichiers :**
- Modifier : `packages/coverage/src/strategy.ts`, `packages/coverage/src/strategy.test.ts`

**Interfaces :**
- Produit :
  `type PositionsStrategy = Strategy` (les quatre),
  `interface StrategyPositions { shares: WheelShareLine[]; groups: Record<DetailGroupId, StrategyLine[]> }`,
  `strategyPositions(rows, strategy, snapshot): StrategyPositions`,
  `STRATEGY_COVER_SOURCES: Record<PositionsStrategy, readonly CoverSource[]>` étendu.
- Disparaissent : `wheelPositions`, `leapsPositions`, `WheelPositions`, `LeapsPositions`.

- [ ] **Étape 1 : écrire les tests qui échouent**

Dans `packages/coverage/src/strategy.test.ts` :

1. remplacer l'import `import { leapsPositions, wheelPositions, type PricedSnapshot } from "./strategy.ts";` par

```ts
import { strategyPositions, type PricedSnapshot } from "./strategy.ts";

/** The two shapes the old API returned, so the tests below read as they did. */
const wheelPositions = (rows: readonly JournalRow[], snapshot: PricedSnapshot | null) => {
  const { shares, groups } = strategyPositions(rows, "wheel", snapshot);
  return { shares, optionSales: groups.optionSells };
};
const leapsPositions = (rows: readonly JournalRow[], snapshot: PricedSnapshot | null) => {
  const { groups } = strategyPositions(rows, "leaps", snapshot);
  return { optionBuys: groups.optionBuys, optionSells: groups.optionSells, shares: groups.long };
};
```

2. ajouter, à la fin du fichier, les cas neufs :

```ts
const SPY = (right: "C" | "P", strike: number) => opt("SPY", right, strike, "2026-08-29");

/** One open condor: a composite row carrying its four legs, as the journals engine builds it. */
function condor(overrides: Partial<JournalRow> = {}): JournalRow {
  const leg = (contract: ContractKey, quantity: number, openPrice: number) =>
    row({ id: `leg${contract.strike}#1`, contract, strategy: "condors", kind: quantity < 0 ? (contract.right === "P" ? "short_put" : "short_call") : contract.right === "P" ? "long_put" : "long_call", quantity, openPrice });
  return row({
    id: "ic#1",
    strategy: "condors",
    kind: "condor",
    contract: { ticker: "SPY", secType: "OPT", right: "", strike: null, expiry: "2026-08-29", currency: "USD" },
    quantity: -1,
    legs: [leg(SPY("P", 620), 1, 0.3), leg(SPY("P", 625), -1, 0.6), leg(SPY("C", 660), -1, 0.5), leg(SPY("C", 665), 1, 0.3)],
    ...overrides,
  });
}

describe("strategyPositions — condors", () => {
  it("reads a condor on its legs: a composite has no right nor strike, so nothing prices it", () => {
    const snapshot = priced([
      option({ symbol: "SPY", right: "P", strike: 625, expiry: "2026-08-29", quantity: -1, marketPrice: 0.2, marketValue: -20 }),
      option({ symbol: "SPY", right: "P", strike: 620, expiry: "2026-08-29", quantity: 1, marketPrice: 0.1, marketValue: 10 }),
    ]);
    const { groups } = strategyPositions([condor()], "condors", snapshot);
    expect(groups.optionSells.map((line) => [line.contract.right, line.contract.strike, line.quantity])).toEqual([
      ["C", 660, -1],
      ["P", 625, -1],
    ]);
    expect(groups.optionBuys.map((line) => [line.contract.right, line.contract.strike, line.quantity])).toEqual([
      ["C", 665, 1],
      ["P", 620, 1],
    ]);
    // The sold put is priced from the snapshot; the sold call, absent from it, is not.
    const put = groups.optionSells.find((line) => line.contract.strike === 625)!;
    expect(put).toMatchObject({ lastPrice: 0.2, marketValue: -20, kind: "short_put" });
    expect(groups.optionSells.find((line) => line.contract.strike === 660)!.lastPrice).toBeNull();
    // No composite line anywhere: a condor is its legs.
    expect(groups.other).toEqual([]);
  });

  it("sums the legs of a partly bought-back condor, which the engine splits into two composites", () => {
    const first = condor();
    const second = condor({ id: "ic#2" });
    const { groups } = strategyPositions([first, second], "condors", null);
    expect(groups.optionSells.find((line) => line.contract.strike === 625)!.quantity).toBe(-2);
  });

  it("gives a sold leg the spread cover, and the wings their used badge", () => {
    const snapshot = priced([
      option({ symbol: "SPY", right: "P", strike: 625, expiry: "2026-08-29", quantity: -1, marketPrice: 0.2, marketValue: -20 }),
      option({ symbol: "SPY", right: "P", strike: 620, expiry: "2026-08-29", quantity: 1, marketPrice: 0.1, marketValue: 10 }),
    ]);
    const { groups } = strategyPositions([condor()], "condors", snapshot);
    const put = groups.optionSells.find((line) => line.contract.strike === 625)!;
    expect(put.coverage.map((allocation) => allocation.source)).toEqual(["spread"]);
  });
});

describe("strategyPositions — others", () => {
  it("splits what fits nowhere else into the four groups of the Positions page", () => {
    const rows = [
      row({ id: "a#1", strategy: "others", kind: "shares", contract: shares("AAPL"), quantity: 10, openPrice: 180 }),
      row({ id: "b#1", strategy: "others", kind: "short_call", contract: MARA_CALL, quantity: -1, openPrice: 0.5 }),
      row({ id: "c#1", strategy: "others", kind: "long_put", contract: XOM_PUT, quantity: 1, openPrice: 2 }),
      row({ id: "d#1", strategy: "others", kind: "short_shares", contract: shares("TSLA"), quantity: -5, openPrice: 300 }),
    ];
    const { groups, shares: wheelShares } = strategyPositions(rows, "others", null);
    expect(groups.long.map((line) => line.contract.ticker)).toEqual(["AAPL"]);
    expect(groups.optionBuys.map((line) => line.kind)).toEqual(["long_put"]);
    expect(groups.optionSells.map((line) => line.kind)).toEqual(["short_call"]);
    expect(groups.other.map((line) => [line.contract.ticker, line.kind])).toEqual([["TSLA", "short_stock"]]);
    expect(wheelShares).toEqual([]);
  });

  it("leaves a sold option of Others without an allocation: its cover is nothing at all", () => {
    const rows = [row({ id: "b#1", strategy: "others", kind: "short_call", contract: MARA_CALL, quantity: -1, openPrice: 0.5 })];
    const snapshot = priced([option({ symbol: "MQZA", right: "C", strike: 20, expiry: "2026-11-20", quantity: -1, marketPrice: 0.25, marketValue: -25 })]);
    expect(strategyPositions(rows, "others", snapshot).groups.optionSells[0].coverage).toEqual([]);
  });
});

describe("strategyPositions — wheel", () => {
  it("puts the Wheel's shares in `shares` and leaves its long group empty, so they show once", () => {
    const rows = [
      row({ id: "s#1", kind: "shares", contract: shares("MQZA"), quantity: 200, openPrice: 17 }),
      row({ id: "c#1", kind: "short_call", contract: MARA_CALL, quantity: -2, openPrice: 0.5 }),
    ];
    const { shares: holdings, groups } = strategyPositions(rows, "wheel", null);
    expect(holdings.map((holding) => holding.ticker)).toEqual(["MQZA"]);
    expect(groups.long).toEqual([]);
    expect(groups.optionSells).toHaveLength(1);
  });
});
```

Ajouter `type ContractKey` à l'import de `@ib/ledger` en tête de fichier s'il n'y est pas déjà
(il y est), et `shares` est déjà défini en tête du fichier.

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Commande : `pnpm --filter @ib/coverage exec vitest run src/strategy.test.ts`
Attendu : ÉCHEC — `strategyPositions` n'existe pas.

- [ ] **Étape 3 : écrire le moteur**

Dans `packages/coverage/src/strategy.ts` :

1. importer `DETAIL_GROUPS` et `Strategy` :

```ts
import { contractId, contractOf, sharesContract, wheelHoldings, type ContractKey, type JournalRow, type Position, type RowKind, type Strategy, type WheelHolding } from "@ib/ledger";
import { DEFAULT_MULTIPLIER, DETAIL_GROUPS, KIND_LABELS, type CoverSource, type DetailGroupId, type PositionKind } from "./constants.ts";
```

2. remplacer `export type PositionsStrategy = "wheel" | "leaps";` par :

```ts
/** Every strategy has a positions page; each shows the boxes its lines fill (spec of sub-project 21, §4). */
export type PositionsStrategy = Strategy;
```

3. étendre les sources de couverture :

```ts
/**
 * The cover each strategy owns on a sold option: the Wheel's calls lean on its shares and its puts
 * on cash, the LEAPS' calls on the LEAPS, a condor's legs on the other legs of the structure.
 * Others owns none: what is left there is precisely what nothing covers, and UNCOVERED is never an
 * allocation — the page shows it from the line's own quantity.
 */
export const STRATEGY_COVER_SOURCES: Record<PositionsStrategy, readonly CoverSource[]> = {
  wheel: ["cash", "stock"],
  leaps: ["leaps"],
  condors: ["spread"],
  others: [],
};
```

4. étendre `LINE_KIND` :

```ts
const LINE_KIND: Partial<Record<RowKind, PositionKind>> = {
  short_put: "short_put",
  short_call: "short_call",
  long_call: "long_call",
  long_put: "long_put",
  shares: "long_stock",
  short_shares: "short_stock",
};
```

5. remplacer `strategyLines`, `wheelPositions` et `leapsPositions` par :

```ts
/**
 * A condor is read on its legs: its composite row carries a contract without a right nor a strike,
 * which no snapshot position answers, so it never prices. Its four legs do. A condor partly bought
 * back is several composites, each with its legs scaled to the units it covers; grouping by
 * contract sums them back into what is still open.
 */
function flatten(rows: readonly JournalRow[]): JournalRow[] {
  return rows.flatMap((row) => row.legs ?? [row]);
}

/** The open lines of `strategy`, one per contract, grouped by the DETAIL_GROUPS the page shows. */
function linesByGroup(rows: readonly JournalRow[], strategy: PositionsStrategy, priced: Map<string, Priced>): Record<DetailGroupId, StrategyLine[]> {
  const groups = new Map<string, JournalRow[]>();
  for (const row of flatten(rows)) {
    if (row.strategy !== strategy || row.endWhen !== null || row.quantity === null) continue;
    if (LINE_KIND[row.kind] === undefined) continue;
    const id = contractId(row.contract);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  const lines = [...groups.entries()].map(([id, group]) => line(group, priced.get(id) ?? null, STRATEGY_COVER_SOURCES[strategy])).sort(compareLines);
  const byGroup = Object.fromEntries(DETAIL_GROUPS.map((group) => [group.id, [] as StrategyLine[]])) as Record<DetailGroupId, StrategyLine[]>;
  for (const candidate of lines) {
    const group = DETAIL_GROUPS.find((entry) => entry.kinds?.has(candidate.kind)) ?? DETAIL_GROUPS[DETAIL_GROUPS.length - 1];
    byGroup[group.id].push(candidate);
  }
  return byGroup;
}

export interface StrategyPositions {
  /** Wheel only: its assigned shares, which are its long positions — `groups.long` stays empty. */
  shares: WheelShareLine[];
  groups: Record<DetailGroupId, StrategyLine[]>;
}

/**
 * What a strategy holds open, priced from the snapshot: one line per contract, grouped as the
 * Positions page groups a portfolio (spec of sub-project 21, §4.1). Computed, never stored.
 */
export function strategyPositions(rows: readonly JournalRow[], strategy: PositionsStrategy, snapshot: PricedSnapshot | null): StrategyPositions {
  const priced = pricedByContract(snapshot);
  const groups = linesByGroup(rows, strategy, priced);
  if (strategy !== "wheel") return { shares: [], groups };
  const shares = wheelHoldings(rows).map((holding): WheelShareLine => {
    const lastPrice = priced.get(contractId(sharesContract(holding.ticker, holding.currency)))?.position.marketPrice ?? null;
    const { averageAssignmentPrice, averageCallStrike } = holding;
    return {
      ...holding,
      lastPrice,
      unrealizedPnl: lastPrice === null || averageAssignmentPrice === null ? null : (lastPrice - averageAssignmentPrice) * holding.quantity,
      callStrikeBelowAssignment: averageCallStrike !== null && averageAssignmentPrice !== null && averageCallStrike < averageAssignmentPrice,
    };
  });
  // The Wheel's shares are its long positions, shown by their own table: never twice.
  return { shares, groups: { ...groups, long: [] } };
}
```

Supprimer les interfaces `WheelPositions` et `LeapsPositions` devenues inutiles.

**Attention :** `line()` calcule `multiplier` sur `kind === "long_stock"` ; ajouter
`short_stock` à ce test, une action vendue à découvert n'ayant pas plus de multiplicateur :

```ts
  const multiplier = kind === "long_stock" || kind === "short_stock" ? 1 : priced ? contractMultiplier(priced.position) : DEFAULT_MULTIPLIER;
```

- [ ] **Étape 4 : lancer les tests, vérifier qu'ils passent**

Commande : `pnpm --filter @ib/coverage test`
Attendu : SUCCÈS — les cas neufs **et** tous les anciens, qui passent par les deux adaptateurs
définis en tête du fichier de test : c'est ce qui prouve que la Wheel et les LEAPS n'ont pas
changé.

- [ ] **Étape 5 : rendre `apps/web` compilable**

`StrategyPositionsPage.tsx` appelle encore `wheelPositions` et `leapsPositions`. Le brancher
provisoirement sur la fonction neuve, sans rien changer d'autre :

```tsx
  const wheel = useMemo(
    () => (ready && strategy === "wheel" ? strategyPositions(rows, "wheel", pricedSnapshot(snapshot, report)) : null),
    [ready, strategy, rows, snapshot, report],
  );
  const leaps = useMemo(
    () => (ready && strategy === "leaps" ? strategyPositions(rows, "leaps", pricedSnapshot(snapshot, report)) : null),
    [ready, strategy, rows, snapshot, report],
  );
```

et, dans le rendu, `wheel.optionSales` devient `wheel.groups.optionSells`, `leaps.optionBuys`
devient `leaps.groups.optionBuys`, `leaps.optionSells` devient `leaps.groups.optionSells` et
`leaps.shares` devient `leaps.groups.long`. L'import passe à `strategyPositions`.

- [ ] **Étape 6 : vérifier**

Commande : `pnpm --filter web exec vitest run src/pages/StrategyPositionsPage.test.tsx`
Attendu : SUCCÈS, fichier de test non modifié.

Commande : `pnpm --filter web typecheck`
Attendu : SUCCÈS.

- [ ] **Étape 7 : commit**

```bash
git add packages/coverage/src apps/web/src/pages/StrategyPositionsPage.tsx
git commit -m "$(cat <<'MSG'
Une seule fonction de positions pour les quatre stratégies

strategyPositions range les lignes ouvertes d'une stratégie dans les groupes de
la page Positions. Un condor se lit sur ses jambes : son composite n'a ni right
ni strike, donc rien ne le valorise. Les actions de la Wheel restent dans leur
propre table, jamais en double dans le groupe des positions longues.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Tâche 6 : les colonnes et la couverture d'une ligne de stratégie

**Fichiers :**
- Créer : `apps/web/src/lib/strategyColumns.ts`, `apps/web/src/lib/strategyColumns.test.ts`
- Modifier : `apps/web/src/lib/riskReport.ts`, `apps/web/src/pages/StrategyPositionsPage.tsx`

**Interfaces :**
- Consomme : `StrategyLine`, `WheelShareLine`, `PositionsStrategy` (tâche 5) ; `POSITION_COLUMNS`,
  `WHEEL_SHARE_COLUMNS`.
- Produit :
  `strategyColumnSpecs(sectorOf, strategy): ColumnSpec<StrategyLine>[]`,
  `wheelShareColumnSpecs(sectorOf): ColumnSpec<WheelShareLine>[]`,
  `strategyCoverageBadges(line, strategy): CoverageBadge[]`,
  `strategyCoverageValues(line, strategy): string[]`.

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `apps/web/src/lib/strategyColumns.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { StrategyLine, WheelShareLine } from "@ib/coverage";
import { POSITION_COLUMNS, WHEEL_SHARE_COLUMNS } from "@/lib/positionColumns";
import { strategyColumnSpecs, wheelShareColumnSpecs } from "@/lib/strategyColumns";

const CONTRACT = { ticker: "XOM", secType: "OPT", right: "P" as const, strike: 100, expiry: "2026-03-20", currency: "USD" };

function line(overrides: Partial<StrategyLine> = {}): StrategyLine {
  return {
    contract: CONTRACT, kind: "short_put", label: "sell of put", quantity: -2, avgPrice: 2, lastPrice: 1.5,
    marketValue: -300, unrealizedPnl: 100, decision: "keep", position: null, coverage: [], ...overrides,
  };
}

function holding(overrides: Partial<WheelShareLine> = {}): WheelShareLine {
  return {
    ticker: "MQZA", currency: "USD", quantity: 200, averageAssignmentPrice: 17, assignedTotal: 3400,
    openCallContracts: 1, averageCallStrike: 15, coveredShares: 100, lastPrice: 18, unrealizedPnl: 200,
    callStrikeBelowAssignment: true, ...overrides,
  };
}

describe("strategyColumnSpecs", () => {
  it("types the shared ten columns, in their order, coverage filterable but not sortable", () => {
    const specs = strategyColumnSpecs(() => null, "wheel");
    expect(specs.map((spec) => spec.key)).toEqual(POSITION_COLUMNS.map((column) => column.key));
    expect(specs.map((spec) => spec.type)).toEqual(["text", "enum", "enum", "number", "number", "number", "number", "number", "enum", "enum"]);
    expect(specs.filter((spec) => !spec.sortable).map((spec) => spec.key)).toEqual(["coverage"]);
  });

  it("compares what the row shows, the sector read on the contract's ticker", () => {
    const specs = Object.fromEntries(strategyColumnSpecs((symbol) => (symbol === "XOM" ? "Energy" : null), "wheel").map((spec) => [spec.key, spec]));
    expect(specs.position.value(line())).toBe("XOM Mar20'26 100 Put");
    expect(specs.type.value(line())).toBe("short_put");
    expect(specs.type.label?.("short_put")).toBe("sell of put");
    expect(specs.sector.value(line())).toBe("Energy");
    expect(specs.marketValue.value(line())).toBe(-300);
    expect(specs.decision.value(line())).toBe("keep");
  });

  it("filters a sold option of Others on UNCOVERED, whatever the snapshot says", () => {
    const specs = Object.fromEntries(strategyColumnSpecs(() => null, "others").map((spec) => [spec.key, spec]));
    expect(specs.coverage.value(line())).toEqual(["UNCOVERED"]);
  });

  it("filters a condor's sold leg on its spread allocation and its wing on its use", () => {
    const sold = line({ coverage: [{ source: "spread", quantity: 1, detail: "" }] });
    const wing = line({ kind: "long_put", quantity: 1, position: null });
    const specs = Object.fromEntries(strategyColumnSpecs(() => null, "condors").map((spec) => [spec.key, spec]));
    expect(specs.coverage.value(sold)).toEqual(["spread"]);
    expect(specs.coverage.value(wing)).toEqual(["unused"]);
  });
});

describe("wheelShareColumnSpecs", () => {
  it("types the nine columns of the assigned shares, in their order", () => {
    const specs = wheelShareColumnSpecs(() => null);
    expect(specs.map((spec) => spec.key)).toEqual(WHEEL_SHARE_COLUMNS.map((column) => column.key));
    expect(specs.map((spec) => spec.type)).toEqual(["text", "enum", "number", "number", "number", "number", "number", "number", "enum"]);
  });

  it("reads the ticker as the position and the cover as used or unused", () => {
    const specs = Object.fromEntries(wheelShareColumnSpecs((symbol) => (symbol === "MQZA" ? "Crypto" : null)).map((spec) => [spec.key, spec]));
    expect(specs.position.value(holding())).toBe("MQZA");
    expect(specs.sector.value(holding())).toBe("Crypto");
    expect(specs.averageCallStrike.value(holding())).toBe(15);
    expect(specs.coverage.value(holding())).toEqual(["used"]);
    expect(specs.coverage.value(holding({ coveredShares: 0 }))).toEqual(["unused"]);
  });
});
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

Commande : `pnpm --filter web exec vitest run src/lib/strategyColumns.test.ts`
Attendu : ÉCHEC, « Failed to resolve import "@/lib/strategyColumns" ».

- [ ] **Étape 3 : étendre `riskReport.ts`**

Dans `apps/web/src/lib/riskReport.ts`, remplacer `strategyCoverageBadges` par ces deux fonctions,
et ajouter `type PositionsStrategy` à l'import de `@ib/coverage` :

```ts
/**
 * The coverage a strategy's positions page shows (spec of sub-project 16, §3.4, extended by
 * sub-project 21, §4.5): on a sold option the strategy's own cover — the Wheel's shares and cash,
 * the LEAPS' calls, a condor's spread —, on a LEAPS or a condor's wing how much of it covers
 * calls, nothing on shares, whose cover of calls is the Wheel's.
 *
 * Others is the exception: what is filed there is precisely what nothing covers, and UNCOVERED is
 * never an allocation. Its quantity is the naked part, the engine having already split off the
 * part the Wheel or the LEAPS cover, so the badge is read off the line itself.
 */
export function strategyCoverageBadges(line: StrategyLine, strategy: PositionsStrategy): CoverageBadge[] {
  if (line.kind === "short_call" || line.kind === "short_put") {
    if (strategy !== "others") return allocationBadges(line.coverage);
    return [{ variant: COVERAGE_SOURCE_VARIANT[COVER_NONE], label: `${COVER_NONE} ×${Math.abs(line.quantity)}`, tooltip: null }];
  }
  if (line.kind === "long_call" || line.kind === "long_put") return coverageBadges(line.position);
  return [];
}

/** The same branches, as filterable values: the filter never reads the badges' text. */
export function strategyCoverageValues(line: StrategyLine, strategy: PositionsStrategy): string[] {
  if (line.kind === "short_call" || line.kind === "short_put") {
    if (strategy === "others") return [COVER_NONE];
    return [...new Set(line.coverage.map((allocation) => allocation.source))];
  }
  if (line.kind === "long_call" || line.kind === "long_put") {
    return line.position === null ? ["unused"] : [line.position.usedQuantity > 0 ? "used" : "unused"];
  }
  return [];
}
```

**Attention :** `coverageBadges(null)` rend `[]`, alors que `strategyCoverageValues` rend
`["unused"]` pour une option achetée absente du snapshot — c'est voulu : une aile qu'aucune
position ne porte ne couvre rien, et la facette doit pouvoir la ramener.

- [ ] **Étape 4 : écrire `strategyColumns.ts`**

Créer `apps/web/src/lib/strategyColumns.ts` :

```ts
import { KIND_LABELS, type PositionKind, type PositionsStrategy, type StrategyLine, type WheelShareLine } from "@ib/coverage";
import { formatContractLabel } from "@ib/ledger";
import { strategyCoverageValues } from "@/lib/riskReport";
import type { ColumnSpec } from "@/lib/tableView";

type SectorOf = (symbol: string) => string | null;

/**
 * What each shared column compares, filters and sorts on for a strategy's line. Same keys and
 * order as POSITION_COLUMNS — the ten columns are declared once, in positionColumns.ts, and this
 * file only says what they read on a StrategyLine.
 */
export function strategyColumnSpecs(sectorOf: SectorOf, strategy: PositionsStrategy): ColumnSpec<StrategyLine>[] {
  return [
    { key: "position", type: "text", sortable: true, value: (line) => formatContractLabel(line.contract) },
    { key: "type", type: "enum", sortable: true, value: (line) => line.kind, label: (kind) => KIND_LABELS[kind as PositionKind] ?? kind },
    { key: "sector", type: "enum", sortable: true, value: (line) => sectorOf(line.contract.ticker) },
    { key: "marketValue", type: "number", sortable: true, value: (line) => line.marketValue },
    { key: "quantity", type: "number", sortable: true, value: (line) => line.quantity },
    { key: "avgPrice", type: "number", sortable: true, value: (line) => line.avgPrice },
    { key: "lastPrice", type: "number", sortable: true, value: (line) => line.lastPrice },
    { key: "unrealizedPnl", type: "number", sortable: true, value: (line) => line.unrealizedPnl },
    { key: "decision", type: "enum", sortable: true, value: (line) => line.decision },
    { key: "coverage", type: "enum", sortable: false, value: (line) => strategyCoverageValues(line, strategy) },
  ];
}

/**
 * The same for the nine columns of the Wheel's assigned shares (WHEEL_SHARE_COLUMNS), which do not
 * line up on the shared ten: this table is deliberately its own.
 */
export function wheelShareColumnSpecs(sectorOf: SectorOf): ColumnSpec<WheelShareLine>[] {
  return [
    { key: "position", type: "text", sortable: true, value: (line) => line.ticker },
    { key: "sector", type: "enum", sortable: true, value: (line) => sectorOf(line.ticker) },
    { key: "quantity", type: "number", sortable: true, value: (line) => line.quantity },
    { key: "averageAssignmentPrice", type: "number", sortable: true, value: (line) => line.averageAssignmentPrice },
    { key: "averageCallStrike", type: "number", sortable: true, value: (line) => line.averageCallStrike },
    { key: "assignedTotal", type: "number", sortable: true, value: (line) => line.assignedTotal },
    { key: "lastPrice", type: "number", sortable: true, value: (line) => line.lastPrice },
    { key: "unrealizedPnl", type: "number", sortable: true, value: (line) => line.unrealizedPnl },
    { key: "coverage", type: "enum", sortable: false, value: (line) => [line.coveredShares > 0 ? "used" : "unused"] },
  ];
}
```

- [ ] **Étape 5 : brancher l'appel existant et lancer les tests**

Dans `apps/web/src/pages/StrategyPositionsPage.tsx`, `strategyCoverageBadges(line)` prend son
second argument : `strategyCoverageBadges(line, strategy)` — passer `strategy` à `LinesCard`.

Commande : `pnpm --filter web exec vitest run src/lib/strategyColumns.test.ts src/pages/StrategyPositionsPage.test.tsx`
Attendu : SUCCÈS.

- [ ] **Étape 6 : commit**

```bash
git add apps/web/src/lib/strategyColumns.ts apps/web/src/lib/strategyColumns.test.ts apps/web/src/lib/riskReport.ts apps/web/src/pages/StrategyPositionsPage.tsx
git commit -m "$(cat <<'MSG'
Déclarer ce que les colonnes lisent sur une ligne de stratégie

Les dix colonnes partagées et les neuf des actions assignées savent désormais
trier et filtrer une ligne de journal. La couverture d'Autres se lit sur la
quantité de la ligne : ce qui y est filé est précisément ce que rien ne couvre,
et UNCOVERED n'est jamais une allocation.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Tâche 7 : la page Positions de stratégie, équipée

**Fichiers :**
- Créer : `apps/web/src/lib/strategyBoxes.ts`, `apps/web/src/hooks/useStrategyBoxViews.ts`
- Réécrire : `apps/web/src/pages/StrategyPositionsPage.tsx`
- Modifier : `apps/web/src/pages/StrategyPositionsPage.test.tsx`,
  `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`

**Interfaces :**
- Consomme : `searchBoxes`, `filterBoxes`, `activeExpiry` (tâche 3) ; `PageSearchInput` (tâche 4) ;
  `strategyPositions` (tâche 5) ; `strategyColumnSpecs`, `wheelShareColumnSpecs`,
  `strategyCoverageBadges` (tâche 6) ; `FilteredTableBox` (tâche 2).
- Produit : `STRATEGY_BOXES: Record<PositionsStrategy, readonly StrategyBoxDef[]>`,
  `StrategyBoxId = DetailGroupId | "shares"`,
  `useStrategyBoxViews(accountId, strategy, lineColumns, shareColumns): Record<StrategyBoxId, TableViewState>`.

- [ ] **Étape 1 : écrire les tests qui échouent**

Dans `apps/web/src/pages/StrategyPositionsPage.test.tsx` :

1. remplacer le test « says so in each card when the Wheel holds nothing open » par :

```tsx
  it("shows no box at all, and says so once, when the Wheel holds nothing open", async () => {
    renderPage("wheel");
    expect(await screen.findByText("Aucune position ne correspond.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Actions assignées")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Ventes d'options")).not.toBeInTheDocument();
  });
```

2. ajouter, après le bloc LEAPS, les tests de l'équipement :

```tsx
describe("StrategyPositionsPage — search, expiries and column filters", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("searches every box of the page on the ticker and drops the ones it empties", async () => {
    await seed();
    renderPage("wheel");
    await screen.findByLabelText("Actions assignées");
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Rechercher un ticker" }), "=XOM");
    await waitFor(() => expect(screen.queryByLabelText("Actions assignées")).not.toBeInTheDocument());
    expect(within(screen.getByLabelText("Ventes d'options")).getByText("XOM Oct16'26 110 Put")).toBeInTheDocument();
  });

  it("offers only the expiries of the strategy's own options", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-02T12:00:00.000Z") });
    try {
      await seed();
      renderPage("leaps");
      await screen.findByLabelText("Achats d'options");
      const bar = screen.getByRole("group", { name: "Filtrer par expiration" });
      // The Wheel's MQZA and XOM expiries are not the LEAPS': only ZZZ's two are offered.
      expect(within(bar).getAllByRole("button").map((button) => button.textContent)).toEqual(["Sep18'26", "Jun18'27"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("filters every box on the chosen expiry and drops the shares, which have none", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-02T12:00:00.000Z") });
    try {
      await seed();
      renderPage("wheel");
      await screen.findByLabelText("Actions assignées");
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(within(screen.getByRole("group", { name: "Filtrer par expiration" })).getByRole("button", { name: "Oct16'26" }));
      await waitFor(() => expect(screen.queryByLabelText("Actions assignées")).not.toBeInTheDocument());
      expect(within(screen.getByLabelText("Ventes d'options")).getByText("Position : Oct16'26")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a box its own column filter empties, with a way back", async () => {
    await seed();
    renderPage("wheel");
    const box = await screen.findByLabelText("Ventes d'options");
    const user = userEvent.setup();
    const header = within(box).getByRole("columnheader", { name: /^Qté/ });
    await user.click(within(header).getByRole("button", { name: /^Qté/ }));
    await user.type(await screen.findByRole("textbox", { name: "Critère pour Qté" }), ">1000");
    expect(await within(box).findByText("Aucune position ne correspond.")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(within(box).getByRole("button", { name: "Tout effacer" }));
    expect(await within(box).findByText("XOM Oct16'26 110 Put")).toBeInTheDocument();
  });

  it("sorts the assigned shares on their own columns", async () => {
    await seed();
    renderPage("wheel");
    const box = await screen.findByLabelText("Actions assignées");
    const user = userEvent.setup();
    const header = within(box).getByRole("columnheader", { name: /^Quantité/ });
    await user.click(within(header).getByRole("button", { name: /^Quantité/ }));
    expect(await screen.findByRole("button", { name: "Croissant" })).toBeInTheDocument();
  });

  it("remembers each box's view under its own key, per account and per strategy", async () => {
    await seed();
    window.localStorage.setItem(
      "ib2:tableView:beta:positions:wheel:optionSells",
      JSON.stringify({ v: 1, sort: [], criteria: { position: "XOM" } }),
    );
    renderPage("wheel");
    const box = await screen.findByLabelText("Ventes d'options");
    expect(within(box).getByText("XOM Oct16'26 110 Put")).toBeInTheDocument();
    expect(within(box).queryByText("MQZA Oct16'26 15 Call")).not.toBeInTheDocument();
  });
});
```

3. compléter les imports du fichier :

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
```

et ajouter `window.localStorage.clear();` au `beforeEach` global du fichier.

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Commande : `pnpm --filter web exec vitest run src/pages/StrategyPositionsPage.test.tsx`
Attendu : ÉCHEC — pas de champ « Rechercher un ticker », pas de barre d'expiration, en-têtes
inertes.

- [ ] **Étape 3 : écrire `strategyBoxes.ts`**

Créer `apps/web/src/lib/strategyBoxes.ts` :

```ts
import type { DetailGroupId, PositionsStrategy } from "@ib/coverage";

/** A box of a strategy's positions page: a group of DETAIL_GROUPS, or the Wheel's assigned shares. */
export type StrategyBoxId = DetailGroupId | "shares";

export interface StrategyBoxDef {
  id: StrategyBoxId;
  titleKey: string;
}

/**
 * Which boxes each strategy's positions page carries, in which order, under which title (spec of
 * sub-project 21, §4.2). The orders and the titles the Wheel and the LEAPS pages already had do
 * not move; the shared group titles carry the same words, so they are used everywhere else.
 *
 * A declared box with no line never renders: the Wheel shows no "Option buys" because it holds
 * none, and the Condors show wings only when they have some.
 */
export const STRATEGY_BOXES: Record<PositionsStrategy, readonly StrategyBoxDef[]> = {
  wheel: [
    { id: "shares", titleKey: "strategyPositions.groups.assignedShares" },
    { id: "optionSells", titleKey: "positions.groups.optionSells" },
  ],
  leaps: [
    { id: "optionBuys", titleKey: "positions.groups.optionBuys" },
    { id: "optionSells", titleKey: "positions.groups.optionSells" },
    { id: "long", titleKey: "strategyPositions.groups.shares" },
  ],
  condors: [
    { id: "optionBuys", titleKey: "positions.groups.optionBuys" },
    { id: "optionSells", titleKey: "positions.groups.optionSells" },
  ],
  others: [
    { id: "long", titleKey: "positions.groups.long" },
    { id: "optionBuys", titleKey: "positions.groups.optionBuys" },
    { id: "optionSells", titleKey: "positions.groups.optionSells" },
    { id: "other", titleKey: "positions.groups.other" },
  ],
};
```

- [ ] **Étape 4 : écrire `useStrategyBoxViews.ts`**

Créer `apps/web/src/hooks/useStrategyBoxViews.ts` :

```ts
import type { PositionsStrategy } from "@ib/coverage";
import { useTableView, type TableViewState } from "@/hooks/useTableView";
import type { StrategyBoxId } from "@/lib/strategyBoxes";
import type { ColumnMeta } from "@/lib/tableView";
import { tableViewKey } from "@/lib/tableViewStorage";

/**
 * The stored views of a strategy's positions page, held by the page rather than by each box: the
 * expiry buttons write the same criterion in all of them at once. Five `useTableView` in a fixed
 * order, whatever the strategy shows — a hook count never varies between renders, and a view a
 * page does not display costs one read of localStorage.
 */
export function useStrategyBoxViews(
  accountId: string,
  strategy: PositionsStrategy,
  lineColumns: readonly ColumnMeta[],
  shareColumns: readonly ColumnMeta[],
): Record<StrategyBoxId, TableViewState> {
  const prefix = `positions:${strategy}`;
  const long = useTableView(tableViewKey(accountId, `${prefix}:long`), lineColumns);
  const optionBuys = useTableView(tableViewKey(accountId, `${prefix}:optionBuys`), lineColumns);
  const optionSells = useTableView(tableViewKey(accountId, `${prefix}:optionSells`), lineColumns);
  const other = useTableView(tableViewKey(accountId, `${prefix}:other`), lineColumns);
  const shares = useTableView(tableViewKey(accountId, `${prefix}:shares`), shareColumns);
  // Typed by StrategyBoxId: a box added to STRATEGY_BOXES without a hook here fails to compile.
  return { long, optionBuys, optionSells, other, shares };
}
```

- [ ] **Étape 5 : réécrire la page**

Remplacer entièrement `apps/web/src/pages/StrategyPositionsPage.tsx` par :

```tsx
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import {
  strategyPositions,
  type DetailGroupId,
  type PositionsStrategy,
  type PricedSnapshot,
  type RiskReport,
  type StrategyLine,
  type WheelShareLine,
} from "@ib/coverage";
import { contractId, formatContractLabel, type JournalRow } from "@ib/ledger";
import { Badge } from "@ib/ui/badge";
import { Card, CardContent } from "@ib/ui/card";
import { TableCell, TableRow } from "@ib/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ib/ui/tooltip";
import { ExpiryFilterBar } from "@/components/ExpiryFilterBar";
import { PositionRow } from "@/components/PositionRow";
import { FilteredTableBox } from "@/components/table/FilteredTableBox";
import { PageSearchInput } from "@/components/table/PageSearchInput";
import { useAccountJournals, useAccountRiskReport } from "@/db/AccountDataProvider";
import type { SnapshotRecord } from "@/db/schema";
import { useStrategyBoxViews } from "@/hooks/useStrategyBoxViews";
import { usePageSearch, type TableViewState } from "@/hooks/useTableView";
import { expiryChoices, reportToday } from "@/lib/expiryFilter";
import { formatMoney, formatPrice } from "@/lib/format";
import { POSITION_COLUMNS, WHEEL_SHARE_COLUMNS } from "@/lib/positionColumns";
import { strategyCoverageBadges, usedBadge } from "@/lib/riskReport";
import { STRATEGY_BOXES } from "@/lib/strategyBoxes";
import { strategyColumnSpecs, wheelShareColumnSpecs } from "@/lib/strategyColumns";
import { activeExpiry, filterBoxes, searchBoxes, type PreparedBox } from "@/lib/tableBoxes";
import { pageSearchKey } from "@/lib/tableViewStorage";
import { cn } from "@/lib/utils";

export type { PositionsStrategy };

type SectorOf = (symbol: string) => string | null;

const NO_ROWS: readonly JournalRow[] = [];
const NUMERIC = "text-right font-mono tabular-nums";

function pricedSnapshot(snapshot: SnapshotRecord | null | undefined, report: RiskReport | null | undefined): PricedSnapshot | null {
  return snapshot && report ? { positions: snapshot.positions, report } : null;
}

/**
 * A strategy's open positions (spec of sub-project 16, §5.2, extended by sub-project 21): its
 * journal's open lines priced from the snapshot, computed from what the shell already holds, never
 * stored, and equipped like the Positions page — one ticker search, the strategy's own expiries,
 * and a sort and filters per box.
 */
export function StrategyPositionsPage({ strategy }: { strategy: PositionsStrategy }) {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const { t } = useTranslation();
  const journals = useAccountJournals();
  const { snapshot, report, sectorOf } = useAccountRiskReport();
  const lineSpecs = useMemo(() => strategyColumnSpecs(sectorOf, strategy), [sectorOf, strategy]);
  const shareSpecs = useMemo(() => wheelShareColumnSpecs(sectorOf), [sectorOf]);
  const search = usePageSearch(pageSearchKey(accountId, `positions:${strategy}`));
  const views = useStrategyBoxViews(accountId, strategy, lineSpecs, shareSpecs);
  const defs = STRATEGY_BOXES[strategy];
  const ready = journals.status === "ready" && snapshot !== undefined && report !== undefined;
  const rows = journals.status === "ready" ? journals.report.rows : NO_ROWS;
  const positions = useMemo(
    () => (ready ? strategyPositions(rows, strategy, pricedSnapshot(snapshot, report)) : null),
    [ready, rows, strategy, snapshot, report],
  );
  const setExpiry = useCallback(
    (label: string | null) => defs.forEach((def) => views[def.id].setCriterion("position", label)),
    [defs, views],
  );

  if (!ready || positions === null) return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;

  const viewOf = Object.fromEntries(defs.map((def) => [def.id, views[def.id].view]));
  const searchedLines = searchBoxes(
    defs.filter((def) => def.id !== "shares").map((def) => ({ id: def.id, title: t(def.titleKey), all: positions.groups[def.id as DetailGroupId] })),
    lineSpecs,
    { text: search.applied, ticker: (line: StrategyLine) => line.contract.ticker },
  );
  const searchedShares = searchBoxes(
    defs.filter((def) => def.id === "shares").map((def) => ({ id: def.id, title: t(def.titleKey), all: positions.shares })),
    shareSpecs,
    { text: search.applied, ticker: (line: WheelShareLine) => line.ticker },
  );

  // The expiries of this strategy's own options, never the portfolio's: built after the search,
  // before the filters, and on every searched box — including the ones the expiry empties, so the
  // button that emptied them stays in the bar to be undone.
  const choices = expiryChoices(
    searchedLines.flatMap((box) => box.searched.map((line) => ({ expiry: line.contract.expiry }))),
    reportToday(),
  );
  const expiry = activeExpiry(choices, defs.map((def) => def.id), viewOf);
  const lines = new Map(filterBoxes(searchedLines, lineSpecs, viewOf, expiry !== null).map((box) => [box.id, box]));
  const shares = new Map(filterBoxes(searchedShares, shareSpecs, viewOf, expiry !== null).map((box) => [box.id, box]));

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-heading text-lg font-semibold tracking-tight">{t(`strategyPositions.title.${strategy}`)}</h1>

      <PageSearchInput search={search} />
      <ExpiryFilterBar choices={choices} active={expiry} onPick={setExpiry} />

      {lines.size === 0 && shares.size === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("positions.noResults")}</p>
          </CardContent>
        </Card>
      )}

      {defs.map((def) => {
        const holdings = shares.get(def.id);
        if (holdings) return <SharesBox key={def.id} box={holdings} specs={shareSpecs} table={views[def.id]} sectorOf={sectorOf} />;
        const box = lines.get(def.id);
        return box ? <LinesBox key={def.id} box={box} specs={lineSpecs} table={views[def.id]} strategy={strategy} sectorOf={sectorOf} /> : null;
      })}
    </div>
  );
}

function LinesBox({
  box,
  specs,
  table,
  strategy,
  sectorOf,
}: {
  box: PreparedBox<StrategyLine>;
  specs: ReturnType<typeof strategyColumnSpecs>;
  table: TableViewState;
  strategy: PositionsStrategy;
  sectorOf: SectorOf;
}) {
  return (
    <FilteredTableBox
      title={box.title}
      columns={POSITION_COLUMNS}
      labelKey="positions.columns"
      minWidth="60rem"
      specs={specs}
      facetRows={box.facetRows}
      rows={box.rows}
      table={table}
      emptyKey="positions.noResults"
      rowKey={(line) => contractId(line.contract)}
      renderRow={(line) => (
        <PositionRow
          values={{
            contract: formatContractLabel(line.contract),
            label: line.label,
            sector: sectorOf(line.contract.ticker),
            marketValue: line.marketValue,
            quantity: line.quantity,
            avgPrice: line.avgPrice,
            lastPrice: line.lastPrice,
            unrealizedPnl: line.unrealizedPnl,
            decision: line.decision,
            coverage: strategyCoverageBadges(line, strategy),
          }}
        />
      )}
    />
  );
}

function SharesBox({
  box,
  specs,
  table,
  sectorOf,
}: {
  box: PreparedBox<WheelShareLine>;
  specs: ReturnType<typeof wheelShareColumnSpecs>;
  table: TableViewState;
  sectorOf: SectorOf;
}) {
  return (
    <FilteredTableBox
      title={box.title}
      columns={WHEEL_SHARE_COLUMNS}
      labelKey="strategyPositions.columns"
      minWidth="60rem"
      specs={specs}
      facetRows={box.facetRows}
      rows={box.rows}
      table={table}
      emptyKey="positions.noResults"
      rowKey={(line) => `${line.ticker}|${line.currency}`}
      renderRow={(line) => <WheelShareRow line={line} sector={sectorOf(line.ticker)} />}
    />
  );
}

function WheelShareRow({ line, sector }: { line: WheelShareLine; sector: string | null }) {
  const { t } = useTranslation();
  const pnl = line.unrealizedPnl;
  const callPrice = formatPrice(line.averageCallStrike);
  // The same badge as the Positions page gives a long stock position, on the Wheel's own shares.
  const covered = usedBadge(line.coveredShares, line.quantity);
  return (
    <TableRow>
      <TableCell className="font-medium">{line.ticker}</TableCell>
      <TableCell>{sector && <Badge variant="outline">{sector}</Badge>}</TableCell>
      <TableCell className={NUMERIC}>{line.quantity}</TableCell>
      <TableCell className={NUMERIC}>{formatPrice(line.averageAssignmentPrice)}</TableCell>
      {line.callStrikeBelowAssignment ? (
        <TableCell className={cn(NUMERIC, "bg-warning/25")}>
          <Tooltip>
            <TooltipTrigger render={<span>{callPrice}</span>} />
            <TooltipContent>{t("strategyPositions.callBelowAssignment")}</TooltipContent>
          </Tooltip>
        </TableCell>
      ) : (
        <TableCell className={NUMERIC}>{callPrice}</TableCell>
      )}
      <TableCell className={NUMERIC}>{formatMoney(line.assignedTotal)}</TableCell>
      <TableCell className={NUMERIC}>{formatPrice(line.lastPrice)}</TableCell>
      <TableCell className={cn(NUMERIC, pnl !== null && (pnl >= 0 ? "text-success" : "text-destructive"))}>{formatMoney(pnl)}</TableCell>
      <TableCell>
        <Badge variant={covered.variant}>{covered.label}</Badge>
      </TableCell>
    </TableRow>
  );
}
```

- [ ] **Étape 6 : retirer la clé i18n devenue inutile**

Dans `apps/web/src/i18n/fr.json` et `en.json`, retirer `strategyPositions.empty` et
`strategyPositions.groups.optionSales` et `strategyPositions.groups.optionBuys` : les titres
partagés de `positions.groups` portent le même texte, et un encadré vide ne se rend plus.
Garder `strategyPositions.groups.assignedShares` et `strategyPositions.groups.shares`.

- [ ] **Étape 7 : lancer les tests, vérifier qu'ils passent**

Commande : `pnpm --filter web exec vitest run src/pages/StrategyPositionsPage.test.tsx`
Attendu : SUCCÈS — les trois tests d'origine (adaptés) et les six neufs.

Commande : `grep -rn "strategyPositions.empty\|groups.optionSales" apps/web/src`
Attendu : aucune ligne.

- [ ] **Étape 8 : commit**

```bash
git add apps/web/src/lib/strategyBoxes.ts apps/web/src/hooks/useStrategyBoxViews.ts apps/web/src/pages/StrategyPositionsPage.tsx apps/web/src/pages/StrategyPositionsPage.test.tsx apps/web/src/i18n
git commit -m "$(cat <<'MSG'
Équiper les pages Positions de stratégie de la recherche, du tri et des filtres

Une page pour les quatre stratégies : ses encadrés sont déclarés une fois dans
STRATEGY_BOXES, ses cinq vues mémorisées le sont par compte et par stratégie, et
ses boutons d'expiration ne proposent que les options de la stratégie affichée.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Tâche 8 : les pages Positions Condors et Positions Autres

**Fichiers :**
- Modifier : `apps/web/src/routes/router.tsx`, `apps/web/src/routes/router.test.tsx`,
  `apps/web/src/lib/navigation.ts`, `apps/web/src/lib/navigation.test.ts`,
  `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`,
  `apps/web/src/pages/StrategyPositionsPage.test.tsx`

**Interfaces :**
- Consomme : `StrategyPositionsPage` (tâche 7), `STRATEGY_BOXES` (tâche 7).
- Produit : les routes `positions/condors` et `positions/others`, deux entrées de navigation, les
  titres `strategyPositions.title.condors` et `.others`.

- [ ] **Étape 1 : écrire les tests qui échouent**

Dans `apps/web/src/routes/router.test.tsx`, élargir le test existant :

```tsx
  it("routes the four strategies' positions pages under the account", () => {
    const account = router.routes.find((r) => r.path === "/accounts/:accountId");
    for (const strategy of ["wheel", "leaps", "condors", "others"] as const) {
      const route = (account?.children ?? []).find((c) => c.path === `positions/${strategy}`);
      const element = route?.element as ReactElement<{ strategy: string }>;
      expect(element.type).toBe(StrategyPositionsPage);
      expect(element.props.strategy).toBe(strategy);
    }
  });
```

(remplace le test « routes the Wheel and LEAPS positions pages under the account »).

Dans `apps/web/src/lib/navigation.test.ts`, compléter les deux sections attendues :

```ts
      {
        section: "nav.sections.strategyCondors",
        items: [
          ["nav.journal", "/accounts/beta/journal/condors"],
          ["nav.positions", "/accounts/beta/positions/condors"],
          ["nav.stats", "/accounts/beta/stats/condors"],
        ],
      },
      {
        section: "nav.sections.strategyOthers",
        items: [
          ["nav.journal", "/accounts/beta/journal/others"],
          ["nav.positions", "/accounts/beta/positions/others"],
        ],
      },
```

Dans `apps/web/src/pages/StrategyPositionsPage.test.tsx`, ajouter le fixtures et les deux blocs :

```tsx
import { DEMO_TRANSACTIONS } from "@/mocks/journals";

/** A TSLA call sold on nothing at all: the Others journal's naked part. */
const TSLA_CALL: Transaction = {
  ...SAMPLE_JOURNAL_TRANSACTIONS[0],
  externalId: "flex:trade:403",
  symbol: "TSLA  261016C00300000",
  right: "C",
  strike: 300,
  expiry: "2026-10-16",
  quantity: -1,
  price: 1,
  amount: 100,
  when: "2026-08-04T14:30:00.000Z",
};

/**
 * The open QQQ condor of the demo ledger, priced. All four legs: the coverage engine only calls a
 * leg `spread` when it sees the whole defined-risk structure in the snapshot.
 */
const QQQ_LEG = { ...aapl, symbol: "QQQ", secType: "OPT" as const, multiplier: 100, expiry: "2026-10-16" };
const QQQ_POSITIONS = [
  { ...QQQ_LEG, right: "P", strike: 480, quantity: 1, marketPrice: 0.1, marketValue: 10, description: "QQQ 16OCT26 480 P" },
  { ...QQQ_LEG, right: "P", strike: 485, quantity: -1, marketPrice: 0.3, marketValue: -30, description: "QQQ 16OCT26 485 P" },
  { ...QQQ_LEG, right: "C", strike: 520, quantity: -1, marketPrice: 0.2, marketValue: -20, description: "QQQ 16OCT26 520 C" },
  { ...QQQ_LEG, right: "C", strike: 525, quantity: 1, marketPrice: 0.1, marketValue: 10, description: "QQQ 16OCT26 525 C" },
];

async function seedCondor() {
  await db.transactions.bulkAdd([...SAMPLE_JOURNAL_TRANSACTIONS, ...DEMO_TRANSACTIONS]);
  await db.snapshots.put({ ...SNAPSHOT, positions: [...SNAPSHOT.positions, ...QQQ_POSITIONS] });
}

describe("StrategyPositionsPage — Condors", () => {
  it("reads an open condor on its legs, wings bought and body sold, and prices what the snapshot holds", async () => {
    await seedCondor();
    renderPage("condors");
    expect(await screen.findByText("Positions Condors")).toBeInTheDocument();
    const wing = await rowIn("Achats d'options", "QQQ Oct16'26 480 Put");
    expect(texts(wing).slice(0, 7)).toEqual(["QQQ Oct16'26 480 Put", "buy of put", "", "$10.00", "1", "0.25", "0.10"]);
    const sold = await rowIn("Ventes d'options", "QQQ Oct16'26 485 Put");
    expect(texts(sold)[1]).toBe("sell of put");
    expect(within(sold).getByText(/spread/)).toBeInTheDocument();
    // Never the composite: a condor is its legs.
    expect(screen.queryByText(/IC 480/)).not.toBeInTheDocument();
  });
});

describe("StrategyPositionsPage — Others", () => {
  it("groups what fits nowhere else like the overview does, and marks a naked sale UNCOVERED", async () => {
    await db.transactions.bulkAdd([...SAMPLE_JOURNAL_TRANSACTIONS, TSLA_CALL]);
    await db.snapshots.put(SNAPSHOT);
    renderPage("others");
    expect(await screen.findByText("Positions Autres")).toBeInTheDocument();
    expect(within(await screen.findByLabelText("Positions longues")).getByText("AAPL")).toBeInTheDocument();
    const naked = await rowIn("Ventes d'options", "TSLA Oct16'26 300 Call");
    expect(within(naked).getByText("UNCOVERED ×1")).toBeInTheDocument();
  });

  it("shows no cash on a strategy page", async () => {
    await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS);
    await db.snapshots.put(SNAPSHOT);
    renderPage("others");
    await screen.findByLabelText("Positions longues");
    expect(screen.queryByLabelText("Cash")).not.toBeInTheDocument();
  });
});
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Commande : `pnpm --filter web exec vitest run src/routes/router.test.tsx src/lib/navigation.test.ts src/pages/StrategyPositionsPage.test.tsx`
Attendu : ÉCHEC — routes absentes, entrées de menu absentes, titres absents.

- [ ] **Étape 3 : ajouter les routes**

Dans `apps/web/src/routes/router.tsx`, après les deux lignes existantes :

```tsx
      { path: "positions/condors", element: <StrategyPositionsPage strategy="condors" /> },
      { path: "positions/others", element: <StrategyPositionsPage strategy="others" /> },
```

- [ ] **Étape 4 : ajouter les entrées de navigation**

Dans `apps/web/src/lib/navigation.ts`, dans la section Condors, entre Journal et Statistiques :

```ts
      { labelKey: "nav.positions", icon: TrendingUp, to: accountPath("positions/condors") },
```

et dans la section Autres, après Journal :

```ts
  {
    labelKey: "nav.sections.strategyOthers",
    items: [
      { labelKey: "nav.journal", icon: Layers, to: accountPath("journal/others") },
      { labelKey: "nav.positions", icon: TrendingUp, to: accountPath("positions/others") },
    ],
  },
```

- [ ] **Étape 5 : ajouter les titres**

Dans `apps/web/src/i18n/fr.json`, `strategyPositions.title` :

```json
   "condors": "Positions Condors",
   "others": "Positions Autres"
```

Dans `apps/web/src/i18n/en.json` :

```json
   "condors": "Condors positions",
   "others": "Others positions"
```

- [ ] **Étape 6 : lancer les tests, vérifier qu'ils passent**

Commande : `pnpm --filter web exec vitest run src/routes src/lib/navigation.test.ts src/pages/StrategyPositionsPage.test.tsx`
Attendu : SUCCÈS.

- [ ] **Étape 7 : commit**

```bash
git add apps/web/src/routes apps/web/src/lib/navigation.ts apps/web/src/lib/navigation.test.ts apps/web/src/i18n apps/web/src/pages/StrategyPositionsPage.test.tsx
git commit -m "$(cat <<'MSG'
Ajouter les pages Positions des Condors et de la stratégie Autres

Les Condors montrent les jambes ouvertes de leurs structures, Autres reprend les
quatre encadrés de la vue d'ensemble sans la carte Cash, et une vente que rien
ne couvre y porte son badge UNCOVERED.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Tâche 9 : les Journaux

**Fichiers :**
- Créer : `apps/web/src/lib/journalColumns.ts`, `apps/web/src/lib/journalColumns.test.ts`
- Modifier : `apps/web/src/pages/JournalPage.tsx`, `apps/web/src/pages/JournalPage.test.tsx`,
  `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`

**Interfaces :**
- Consomme : `FilteredTableBox` (tâche 2), `PageSearchInput` (tâche 4), `useTableView`,
  `usePageSearch`, `applyView`.
- Produit : `JOURNAL_COLUMNS: readonly ColumnDef[]`, `journalColumnSpecs(t): ColumnSpec<JournalRow>[]`.

- [ ] **Étape 1 : écrire le test des colonnes**

Créer `apps/web/src/lib/journalColumns.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { JournalRow } from "@ib/ledger";
import { JOURNAL_COLUMNS, journalColumnSpecs } from "@/lib/journalColumns";

function row(overrides: Partial<JournalRow> = {}): JournalRow {
  return {
    id: "x#1", strategy: "wheel", kind: "short_put", ticker: "MQZA", label: "MQZA Oct02'26 17 Put", currency: "USD",
    contract: { ticker: "MQZA", secType: "OPT", right: "P", strike: 17, expiry: "2026-10-02", currency: "USD" },
    startWhen: "2026-06-01T14:30:00.000Z", quantity: -2, strike: 17, openPrice: 0.21, openTotal: 42, openCommission: -1,
    openNet: 41, assigned: true, endWhen: null, closePrice: null, closeTotal: null, closeCommission: null, closeNet: null,
    pnl: null, ongoing: true, event: null, orphan: false, note: null, openIds: [], closeIds: [], ...overrides,
  };
}

const t = (key: string, options?: Record<string, unknown>) => `${key}:${options?.contract ?? ""}`;

describe("journalColumnSpecs", () => {
  it("types the seventeen columns, in their order", () => {
    const specs = journalColumnSpecs(t);
    expect(specs.map((spec) => spec.key)).toEqual(JOURNAL_COLUMNS.map((column) => column.key));
    expect(specs.every((spec) => spec.sortable)).toBe(true);
    expect(specs.filter((spec) => spec.type === "date").map((spec) => spec.key)).toEqual(["startWhen", "endWhen"]);
    expect(specs.filter((spec) => spec.type === "enum").map((spec) => spec.key)).toEqual(["assigned", "ongoing"]);
  });

  it("compares what each cell shows: the dated instants, the flags as 1 and 0, the translated note", () => {
    const specs = Object.fromEntries(journalColumnSpecs(t).map((spec) => [spec.key, spec]));
    expect(specs.startWhen.value(row())).toBe("2026-06-01 14:30:00");
    expect(specs.assigned.value(row())).toBe("1");
    expect(specs.ongoing.value(row({ ongoing: false }))).toBe("0");
    expect(specs.note.value(row({ note: { code: "nakedCall" } }))).toBe("journal.notes.nakedCall:");
    expect(specs.note.value(row())).toBeNull();
  });

  it("leaves an open line's end date absent, so it sorts last and only a dash matches it", () => {
    const specs = Object.fromEntries(journalColumnSpecs(t).map((spec) => [spec.key, spec]));
    expect(specs.endWhen.value(row())).toBeNull();
    expect(specs.endWhen.value(row({ endWhen: "2026-07-17T20:00:00.000Z" }))).toBe("2026-07-17 20:00:00");
    expect(specs.pnl.value(row())).toBeNull();
  });
});
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

Commande : `pnpm --filter web exec vitest run src/lib/journalColumns.test.ts`
Attendu : ÉCHEC, « Failed to resolve import "@/lib/journalColumns" ».

- [ ] **Étape 3 : écrire `journalColumns.ts`**

Créer `apps/web/src/lib/journalColumns.ts` :

```ts
import type { JournalRow } from "@ib/ledger";
import type { ColumnDef } from "@/components/table/DataTable";
import { formatDateTime } from "@/lib/format";
import type { ColumnSpec } from "@/lib/tableView";

/**
 * The seventeen columns of a journal, in order. No width: a journal keeps the automatic layout it
 * has always had, its columns sized by their content and the card scrolling sideways below its
 * minimum. Keys are the i18n keys of `journal.columns`.
 */
export const JOURNAL_COLUMNS = [
  { key: "startWhen", numeric: false },
  { key: "label", numeric: false },
  { key: "ticker", numeric: false },
  { key: "quantity", numeric: true },
  { key: "openPrice", numeric: true },
  { key: "openTotal", numeric: true },
  { key: "openCommission", numeric: true },
  { key: "assigned", numeric: true },
  { key: "openNet", numeric: true },
  { key: "endWhen", numeric: false },
  { key: "closePrice", numeric: true },
  { key: "closeTotal", numeric: true },
  { key: "closeCommission", numeric: true },
  { key: "closeNet", numeric: true },
  { key: "pnl", numeric: true },
  { key: "ongoing", numeric: true },
  { key: "note", numeric: false },
] as const satisfies readonly ColumnDef[];

export type Translate = (key: string, options?: Record<string, unknown>) => string;

const flag = (value: boolean) => (value ? "1" : "0");

/**
 * What each column of a journal compares, filters and sorts on: what its cell shows. Same keys and
 * order as JOURNAL_COLUMNS. `assigned` and `ongoing` are enums of "1" and "0" — the very text of
 * the cell — so their filter is a pair of checkboxes rather than a number to type; the note is
 * compared on its translated sentence, the one the reader sees, never on its code.
 */
export function journalColumnSpecs(t: Translate): ColumnSpec<JournalRow>[] {
  return [
    { key: "startWhen", type: "date", sortable: true, value: (row) => formatDateTime(row.startWhen) },
    { key: "label", type: "text", sortable: true, value: (row) => row.label },
    { key: "ticker", type: "text", sortable: true, value: (row) => row.ticker },
    { key: "quantity", type: "number", sortable: true, value: (row) => row.quantity },
    { key: "openPrice", type: "number", sortable: true, value: (row) => row.openPrice },
    { key: "openTotal", type: "number", sortable: true, value: (row) => row.openTotal },
    { key: "openCommission", type: "number", sortable: true, value: (row) => row.openCommission },
    { key: "assigned", type: "enum", sortable: true, value: (row) => flag(row.assigned) },
    { key: "openNet", type: "number", sortable: true, value: (row) => row.openNet },
    { key: "endWhen", type: "date", sortable: true, value: (row) => (row.endWhen === null ? null : formatDateTime(row.endWhen)) },
    { key: "closePrice", type: "number", sortable: true, value: (row) => row.closePrice },
    { key: "closeTotal", type: "number", sortable: true, value: (row) => row.closeTotal },
    { key: "closeCommission", type: "number", sortable: true, value: (row) => row.closeCommission },
    { key: "closeNet", type: "number", sortable: true, value: (row) => row.closeNet },
    { key: "pnl", type: "number", sortable: true, value: (row) => row.pnl },
    { key: "ongoing", type: "enum", sortable: true, value: (row) => flag(row.ongoing) },
    { key: "note", type: "text", sortable: true, value: (row) => (row.note ? t(`journal.notes.${row.note.code}`, { contract: row.note.contract }) : null) },
  ];
}
```

- [ ] **Étape 4 : lancer le test, vérifier qu'il passe**

Commande : `pnpm --filter web exec vitest run src/lib/journalColumns.test.ts`
Attendu : SUCCÈS, 3 tests.

- [ ] **Étape 5 : écrire les tests de page qui échouent**

Dans `apps/web/src/pages/JournalPage.test.tsx` :

1. remplacer le test « filters on the ticker and says when nothing matches » par :

```tsx
  it("searches on the ticker with the shared grammar and says when nothing matches", async () => {
    renderJournal("wheel");
    await screen.findByText("MQZA Oct02'26 17 Put");
    await userEvent.type(screen.getByRole("textbox", { name: "Rechercher un ticker" }), "=ZZZ");
    expect(await screen.findByText("Aucune position ne correspond.")).toBeInTheDocument();
  });
```

2. ajouter, à la fin du `describe("JournalPage")` :

```tsx
  it("sorts on a column and keeps the legs under their condor", async () => {
    renderJournal("condors");
    const row = await rowFor("SPY Aug29'26 IC 620/625/660/665");
    const user = userEvent.setup();
    await user.click(within(row).getByRole("button", { name: "Voir les jambes" }));
    expect(screen.getAllByTestId("journal-leg")).toHaveLength(4);
    const header = screen.getByRole("columnheader", { name: /^Gain\/Perte/ });
    await user.click(within(header).getByRole("button", { name: /^Gain\/Perte/ }));
    await user.click(await screen.findByRole("button", { name: "Croissant" }));
    // The sort runs on the head rows; the legs stay attached to theirs.
    expect(screen.getAllByTestId("journal-leg")).toHaveLength(4);
  });

  it("filters a column and keeps the table, with a way back", async () => {
    renderJournal("wheel");
    await screen.findByText("MQZA Oct02'26 17 Put");
    const user = userEvent.setup();
    const header = screen.getByRole("columnheader", { name: /^En cours/ });
    await user.click(within(header).getByRole("button", { name: /^En cours/ }));
    // By regex: a facet's checkbox is named with its count too ("0 3").
    await user.click(await screen.findByRole("checkbox", { name: /^0/ }));
    await waitFor(() => expect(screen.queryByText("MQZA Oct02'26 17 Put")).not.toBeInTheDocument());
    await user.keyboard("{Escape}");
    expect(screen.getByText("En cours : 0")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tout effacer" }));
    expect(await screen.findByText("MQZA Oct02'26 17 Put")).toBeInTheDocument();
  });

  it("remembers the view of each journal apart, per account", async () => {
    window.localStorage.setItem(
      "ib2:tableView:beta:journal:wheel",
      JSON.stringify({ v: 1, sort: [], criteria: { ticker: "=NOPE" } }),
    );
    renderJournal("wheel");
    expect(await screen.findByText("Aucune position ne correspond.")).toBeInTheDocument();
  });
```

3. ajouter `waitFor` à l'import de `@testing-library/react` et `window.localStorage.clear();` au
   `beforeEach` du fichier.

- [ ] **Étape 6 : lancer les tests, vérifier qu'ils échouent**

Commande : `pnpm --filter web exec vitest run src/pages/JournalPage.test.tsx`
Attendu : ÉCHEC — le champ s'appelle encore « Filtrer sur le ticker… », les en-têtes n'ont pas de
bouton.

- [ ] **Étape 7 : réécrire la page**

Dans `apps/web/src/pages/JournalPage.tsx`, remplacer l'entête du fichier et le corps de
`JournalPage` (les composants `JournalRows` et `JournalTableRow` en bas ne changent pas, sauf la
suppression du tableau `COLUMNS` local, désormais dans `journalColumns.ts`) :

```tsx
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import type { JournalRow, Strategy } from "@ib/ledger";
import { Button } from "@ib/ui/button";
import { Card, CardContent } from "@ib/ui/card";
import { TableCell, TableRow } from "@ib/ui/table";
import { FilteredTableBox } from "@/components/table/FilteredTableBox";
import { PageSearchInput } from "@/components/table/PageSearchInput";
import { useAccountJournals } from "@/db/AccountDataProvider";
import { usePageSearch, useTableView } from "@/hooks/useTableView";
import { formatAmount, formatDateTime, formatPrice } from "@/lib/format";
import { JOURNAL_COLUMNS, journalColumnSpecs } from "@/lib/journalColumns";
import { LABEL_TONE_CLASS, labelTone } from "@/lib/journalTone";
import { applyView, EMPTY_VIEW } from "@/lib/tableView";
import { pageSearchKey, tableViewKey } from "@/lib/tableViewStorage";
import { cn } from "@/lib/utils";

const TITLE_KEY: Record<Strategy, string> = { wheel: "nav.wheel", leaps: "nav.leaps", condors: "nav.condors", others: "nav.others" };

function money(value: number | null): string {
  return value === null ? "—" : formatAmount(value);
}

function flag(value: boolean): string {
  return value ? "1" : "0";
}

interface JournalPageProps {
  strategy: Strategy;
}

/**
 * One strategy's journal: a calculated view of the ledger, never stored. One ticker search and one
 * sort-and-filter view, remembered per account and per strategy. The view runs on the head rows
 * only: a condor's legs stay attached to their composite and show when it is unfolded — filtering
 * them apart would detach a leg from its structure or hide a condor one of its legs matches.
 */
export function JournalPage({ strategy }: JournalPageProps) {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const { t } = useTranslation();
  const journals = useAccountJournals();
  const specs = useMemo(() => journalColumnSpecs(t), [t]);
  const search = usePageSearch(pageSearchKey(accountId, `journal:${strategy}`));
  const table = useTableView(tableViewKey(accountId, `journal:${strategy}`), specs);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  if (journals.status === "loading") {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  const all = journals.report.rows.filter((row) => row.strategy === strategy);
  const searched = applyView(all, specs, EMPTY_VIEW, { text: search.applied, ticker: (row: JournalRow) => row.ticker });
  const rows = applyView(searched, specs, table.view);

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const message = all.length === 0 ? "journal.empty" : searched.length === 0 ? "journal.noResults" : null;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-heading text-lg font-semibold tracking-tight">{t(TITLE_KEY[strategy])}</h1>
      <PageSearchInput search={search} />
      {message !== null ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t(message)}</p>
          </CardContent>
        </Card>
      ) : (
        <FilteredTableBox
          columns={JOURNAL_COLUMNS}
          labelKey="journal.columns"
          specs={specs}
          facetRows={all}
          rows={rows}
          table={table}
          emptyKey="journal.noResults"
          rowKey={(row) => row.id}
          renderRow={(row) => <JournalRows row={row} expanded={expanded.has(row.id)} onToggle={() => toggle(row.id)} />}
        />
      )}
    </div>
  );
}
```

Le reste du fichier (`JournalRows`, `JournalTableRow`) est inchangé ; retirer seulement l'import
`Table, TableBody, TableHead, TableHeader` devenu inutile — `TableCell` et `TableRow` restent.

- [ ] **Étape 8 : retirer la clé i18n du champ**

Dans `apps/web/src/i18n/fr.json` et `en.json`, retirer `journal.filterPlaceholder`.

- [ ] **Étape 9 : lancer les tests, vérifier qu'ils passent**

Commande : `pnpm --filter web exec vitest run src/pages/JournalPage.test.tsx src/lib/journalColumns.test.ts`
Attendu : SUCCÈS — les treize tests d'origine (dont un adapté) et les trois neufs. Le test
« shows the seventeen columns in order » prouve que l'ordre et les libellés n'ont pas bougé.

Commande : `grep -rn "journal.filterPlaceholder" apps/web/src`
Attendu : aucune ligne.

- [ ] **Étape 10 : commit**

```bash
git add apps/web/src/lib/journalColumns.ts apps/web/src/lib/journalColumns.test.ts apps/web/src/pages/JournalPage.tsx apps/web/src/pages/JournalPage.test.tsx apps/web/src/i18n
git commit -m "$(cat <<'MSG'
Trier et filtrer les journaux, et y chercher comme ailleurs

Les dix-sept colonnes deviennent cliquables et le champ de filtre devient la
recherche partagée, mémorisée par compte et par stratégie. Le tri ne porte que
sur les lignes de tête : une jambe reste accrochée à son condor.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Tâche 10 : documentation, vérification complète et instance de relecture

**Fichiers :**
- Modifier : `CLAUDE.md`, `docs/specs/2026-09-18-tri-filtres-strategies-design.md`

- [ ] **Étape 1 : réécrire les règles de `CLAUDE.md`**

Dans la section « Règles qui mordent si on les oublie » :

1. Dans la puce « Tri et filtres des tableaux sont un état d'affichage en `localStorage` », remplacer
   l'énumération des clés par :

```
  une clé par compte et par tableau (`ib2:tableView:<compte>:history`,
  `…:positions:<groupe>`, `…:positions:<stratégie>:<groupe>`, `…:journal:<stratégie>`) et par page
  pour la recherche par ticker (`ib2:pageSearch:`), effacées par `deleteAccount`.
```

   et la dernière phrase « Hors Historique et Positions, aucun tableau n'est triable. » par :

```
  L'Historique, Positions, les quatre pages Positions de stratégie et les quatre Journaux se
  trient et se filtrent par colonne ; aucun autre tableau ne le fait.
```

2. Dans la puce « Les positions d'une stratégie sont une vue calculée », remplacer
   `` `wheelPositions` et `leapsPositions` `` par `` `strategyPositions` `` et ajouter, à la fin
   de la puce :

```
  Les quatre stratégies ont leur page (`positions/wheel`, `/leaps`, `/condors`, `/others`), servies
  par un seul composant : ses encadrés sont déclarés dans `STRATEGY_BOXES`
  (`apps/web/src/lib/strategyBoxes.ts`) et un encadré sans ligne ne se rend pas. **Un condor se lit
  sur ses jambes** — son composite n'a ni right ni strike, donc rien ne le valorise — et les actions
  de la Wheel restent dans leur table propre, jamais aussi dans le groupe des positions longues.
  `STRATEGY_COVER_SOURCES` donne `spread` aux Condors et rien à Autres, dont une vente porte
  `UNCOVERED ×|quantité|` lu sur la ligne elle-même.
```

3. Dans le tableau des sous-projets, ajouter :

```
| 21 | Recherche, tri et filtres des pages de stratégie, Positions Condors et Autres | fait (2026-09-18) |
```

- [ ] **Étape 2 : marquer la spec implémentée**

Dans `docs/specs/2026-09-18-tri-filtres-strategies-design.md`, remplacer
`Statut : spécifié (2026-09-18).` par `Statut : implémenté (2026-09-18).`

- [ ] **Étape 3 : vérification complète**

Commande : `pnpm check`
Attendu : SUCCÈS — lint, typage, fraîcheur des types d'API, build et **tous** les tests des
paquets. C'est le seul `pnpm check` du sous-projet.

En cas d'échec, corriger avant de continuer : ne rien commiter de rouge.

- [ ] **Étape 4 : commit**

```bash
git add CLAUDE.md docs/specs/2026-09-18-tri-filtres-strategies-design.md docs/plans/2026-09-18-tri-filtres-strategies.md
git commit -m "$(cat <<'MSG'
Sous-projet 21 : recherche, tri et filtres des pages de stratégie

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

- [ ] **Étape 5 : démarrer l'instance de relecture**

Commande : `pnpm dev:start`
Attendu : Vite et Django détachés sur les ports du worktree. Relever les deux URL et les donner à
Seb avec la liste des pages à regarder :

- `/accounts/<compte>/positions/wheel` — recherche, expirations, tri des actions assignées ;
- `/accounts/<compte>/positions/leaps` ;
- `/accounts/<compte>/positions/condors` — les jambes du condor ouvert ;
- `/accounts/<compte>/positions/others` — les quatre encadrés, un badge UNCOVERED, pas de Cash ;
- `/accounts/<compte>/journal/wheel` et `/journal/condors` — recherche, tri, filtres, jambes.

**Ne pas merger, ne pas arrêter l'instance** : Seb regarde la branche avant de décider. Au merge,
`pnpm dev:stop` dans le worktree **avant** `git merge` et `git worktree remove`.

---

## Notes d'exécution

- **Ordre des tâches imposé** : 1 → 2 → 3 → 4 (les briques), 5 → 6 (le moteur), 7 → 8 (les pages
  de stratégie), 9 (les journaux), 10 (la doc). Les tâches 5 et 1-4 sont indépendantes et peuvent
  se paralléliser ; rien d'autre ne l'est.
- **Après chaque tâche**, cocher ses cases dans ce fichier, dans le worktree, et les inclure dans
  le commit de la tâche. Une reprise de session part de la première case non cochée.
- **Si une tâche semble réclamer** un endpoint, un modèle Django, une table Dexie ou une migration
  pour porter tri, filtres ou positions : s'arrêter et demander. C'est l'ancienne architecture qui
  remonte.
