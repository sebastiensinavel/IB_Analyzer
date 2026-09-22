# Sous-projet 28 — Premiers pas : l'accueil d'un nouvel utilisateur

Statut : livré (2026-09-22).

Un nouvel arrivant atterrit sur `/accounts`. Il y trouve un titre « Comptes », une carte
« Aucun compte pour l'instant. Créez le premier ci-dessous. », un formulaire « Créer le
compte » et, dans l'en-tête, un bouton « Se connecter ». Rien ne lui dit ce qu'est
l'application, ni que le compte à créer est un compte Interactive Brokers à suivre et non un
compte utilisateur, ni que la connexion est facultative et sur invitation. L'argument le plus
fort du produit — **rien ne quitte le navigateur** — n'apparaît qu'à la page Aide, qui ne
parle que de l'agent local.

Ce sous-projet ne change aucune donnée, aucun flux et aucune route. Il change ce que lit un
nouvel arrivant sur quatre pages existantes : Comptes, la page de connexion, Sources de
données (et le tableau de bord vide) et l'Aide.

Deux règles fondatrices encadrent le travail. **La connexion n'est jamais exigée pour utiliser
l'application** (spec §7.3) : tout texte ajouté doit le rendre évident, jamais l'obscurcir.
Et **Paramètres et Aide s'atteignent sans aucun compte** : l'accueil ne rebondit vers rien.

---

## 1. Périmètre

**Critère de réussite :** un utilisateur qui découvre l'application sans y avoir été guidé
comprend, depuis la seule page Comptes, ce qu'elle fait, ce qu'il y crée, ce qu'il n'est pas
obligé de faire, et quelle est sa première action utile après avoir ajouté un compte IB.

Dans le périmètre :

1. le bloc d'accueil et le formulaire renommé de la page Comptes (§2) ;
2. « Compte serveur », facultatif, partout où « Se connecter » apparaît, et la page de
   connexion qui dit ce qu'elle ouvre (§3) ;
3. la carte « Première étape » sur Sources de données et sur le tableau de bord vide (§4) ;
4. l'Aide réorganisée en premiers pas (§5) ;
5. les textes, en français et en anglais (§6) ;
6. les tests qui fixent tout cela (§7).

Hors périmètre, délibérément (arbitré le 2026-09-22, §8) : un compte de démonstration semé
depuis les fixtures ; tout changement de ce que fait la validation du formulaire d'ajout ;
toute modification du serveur, de l'inscription sur invitation ou de la base locale.

---

## 2. La page Comptes

### 2.1 Le bloc d'accueil

Une carte **en tête de page**, au-dessus de la liste des comptes, toujours rendue, qu'il y ait
zéro, un ou plusieurs comptes. Décidé le 2026-09-22 (§8) : un compte ajouté n'efface pas
l'accueil ; la page reste la même, on y ajoute un autre compte ou on en ouvre un.

Elle porte, dans l'ordre :

1. Le nom, **IB Analyzer**, et une accroche d'une phrase : ce que l'application analyse.
2. Trois bénéfices, une ligne chacun : couverture des ventes d'options et cash requis ;
   journaux Wheel, LEAPS et Condors reconstitués depuis l'historique ; historique complet,
   positions et statistiques par stratégie.
3. La promesse de confidentialité, en une phrase mise en évidence : les données restent dans
   ce navigateur, le serveur ne voit jamais transactions ni positions.
4. « Comment ça marche », trois étapes numérotées : ajouter un compte IB ; importer un relevé
   d'activité ou brancher une Flex Query ; lire le tableau de bord. La troisième mentionne
   l'agent local comme option, pour les données en direct.
5. Un lien vers l'Aide, « Premiers pas ».

Aucune image, aucune animation : des textes et la même carte que partout ailleurs.

### 2.2 Le formulaire renommé

- Titre de page : « Vos comptes Interactive Brokers » (`accounts.title`).
- La carte vide : « Aucun compte IB pour l'instant. Ajoutez le premier ci-dessous. »
- Titre de la carte du formulaire : « Ajouter un compte IB », sous-titre d'une phrase : « Un
  compte ici est un compte Interactive Brokers que vous suivez. Il est créé dans ce
  navigateur ; rien n'est envoyé. »
- Champ « Nom » (au lieu de « Libellé »), avec l'exemple « Compte marge » en `placeholder`.
- Champ « Identifiant de compte IB » inchangé ; son indice dit **à quoi il sert** : « Tel
  qu'affiché dans le Client Portal, ex. U1234567. Il sert à vérifier que les fichiers importés
  et l'agent local sont bien ceux de ce compte. » C'est vrai : `importFile` et `agent/sync.ts`
  refusent ce qui ne le porte pas.
- Bouton : « Ajouter ce compte ». Le sélecteur de la barre latérale dit déjà « Ajouter un
  compte… » ; les deux s'alignent.
