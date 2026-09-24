# Sous-projet 31 — Habillage « finance-desktop »

Statut : livré (2026-09-24).

L'application porte aujourd'hui l'habillage shadcn par défaut : primaire bleu, Geist, cartes
cerclées d'un `ring`, barres de défilement natives du système. Deux maquettes fournies par
l'utilisateur, `dark-finance-desktop.html` (thème sombre) et `white-finance-desktop.html`
(thème clair), à la racine du dépôt et non versionnées, fixent la direction : fond bleu nuit ou
gris clair, accent teal, trois niveaux de texte, cartes de 14 px, Inter et JetBrains Mono en
chiffres tabulaires, en-têtes de tableau en petites capitales espacées, liseré teal sur
l'élément actif, curseurs de défilement fins et arrondis.

Ce sous-projet **change l'habillage, jamais la mise en page** : aucune page, aucun composant,
aucune largeur de colonne, aucune hauteur de ligne ne bouge.

---

## 1. Périmètre

**Critère de réussite :** en thème sombre puis clair, le tableau de bord, Positions,
l'Historique, le Journal Wheel et Paramètres, sur la graine de démonstration, montrent les
couleurs, polices, cartes, tableaux, sidebar et barres de défilement des maquettes ; les
étiquettes du Journal Wheel restent distinguables (actions, call vendu, ouvert) ; `pnpm check`
passe.

Dans le périmètre : les tokens (§2), la typographie et les formes (§3), la sidebar et les
tableaux (§4), les graphes (§5), les barres de défilement (§6), la documentation (§7), les
tests (§8).

