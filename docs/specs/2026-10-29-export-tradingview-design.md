# Sous-projet 44 — Export vers TradingView

## Intention

Seb veut voir en quelques secondes, dans TradingView, si une de ses positions bouge fortement, sans
ouvrir l'application ni TWS. L'export remplit une **liste de surveillance TradingView** avec les
titres détenus en ce moment. En option, un **indicateur Pine Script** à copier-coller trace sur le
graphique les niveaux utiles du titre affiché.

## Ce qui a été décidé avec Seb

- Les titres **détenus en ce moment**, tous comptes confondus, sans doublon, jamais les titres
  seulement tradés dans le passé.
- Une entrée **« Export »** dans la section Configuration du menu, juste au-dessus de Paramètres.
- Les niveaux sont un bonus : un seul copier-coller, un seul script actif sur toute la liste.

## Ce qui en découle (choix de l'implémentation, signalés comme tels)

### Route et menu

- `/export`, **hors compte** comme `/settings` et `/help` (`accountScoped: false`) : l'export
  couvre tous les comptes, et la page reste accessible sans compte (elle dit alors qu'il n'y a
  rien à exporter). Icône `Download`.

### La liste de surveillance

- Source : `heldTickers` (`db/sectors.ts`) sur les snapshots de **tous** les comptes, la même
  lecture que la colonne « En cours » de Secteur et Score. Une option compte pour son sous-jacent,
  un `.OLD` jamais.
- Format : celui de l'import de liste de TradingView, des symboles séparés par des virgules sur une
  seule ligne, triés. Ticker nu (TradingView le résout), sauf :
  - un indice de `INDEX_EXCHANGES` s'écrit `PLACE:TICKER` (`CBOE:XSP`), pour ne jamais tomber sur
    l'ETF XSP canadien ;
  - l'espace d'une classe d'actions IB devient un point (`BRK B` → `BRK.B`).
- Deux actions : **Copier** (presse-papiers) et **Télécharger** `ib-analyzer-tradingview.txt`.
  Un aperçu en lecture seule montre le contenu.

### L'indicateur Pine Script

- Pine v6, `indicator(..., overlay = true)`. Au dernier bar (`barstate.islast`), un `switch` sur
  `syminfo.ticker` trace les niveaux du titre affiché : une ligne horizontale prolongée
  (`extend.both`) et une étiquette par niveau. Les objets d'un passage précédent sont effacés.
  `max_lines_count` et `max_labels_count` à 500.
- Niveaux, par compte puis fondus :
  - ceux de `strategyLevels` pour les stratégies actives du compte plus Autres, ce que dessinent
    les graphes de Positions : actions Wheel (prix d'entrée), puts et calls vendus (strike),
    quatre strikes de chaque condor ;
  - les achats LEAPS n'ont **pas** de prix dans le moteur (il se lit sur la barre du jour) et
    sont omis ;
  - les seuils des alertes non désactivées, manuelles et automatiques (`thresholds`, quand le seuil
    est connu), lus comme le veilleur les lit (`manualAlerts`, `autoAlerts`).
- Même titre, même nature, même prix dans deux comptes : un seul niveau, quantités sommées.
  Seuils d'alerte identiques : un seul.
- Couleurs : la palette sombre de `chartColors` (actions bleu, calls or, puts teal, condor bleu),
  les alertes en `warning`, en pointillé. Étiquette `17.5 Put: -6`, `Alerte 120`, mots tirés de
  l'i18n (`charts.levels.*`), nombres au point décimal (Pine).
- Clé du `switch` : la forme TradingView du ticker sans place (`XSP`, `BRK.B`), celle que rend
  `syminfo.ticker`.
- Le script est **figé** : la page dit qu'il faut le recoller quand les positions changent, et que
  les niveaux n'apparaissent que sur le graphique, jamais dans la liste.

### Règles respectées

- Rien ne quitte le navigateur, sauf ce que l'utilisateur copie ou télécharge lui-même. Aucun
  endpoint, aucune table, aucun stockage : la page est une vue calculée.
- Les générateurs sont purs (`lib/tradingview.ts`) et testés ; le chargement multi-comptes
  (`export/loadExport.ts`) passe par `loadAccountJournals`, comme le veilleur.
- Démonstration : la page fonctionne sur la base de démo comme le reste.

## Hors champ

- Une section par compte ou par stratégie dans la liste (`###…`).
- La place de cotation des actions (IB ne la stocke pas) et les titres hors USD, résolus par
  TradingView seul.
- Toute synchronisation automatique avec TradingView.