- **La validation ne change pas** : elle crée le compte et ouvre Sources de données, comme
  aujourd'hui. Décidé le 2026-09-22 (§8).

Les clés d'erreur (`accounts.errors.*`) ne changent pas.

---

## 3. « Compte serveur », facultatif

### 3.1 Le libellé

« Se connecter » devient **« Compte serveur »** aux trois endroits où il apparaît :
l'en-tête de la page Comptes (`SessionCorner`), le pied de la barre latérale
(`SessionMenuItem`) et la carte de session de Paramètres. Une seule clé, `auth.serverAccount`,
pour les trois ; `auth.signIn` reste le libellé du bouton de validation de la page de
connexion, où il est exact.

Le mot « facultatif » **doit apparaître**. Dans l'en-tête de Comptes et dans la barre
latérale, il n'y a pas la place d'une phrase : le lien porte un `title` (info-bulle) et un
`aria-label` « Compte serveur, facultatif : relais Flex Query et sauvegarde chiffrée », et
le mot « facultatif » est rendu **en clair** à côté du libellé, en petit et en couleur
atténuée, aux trois endroits : l'en-tête de Comptes, la barre latérale et la carte de session
de Paramètres. Un état `authenticated` continue d'afficher l'adresse e-mail et le bouton de
déconnexion, sans changement.

### 3.2 La page de connexion

Au-dessus du formulaire, un paragraphe en trois phrases :

1. Ce que la connexion ouvre : le relais Flex Query par le serveur quand l'agent local est
   absent, et la sauvegarde chiffrée de vos données sur le serveur.
2. Que tout le reste fonctionne sans : relevés, Flex Query par l'agent, journaux, positions.
3. Que l'accès se fait **sur invitation** : sans invitation, il ne manque rien, on ferme cette
   page et on continue.

Le titre de la carte reste « Se connecter » — c'est bien l'action — mais la page porte un
titre de niveau supérieur, « Compte serveur », au-dessus de la carte, pour que le lien et la
page portent le même nom. Un lien « Retour » ramène à `location.state.from`, `/` par défaut,
la même cible que la connexion réussie.

---

## 4. La première étape

### 4.1 La carte

Un composant `FirstStepCard` (`apps/web/src/components/FirstStepCard.tsx`), une carte :

- Titre : « Première étape ».
- Texte : « Importez un relevé d'activité HTML exporté du Client Portal, ou renseignez le
  jeton et l'identifiant de votre Flex Query. Le tableau de bord se remplit dès le premier
  import. »
- Deux liens : vers Sources de données (`/accounts/:id/sources`) et vers l'Aide (`/help`),
  libellés « Aller aux sources de données » et « Comment obtenir un relevé ».

### 4.2 Où et quand elle s'affiche

**Le critère est « rien n'a jamais alimenté ce compte »** : aucun `ImportRecord` pour le
compte et `lastAgentSyncAt` absent sur sa fiche. Une synchro Flex passe par `importFile`,
donc écrit un `ImportRecord` ; l'agent n'en écrit aucun mais stampe `lastAgentSyncAt`. Un
import refusé écrit lui aussi son `ImportRecord` : la carte disparaît alors, et le compte
rendu d'import prend le relais — c'est le comportement voulu, l'utilisateur a agi et voit le
résultat de son action. Le critère se calcule dans un hook `useNeverFed(accountId)`
(`db/hooks.ts`), à partir de `useImports` et `useAccount`, et rend `undefined` tant que l'un
des deux charge : la carte ne clignote pas.

- **Sources de données** : la carte est rendue en tête de page, au-dessus de la carte
  « Compte », tant que le critère tient. Le lien vers Sources de données n'y est pas rendu
  (on y est) ; celui vers l'Aide, si.
- **Tableau de bord** : la carte « Aucune position » existante est remplacée par
  `FirstStepCard` tant que le critère tient, avec ses deux liens. Dès qu'un import a eu lieu,
  le tableau de bord retrouve son comportement actuel — « Aucune position » s'il n'y a pas de
  snapshot, ses cartes sinon. Un utilisateur qui clique « Ouvrir » depuis Comptes sur un
  compte neuf tombe ainsi sur une consigne, jamais sur une page vide.

La page Positions garde son texte actuel : elle n'est pas sur le chemin d'un nouvel arrivant.

---

## 5. L'Aide en premiers pas

La page devient une suite de sections dans l'ordre où un nouvel arrivant en a besoin. Les
sections de l'agent gardent leur contenu mot pour mot et leurs clés ; seuls leur numéro et
leur place changent. Le composant `Section` et `Command` de `HelpPage.tsx` sont réutilisés.