Hors périmètre, écarté explicitement par l'utilisateur (option « A ») : la barre de titre de la
maquette (titre, recherche, bouton d'action), la carte du compte en pied de sidebar, les badges
de ticker en carré coloré, les sparklines, la structure du tableau de bord de la maquette, les
barres de défilement en surimpression dessinées en JavaScript (option 2 écartée au profit du
CSS seul), la taille de base du texte (13 px dans la maquette) — la réduire fausserait des
largeurs mesurées et `HISTORY_ROW_HEIGHT`.

## 2. Les tokens

Même mécanisme qu'aujourd'hui : variables CSS dans `apps/web/src/index.css`, `:root` pour le
clair, `.dark` pour le sombre, exposées à Tailwind par `@theme inline`. Seules les valeurs
changent, écrites en hexadécimal, reprises telles quelles des maquettes.

| Token | Sombre | Clair | Maquette |
|---|---|---|---|
| `background` | `#080D12` | `#F3F5F8` | `--bg` |
| `card`, `popover` | `#0E151C` | `#FFFFFF` | `--panel` |
| `card-foreground`, `popover-foreground`, `foreground` | `#E7EEF2` | `#0D1A22` | `--tx` |
| `secondary`, `muted` | `#121B23` | `#F8FAFB` | `--panel-2` |
| `secondary-foreground` | `#E7EEF2` | `#0D1A22` | `--tx` |
| `muted-foreground` | `#9AA9B3` | `#52616B` | `--tx-2` |
| `subtle-foreground` *(nouveau)* | `#63727D` | `#8795A0` | `--tx-3` |
| `accent` | `#182731` | `#EDF6F5` | `--hover` |
| `accent-foreground` | `#E7EEF2` | `#0D1A22` | `--tx` |
| `border`, `input` | `#1C2731` | `#E3E8EC` | `--line` |
| `line-2` *(nouveau)* | `#24313C` | `#D5DDE3` | `--line-2` |
| `sep` *(nouveau)* | `#1D2934` | `#E7ECF0` | `--sep` |
| `primary`, `ring`, `success` | `#2BC4B4` | `#0E9F90` | `--teal` |
| `primary-foreground`, `success-foreground` | `#04201D` | `#FFFFFF` | bouton `.btn` |
| `warning` | `#E6B04A` | `#D08A10` | `--gold` |
| `warning-foreground` | `#1B1204` | `#FFFFFF` | |
| `destructive` | `#F0716A` | `#E0473F` | `--red` |
| `sidebar` | `#0A1016` | `#FBFCFD` | `aside` |
| `sidebar-foreground` | `#9AA9B3` | `#52616B` | `.nv` |
| `sidebar-accent` | `#13212A` | `#E9F6F4` | `.nv.on` |
| `sidebar-accent-foreground` | `#E7EEF2` | `#0D1A22` | `.nv.on` |
| `sidebar-primary`, `sidebar-ring` | = `primary` | = `primary` | |
| `sidebar-primary-foreground` | = `primary-foreground` | = `primary-foreground` | |
| `sidebar-border` | `#1C2731` | `#E3E8EC` | `--line` |
| `chart-1…5` | séries du §5 | séries du §5 | |

La hausse est teal, comme dans la maquette (`.up`) : `success` et `primary` partagent la même
teinte. Un seul endroit s'appuyait sur leur différence, les étiquettes du Journal (§5.3).

Les trois nouveaux tokens sont déclarés dans `@theme inline` (`--color-subtle-foreground`,
`--color-line-2`, `--color-sep`) pour servir de classes Tailwind.

## 3. Typographie et formes

- **Polices** : `@fontsource-variable/inter` et `@fontsource-variable/jetbrains-mono`
  remplacent les deux paquets Geist, dépendances d'`apps/web`. `--font-sans` vaut
  `'Inter Variable'`, `--font-mono` `'JetBrains Mono Variable'`. Jamais Google Fonts : l'app ne
  dépend d'aucun tiers à l'exécution.
- **Chiffres** : `body` porte `font-feature-settings: "tnum" 1, "cv11" 1` et
  `-webkit-font-smoothing: antialiased`, comme la maquette. Tous les chiffres deviennent
  tabulaires.
- **Rayon** : `--radius` passe à `0.625rem` (10 px). La carte garde `rounded-xl`, qui vaut
  alors `--radius × 1.4` = 14 px, la valeur de `.card` ; `rounded-lg` vaut 10 px et
  `rounded-md` 8 px, les valeurs de `.btn`/`.search` et de `.nv`.
- **Carte** (`packages/ui/.../card.tsx`) : bordure `border` au lieu de
  `ring-1 ring-foreground/10` ; en clair seulement, l'ombre de la maquette,
  `0 1px 2px rgba(16,24,40,.04), 0 4px 16px -8px rgba(16,24,40,.06)`, portée par une classe
  utilitaire `shadow-card` définie dans `index.css`, nulle en sombre.
- **Bouton primaire** (`button.tsx`, variante `default`) : fond `primary`, texte
  `primary-foreground`, graisse 600 ; en clair, l'ombre teal de `.btn`
  (`0 1px 2px rgba(11,124,113,.25), 0 4px 12px -4px rgba(14,159,144,.5)`), nulle en sombre.
- **Badge** (`badge.tsx`, variantes `secondary` et `outline`) : le style `.env` — fond `muted`,
  liseré intérieur `line-2`, 10,5 px, graisse 600, espacement `.04em`, rayon 6 px. Les
  variantes colorées (`default`, `destructive`) gardent leur rôle, recolorées par les tokens.

## 4. Sidebar et tableaux

### 4.1 Sidebar

- **Logo** (`app-sidebar.tsx`) : le carré prend le dégradé de `.logo i` —
  `linear-gradient(135deg, #2BC4B4, #136E6A)` en sombre,
  `linear-gradient(135deg, #4CC6BC, #0B7C71)` avec l'ombre teal en clair —, texte foncé
  `#04201D` en sombre, blanc en clair.
- **Libellés de section** (`SidebarGroupLabel`) : 10 px, majuscules, espacement `.14em`,
  couleur `subtle-foreground`.
- **Élément** (`SidebarMenuButton`) : couleur `sidebar-foreground`, graisse 500, rayon 8 px ;
  **actif** : fond `sidebar-accent`, texte `sidebar-accent-foreground`, liseré intérieur teal
  de 2 px à gauche (`shadow-[inset_2px_0_0_var(--primary)]`) ; survol : fond `accent`.

### 4.2 Tableaux

`packages/ui/.../table.tsx`, que `DataTable`, `PositionTable` et l'Historique réutilisent :

- **En-tête** (`TableHead`) : 10,5 px, majuscules, espacement `.08em`, graisse 500, couleur
  `subtle-foreground`, bordure basse `border`.
- **Ligne** (`TableRow`) : séparateur `sep` ; survol : fond `accent` sur les cellules et
  liseré teal de 2 px sur la première (`[&>td:first-child]:shadow-[inset_2px_0_0_var(--primary)]`).
- **Cellule** : aucune marge, largeur ni hauteur ne change. `POSITION_COLUMNS`,
  `WHEEL_SHARE_COLUMNS`, `HISTORY_COLUMNS` et `HISTORY_ROW_HEIGHT` restent valides tels quels ;
  une taille de police d'en-tête plus petite ne peut qu'élargir la place disponible.

Les en-têtes figés de l'Historique et des tableaux triables gardent leur fond opaque (`card`) ;
le flou translucide de la maquette est hors périmètre.

## 5. Graphes

### 5.1 ECharts (`apps/web/src/lib/chartColors.ts`)

| Champ | Sombre | Clair |
|---|---|---|
| `success` | `#2BC4B4` | `#0E9F90` |
| `destructive` | `#F0716A` | `#E0473F` |
| `track` | `#16212A` | `#E9EEF1` |
| `foreground` | `#E7EEF2` | `#0D1A22` |
| `surface` | `#0E151C` | `#FFFFFF` |
| `series` | `#6C9EF8`, `#E6B04A`, `#2BC4B4`, `#A28BF5`, `#F0716A` | `#3B78E7`, `#D08A10`, `#0E9F90`, `#7B5CE5`, `#E0473F` |
| `other` | `#7A8C93` | `#7A8C93` |

**L'index d'une série porte un rôle, que l'ordre préserve** : 0 les actions (niveaux `shares`,
courbe « P/L cumulé »), 1 les calls vendus (`shortCall`, « Assigné »), 2 les puts vendus et ce
qui est ouvert (`shortPut`, « Alloué »), 3 les achats LEAPS (`leapsBuy`, « Investi »), 4 le
cinquième secteur du camembert seulement. Chaque rôle prend la teinte de la maquette la plus
proche de l'ancienne : bleu, or (ex-orange), teal (ex-vert), violet (ex-ambre, pour rester
distinct de l'or), corail (ex-rose).
Avant de figer la palette, elle passe le validateur du skill `dataviz` contre `surface` dans
chaque thème ; une teinte qui échoue est ajustée en luminance, jamais remplacée par une autre
famille. `CHART_FONT` passe à `'JetBrains Mono Variable'`. `chart-1…5` de `index.css` reprennent
`series`.

