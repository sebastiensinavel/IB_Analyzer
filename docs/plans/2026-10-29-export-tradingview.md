# Plan — Sous-projet 44 : Export vers TradingView

Spec : `docs/specs/2026-10-29-export-tradingview-design.md`. TDD, une case par commit.

- [x] 1. `lib/tradingview.ts` : `tradingViewSymbol`, `watchlistText`, `mergeExportLevels`,
      `pineScript` purs, testés (`tradingview.test.ts`).
- [ ] 2. `export/loadExport.ts` : tickers détenus de tous les comptes, niveaux et seuils d'alerte
      par compte via `loadAccountJournals`, testé sur `fake-indexeddb`.
- [ ] 3. `pages/ExportPage.tsx`, route `/export`, entrée « Export » au-dessus de Paramètres,
      i18n fr/en, testés.
- [ ] 4. Aide, CLAUDE.md (règle et registre), `pnpm check`, instance de relecture démarrée.