| # | Section | Clé | Contenu |
|---|---|---|---|
| — | L'application | `help.app` | L'accroche et les trois bénéfices de §2.1, la promesse de confidentialité, et les trois paliers en une phrase chacun : relevé ou Flex Query seuls ; les deux ; avec l'agent local pour l'intraday. |
| 1 | Obtenir un relevé d'activité | `help.statement` | Dans le Client Portal : Performance & Reports › Statements › Activity ; choisir la période la plus longue proposée, le format HTML, télécharger. Un relevé par année pour remonter loin ; « Sources de données › Importer des fichiers » accepte plusieurs fichiers à la fois. Le fichier est conservé dans le navigateur pour pouvoir être rejoué. |
| 2 | Configurer une Flex Query | `help.flex` | Dans le Client Portal : Performance & Reports › Flex Queries. Créer une Activity Flex Query avec les sections **Trades**, **Cash Transactions**, **Corporate Actions**, **Open Positions** et **Cash Report**, et dans chacune **cocher « Select All »** plutôt que les champs un par un (§5.1). Période « Last 365 days », format XML. Activer le Flex Web Service et copier le jeton ; noter l'identifiant de la requête. Les saisir dans « Sources de données › Flex Query ». Ce que le parseur ne trouve pas est listé dans Sources de données à chaque synchro. |
| 3 | L'agent local | `help.what` | Inchangée, renumérotée : la section d'introduction actuelle. |
| 4 à 9 | Installer uv, Installer l'agent, Le configurer et le lancer, Régler l'API de TWS, La permission du navigateur, Renseigner le port | `help.uv` … `help.port` | Inchangées, renumérotées. |

### 5.1 Tout cocher, jamais champ par champ

**L'Aide dit de cocher « Select All » dans chaque section**, jamais d'énumérer les colonnes à
retenir. Décidé le 2026-09-22 (§8). Une liste de colonnes serait longue à lire, pénible à
reproduire dans l'interface du Client Portal, et fausse au premier champ dont une version
future du parseur aurait besoin. Tout cocher produit un XML un peu plus gros — volume
parfaitement raisonnable pour une Flex Query — et met l'utilisateur à l'abri : les colonnes
que le parseur lit sont là par construction.

La conséquence vaut aussi pour la page Sources de données : un avertissement
`column-missing` devient alors le signe qu'une section a été cochée partiellement, et l'Aide
donne la réponse, tout cocher.

**Corporate Actions est la cinquième section, et la seule que le parseur ne réclame pas.**
`checkSections` (`packages/ib-parsers/src/flex.ts`) n'exige que quatre sections — Trades, Cash
Transactions, Open Positions, Cash Report — et avertit d'une absence par `section-missing`.
Corporate Actions est lu (les opérations sur titres en viennent) mais jamais vérifié : décochée,
elle ne produit **aucun avertissement**, et les splits et fusions manquent en silence. C'est
précisément pourquoi l'Aide la nomme comme les autres.

**Les chemins du Client Portal sont à vérifier dans le Client Portal au moment de l'écriture
des textes**, pas recopiés de ce spec : Interactive Brokers renomme ses menus, et le libellé
exact de la case qui coche tout dans une section — « Select All » au 2026-09-22 — est à lire
sur place. Le plan porte cette vérification comme une tâche, avec la liste exacte des sections
lue dans `packages/ib-parsers/src/flex.ts` (`checkSections`) : c'est le parseur qui fait foi
sur ce qui est requis, le texte le suit.

Le lien « Comment obtenir un relevé » de §4.1 pointe sur `/help#statement` ; les sections
portent un `id` pour cela.

---

## 6. Les textes

Toutes les clés nouvelles vivent dans `apps/web/src/i18n/fr.json` et `en.json`, à parité,
fixée par `i18n/index.test.ts`. Aucune phrase n'est écrite dans un composant.