### 5.2 Graphe de cours (`PriceChart.tsx`)

Bougies `UP` teal et `DOWN` rouge, aux valeurs de `success`/`destructive` du thème. Grille en
pointillés comme la maquette (`#1A252E` en sombre, `#E7ECF0` en clair), texte des axes en
`subtle-foreground` (`#63727D` / `#8795A0`), bordures d'échelle en `border`. Ces valeurs vivent
avec les autres dans `chartColors.ts` (champs `grid`, `axisText`, `axisBorder`), plus aucune
couleur n'est écrite dans `PriceChart.tsx`. Le texte des étiquettes de niveau prend le blanc ou
l'encre sombre `#0d1a22`, celui des deux dont le contraste WCAG contre la couleur de la boîte
est le plus haut (`labelInk`, `chartLevels.ts`) : les teintes vives de la palette ne portent
plus toutes un contraste suffisant en blanc seul.

### 5.3 Étiquettes du Journal (`journalTone.ts`)

Aujourd'hui `shares` est teinté `primary` (bleu) et `open` `success` (vert) : avec les deux en
teal, ils se confondraient. `LABEL_TONE_CLASS` prend donc les teintes de `series`, dans les
deux thèmes : `shares` bleu, `shortCall` or, `open` teal — en clair aux opacités actuelles
(`/15`, `/25`, `/15`), en sombre à `/45`. L'actuel `/70` poserait le texte `#E7EEF2` sur un
teal mélangé de contraste 3,3 ; à `/45` les trois teintes dépassent 5,5 sur la carte sombre. La
colonne « En cours » de Secteur et Score, qui reprend `LABEL_TONE_CLASS.open`, suit sans
changement de code.

## 6. Barres de défilement

Toutes les zones défilantes de l'application sont en `overflow-auto` : une barre n'apparaît
que si le contenu déborde, rien à changer là-dessus. Seul leur dessin change, globalement,
dans `index.css` (couche `base`) :

- **Chromium et WebKit** (`::-webkit-scrollbar`) : 10 px, piste transparente, coin
  transparent ; curseur arrondi (`border-radius: 99px`), décollé du bord par une bordure
  transparente de 2-3 px avec `background-clip: padding-box`, teinte
  `rgba(154,169,179,.34)` en sombre, `rgba(82,97,107,.26)` en clair ; au survol
  `rgba(154,169,179,.5)` / `rgba(82,97,107,.42)` ; saisi (`:active`), dégradé menthe → teal de
  la maquette.
- **Firefox**, sous `@supports not selector(::-webkit-scrollbar)` : `scrollbar-width: thin`,
  `scrollbar-color: <curseur> transparent`. Ni survol teal ni dégradé : Firefox ne les permet
  pas.

`HistoryTable.tsx` perd son `[scrollbar-width:thin]` : depuis Chrome 121, `scrollbar-width`
désactive les pseudo-éléments `::-webkit-scrollbar`, et l'Historique garderait sa barre
native. La sidebar garde `no-scrollbar`.

## 7. Documentation

- `CLAUDE.md` : la colonne « En cours » est « sur le teal des puts en cours du journal Wheel »
  au lieu du vert ; ajout d'une règle courte — les couleurs vivent dans les tokens de
  `index.css` et, pour ce qui ne lit pas le CSS (ECharts, lightweight-charts), dans
  `chartColors.ts` seul, tenu en phase par un test ; ligne 31 au registre.
- Le commentaire d'en-tête de `chartColors.ts` renvoie au test de synchronisation.

## 8. Tests

- **Synchronisation** (`chartColors.test.ts`, nouveau) : lit `src/index.css`, extrait les
  valeurs de `:root` et de `.dark`, et vérifie que `success`, `destructive`, `foreground`,
  `surface` (= `card`) et `chart-1…5` (= `series`) de `CHART_COLORS` leur sont égaux. Échoue si
  l'un des deux fichiers change seul.
- **Mis à jour** : `journalTone.test.ts`, `chartLevels.test.ts`, `PriceChart.test.tsx` là où ils
  fixent une couleur.
- **Visuel** : captures `run-frontend --seed` des cinq pages du critère de réussite, dans les
  deux thèmes, une passe à la fin — les valeurs viennent des maquettes, elles ne s'itèrent pas.
- `pnpm check` une seule fois, à la fin ; l'instance de dev du worktree reste démarrée pour la
  relecture.