| Clé | Français |
|---|---|
| `accounts.title` | Vos comptes Interactive Brokers |
| `accounts.welcome.tagline` | Analysez vos portefeuilles Interactive Brokers, actions et options. |
| `accounts.welcome.benefits` (tableau) | Couverture de vos ventes d'options et cash requis, à tout instant. / Journaux Wheel, LEAPS et Condors reconstitués depuis votre historique. / Historique complet, positions et statistiques par stratégie. |
| `accounts.welcome.privacy` | Vos données restent dans ce navigateur : le serveur ne voit jamais vos transactions ni vos positions. |
| `accounts.welcome.howTitle` | Comment ça marche |
| `accounts.welcome.steps` (tableau) | Ajoutez un compte IB ci-dessous. / Importez un relevé d'activité, ou branchez une Flex Query. / Lisez votre tableau de bord ; l'agent local, facultatif, ajoute les données en direct. |
| `accounts.welcome.helpLink` | Premiers pas |
| `accounts.empty` | Aucun compte IB pour l'instant. Ajoutez le premier ci-dessous. |
| `accounts.addTitle` | Ajouter un compte IB |
| `accounts.addHint` | Un compte ici est un compte Interactive Brokers que vous suivez. Il est créé dans ce navigateur ; rien n'est envoyé. |
| `accounts.label` | Nom |
| `accounts.labelPlaceholder` | Compte marge |
| `accounts.ibAccountIdHint` | Tel qu'affiché dans le Client Portal, ex. U1234567. Il sert à vérifier que les fichiers importés et l'agent local sont bien ceux de ce compte. |
| `accounts.create` | Ajouter ce compte |
| `auth.serverAccount` | Compte serveur |
| `auth.optional` | facultatif |
| `auth.serverAccountTitle` | Compte serveur, facultatif : relais Flex Query et sauvegarde chiffrée. |
| `auth.intro.opens` | Un compte serveur ouvre deux choses : le relais de votre Flex Query par le serveur quand l'agent local est absent, et la sauvegarde chiffrée de vos données. |
| `auth.intro.without` | Tout le reste fonctionne sans : relevés, Flex Query par l'agent local, journaux, positions. |
| `auth.intro.invitation` | L'accès se fait sur invitation. Sans invitation, il ne vous manque rien : fermez cette page et continuez. |
| `auth.back` | Retour |
| `firstStep.title` | Première étape |
| `firstStep.text` | Importez un relevé d'activité HTML exporté du Client Portal, ou renseignez le jeton et l'identifiant de votre Flex Query. Le tableau de bord se remplit dès le premier import. |
| `firstStep.sourcesLink` | Aller aux sources de données |
| `firstStep.helpLink` | Comment obtenir un relevé |
| `help.app.*`, `help.statement.*`, `help.flex.*` | Les textes de §5, rédigés dans le plan après vérification du Client Portal. |

Les clés `help.what` à `help.port` gardent leur texte ; seuls les numéros dans les titres
changent (« 1. Installer uv » devient « 4. Installer uv », etc.).

Le texte anglais est la traduction fidèle, pas un résumé.

---

## 7. Tests

Tous sous Vitest, sur `fake-indexeddb`, base semée, jamais de hook moqué (CLAUDE.md, Tests).

- **`AccountsPage.test.tsx`** : le bloc d'accueil est rendu sans compte **et** avec deux
  comptes ; le bouton du formulaire dit « Ajouter ce compte » ; la validation navigue toujours
  vers `/accounts/:id/sources` (test existant, gardé tel quel) ; le lien de l'en-tête dit
  « Compte serveur » et porte le mot « facultatif » en clair, en session `anonymous` comme
  `unreachable`.
- **`SessionMenuItem.test.tsx`** et **`SettingsPage.test.tsx`** : le libellé et le mot
  « facultatif » ; l'état `authenticated` inchangé.
- **`LoginPage.test.tsx`** : le paragraphe d'introduction et la ligne sur l'invitation sont
  rendus ; « Retour » mène à `from`.
- **`FirstStepCard.test.tsx`** et **`hooks.test.ts`** : `useNeverFed` rend `undefined` pendant
  le chargement, `true` sur un compte neuf, `false` dès un `ImportRecord` — réussi ou refusé —
  ou dès `lastAgentSyncAt`.
- **`SourcesPage.test.tsx`** : la carte est en tête sur un compte neuf, sans le lien vers
  Sources de données ; absente après un import.
- **`DashboardPage.test.tsx`** : sur un compte neuf, `FirstStepCard` remplace « Aucune
  position » ; après un import sans snapshot, « Aucune position » revient.
- **`HelpPage.test.tsx`** : l'ordre des sections, du titre « L'application » au titre
  « 9. Renseigner le port » ; les `id` des sections.
- **`i18n/index.test.ts`** : parité des clés, déjà en place, couvre les nouvelles.

---

## 8. Décisions du 2026-09-22

- **Le bloc d'accueil reste une fois un compte ajouté.** Un changement complet de page à
  l'ajout serait moins clair : la page Comptes garde son visage, on y ajoute et on y ouvre.
- **La validation du formulaire ouvre Sources de données**, comme aujourd'hui. Aucun retour à
  la liste après l'ajout.
- **« Se connecter » devient « Compte serveur »**, et « facultatif » apparaît en clair, pas
  seulement en info-bulle.
- **Pas de compte de démonstration** dans ce sous-projet. C'est ce qui donnerait le plus envie,
  mais cela sème la base depuis une fixture embarquée dans le bundle et se décide à part.
- **Aucune modification du serveur** : l'inscription reste fermée et sur invitation ; le
  texte le dit au lieu de le cacher.
- **L'Aide fait cocher toute une section de la Flex Query, pas des champs choisis.** Un peu
  plus de volume, nettement plus simple à suivre, et rien ne manque le jour où le parseur lit
  une colonne de plus.
