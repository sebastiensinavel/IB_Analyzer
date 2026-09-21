# Sous-projet 25 — Le compte serveur : ce qu'il ouvre, ce qu'il sauvegarde

Statut : conçu (2026-09-21), non implémenté.

Le 2026-09-21, l'utilisateur signale que l'application revient parfois d'elle-même sur la page
de sélection de compte, avec une liste vide, alors que deux comptes existent ; se reconnecter
les fait réapparaître. Aucune donnée n'est perdue, mais l'application affiche un portefeuille
inexistant et laisse croire qu'elle a tout effacé.

La cause n'est pas un bug isolé : **la base IndexedDB que l'application ouvre est choisie
d'après la réponse du serveur à la question « qui es-tu ? »**. Le serveur ne voit toujours
aucune donnée — il ne fournit qu'un numéro d'utilisateur — mais ce numéro nomme la base locale,
si bien que tout ce qui coupe la session coupe l'accès aux données. C'est l'inverse de la règle
fondatrice de ce dépôt : « la connexion n'est jamais exigée pour utiliser l'application »
(`CLAUDE.md`, spec d'architecture §2).

Ce sous-projet coupe ce lien, et, dans le même mouvement, livre la sauvegarde chiffrée et les
Paramètres qui étaient le sous-projet 6 — parce que la sauvegarde est précisément ce qui rend
la coupure sans risque, et qu'elle avait besoin d'une base locale unique pour savoir quoi
chiffrer. **Le sous-projet 6 est fondu dans celui-ci.**

---

## 1. Périmètre

**Critère de réussite :** l'application entière s'utilise sans avoir jamais créé de compte
Django, sauvegarde comprise ; créer un compte plus tard ne déplace rien et ne perd rien ; et
aucun état de la session — absente, lente, expirée, changée — ne modifie ce que l'application
affiche.

Dans le périmètre :

1. une base locale unique par navigateur, indépendante du compte (§3) ;
2. l'hygiène de session, pour ne plus être déconnecté sans raison (§4) ;
3. la sauvegarde chiffrée sur le serveur, opt-in (§5) ;
4. l'export et l'import d'un fichier local, pour qui n'a pas de compte (§6) ;
5. la restauration (§7) et la carte Sauvegarde de la page Paramètres (§8) ;
6. les tests qui fixent tout cela (§9).

Hors périmètre, délibérément (arbitré le 2026-09-21, §10) : l'inscription libre, la fusion
entre appareils, la sauvegarde à l'horloge, et le rapatriement des données déjà écrites dans
un profil par utilisateur.

---

## 2. Ce que disent les données

### 2.1 Le mécanisme

`apps/web/src/db/profile.ts` nomme une base par utilisateur :

```
profileDbName(null) → "ib-analyzer"     le profil anonyme
profileDbName("9")  → "ib-analyzer-9"   le profil de l'utilisateur 9
```

`DbProvider` (`apps/web/src/db/DbProvider.tsx:24`) lit `useSession()` et ne retient un numéro
que dans l'état `authenticated` ; les trois autres — `loading`, `anonymous`, `unreachable` —
donnent tous `null`, donc le profil anonyme. Or ce profil anonyme est **vide** : à la première
connexion, `adoptDefaultProfile` (`profile.ts:49`) l'a recopié dans le profil de l'utilisateur
puis supprimé. Une base vide donne une liste de comptes vide, et `AppLayout.tsx:46` redirige
alors vers `/accounts`. Le symptôme observé, en entier.

### 2.2 Quatre déclencheurs, trois mesurés

La base de développement au 2026-09-21 porte quatorze sessions depuis le 5 septembre, soit
environ une connexion par jour, alors qu'aucune n'avait expiré avant la suivante. Ce n'est
donc pas l'expiration seule qui déconnecte.

1. **La clé secrète change d'un lancement à l'autre.** Deux des quatorze sessions sont
   illisibles avec la clé de développement (« Session data corrupted ») : elles ont été
   signées avec une autre `DJANGO_SECRET_KEY`. `apps/api/README.md:44` décrit un lancement
   local en `DJANGO_DEBUG=0` avec une clé exportée à la main, tandis que l'instance observée
   tournait en `DJANGO_DEBUG=1`, donc sur la clé de développement committée. **Chaque bascule
   entre les deux invalide tous les cookies de session d'un coup.**
2. **La session n'est jamais prolongée.** `SESSION_SAVE_EVERY_REQUEST` n'est pas posé dans
   `config/settings.py`, donc l'`expire_date` est figée à la connexion. Mesuré : la session
   du 5 septembre est morte le 19 septembre, quatorze jours plus tard, malgré un usage
   quotidien.
3. **Deux utilisateurs Django existent**, et un seul porte les données : l'autre ouvrirait un
   profil vide. Une connexion avec le mauvais des deux courriels donne une application
   vierge, sans que rien ne le dise.
4. **Une course au démarrage**, celle-ci lue dans le code et non mesurée : pendant l'aller-
   retour réseau de `fetchSession()`, `session.status` vaut `loading`, donc `DbProvider` sert
   déjà le profil anonyme. IndexedDB étant locale, elle répond souvent avant le réseau :
   `useAccounts()` rend `[]` et `AppLayout` redirige avant que la session soit connue. Ni
   `AppLayout` ni `RootRedirect` ne consultent `session.status`, là où `AccountsPage.tsx:109`
   et `useFlexAutoSync.ts:148` attendent, eux, la fin du `loading`.

### 2.3 Ce que la correction rend inutile

Le quatrième déclencheur **disparaît sans être traité**. La course n'existe que parce que le
choix de la base dépend d'une réponse réseau ; une base fixe est bonne dès le premier rendu.
Aucune garde `session.status` n'est donc ajoutée à `AppLayout` ni à `RootRedirect` : ce serait
traiter le symptôme d'une cause supprimée.

---

## 3. Une base par navigateur

Une seule base, `ib-analyzer`, par origine, toujours la même, connecté ou non.

`apps/web/src/db/profile.ts` est supprimé avec ses trois fonctions et son test.
`DbProvider` conserve son contexte — `useDb()` reste le point d'accès unique de tous les
hooks et de tous les écrivains, et les tests sur `fake-indexeddb` en dépendent — mais ne sert
plus qu'une constante : il n'observe plus la session. `useDbError`, le drapeau `failed` et la
clé i18n `settings.profileError` n'ont plus d'objet et partent avec.

**Ce choix suppose qu'un navigateur sert un seul utilisateur** (arbitré le 2026-09-21). Deux
personnes qui se connecteraient tour à tour depuis le même navigateur partageraient le même
portefeuille ; le cas est déclaré hors sujet, et non traité.

La conséquence à assumer : les données déjà écrites dans un profil par utilisateur cessent
d'être lues. Elles ne sont pas détruites — la base `ib-analyzer-<id>` reste dans le
navigateur — mais aucune migration ne les rapatrie (§10).

---

## 4. L'hygiène de session

Le compte ouvre désormais deux portes nommées, et rien d'autre : le proxy Flex (§7.4 de la
spec d'architecture) et la sauvegarde chiffrée (§5 ici). Déconnecté, ces deux fonctions sont
grisées ; tout le reste de l'application fonctionne à l'identique.

Deux réglages pour ne plus être déconnecté sans raison :

- **Session glissante.** `SESSION_SAVE_EVERY_REQUEST = True` et `SESSION_COOKIE_AGE` posée
  explicitement à trente jours. Tant que l'application est utilisée, la session ne meurt pas.
- **Clé de développement stable.** Une clé est engendrée une fois par checkout et rangée dans
  son dossier git, à côté de `dev-slot` (`checkoutGitDir`, `tools/dev-env/ports.mjs`), puis
  posée dans l'environnement par `pnpm dev:api` et `pnpm dev:start` quel que soit
  `DJANGO_DEBUG`. Jamais versionnée, supprimée avec le worktree, comme le slot.
  `config/settings.py` **ne change pas** : il continue de refuser de démarrer hors DEBUG sur la
  clé committée, ce qui reste la garde contre une production sur clé publique.

---

## 5. La sauvegarde chiffrée

La spec d'architecture §7.5 fixe déjà la forme et n'est pas rouverte : trois endpoints, un
blob opaque par utilisateur, plafond 20 Mo, clé AES-GCM 256 engendrée par WebCrypto, montrée
une seule fois comme code de récupération, désactivée par défaut. Ce qui suit précise ce
qu'elle laissait ouvert.

### 5.1 Côté serveur

Un modèle `core.Backup` : `user` en `OneToOneField`, les octets, leur taille, la date de
dépôt. Trois routes dans `apps/api/core/api.py`, authentifiées : déposer (remplace), lire,
supprimer. Le plafond de 20 Mo est refusé avec un code d'erreur propre, jamais une exception
nue. Ni le blob ni sa taille ne sont journalisés.

**Ce modèle n'est pas la table interdite.** Le signal d'arrêt de `CLAUDE.md` vise un endpoint,
un modèle ou une migration pour des *transactions, des positions ou des secteurs* — de la
donnée de portefeuille que le serveur pourrait lire. Le §7.1 de la spec d'architecture prévoit
explicitement, et depuis l'origine, « des utilisateurs, et pour ceux qui l'ont activé, un blob
chiffré opaque ». Le serveur stocke des octets qu'il ne peut pas déchiffrer et dont il ignore
la structure. Toute relecture future qui hésiterait doit s'arrêter à ce paragraphe.

### 5.2 Côté navigateur

- **La clé** est engendrée par WebCrypto à l'activation, rangée en IndexedDB **hors du blob** —
  une clé sauvegardée dans ce qu'elle chiffre ne sauvegarde rien — et montrée une seule fois
  sous forme de code de récupération.
- **Le contenu** est le JSON de toutes les tables Dexie, `statements` compris : les relevés
  HTML bruts font partie de la sauvegarde. **Décision prise le 2026-09-21**, qui ferme le point
  laissé ouvert dans `docs/points-reportes.md`. Une sauvegarde qui rend les lignes sans les
  fichiers qui les ont produites rend une base qu'on ne peut plus reconstruire : « Relire les
  relevés » deviendrait un piège au lieu d'un filet. Le poids n'est plus l'argument qu'il
  était : le HTML se comprime d'un facteur dix à vingt, et plusieurs années de relevés tiennent
  largement sous le plafond.
- **La chaîne** est : JSON → `CompressionStream('gzip')` → AES-GCM avec un IV aléatoire par
  dépôt. La compression sert aussi au reste du blob.

### 5.3 Quand la sauvegarde part

Automatiquement, **après les écritures qui comptent seules** : un import de relevé, une synchro
Flex, une édition de la table sectorielle, la création ou la suppression d'un compte. Jamais
après un snapshot de l'agent local ni après une valeur intraday.

La règle tient en une phrase — *on sauvegarde ce qui ne se reconstruit pas tout seul* — et elle
suit la frontière que l'application trace déjà entre source et dérivé. Le déclencheur au fil de
l'eau était exclu pour une raison mesurable : l'agent écrit un snapshot à chaque sondage,
quelques secondes d'intervalle, et enverrait des mégaoctets en boucle toute la séance.

Un bouton « Sauvegarder maintenant » existe dans tous les cas, et rien ne part tant que la
sauvegarde n'est pas activée.

---

## 6. L'export local, pour qui n'a pas de compte

Le même paquet — mêmes tables, même gzip — écrit dans un fichier que l'utilisateur garde, et
relu par un bouton d'import. Sans chiffrement : le fichier ne quitte pas sa machine, et une
clé de plus à retenir en ferait une sauvegarde qu'on ne sait pas relire.

C'est ce qui rend honnête la première exigence du sous-projet : tout faire sans jamais créer de
compte, sauvegarde comprise. Le paquet **contient le jeton Flex**, puisqu'il contient la fiche
des comptes ; l'interface le dit à l'export.

---

## 7. Restaurer

**Remplacer, jamais fusionner.** La base locale est écrasée par le contenu du paquet, après une
confirmation qui affiche la date de ce qui va être restauré. Une fusion n'aurait pas de sens
défini : deux snapshots concurrents, deux fiches de compte, deux tables sectorielles éditées à
la main ne se réconcilient pas sans arbitrage, et l'application n'en a aucun à proposer.

Sur un nouvel appareil, le code de récupération est demandé une fois puis retenu ; sur
l'appareil habituel, rien n'est jamais demandé (spec d'architecture §7.5). Pas de détection de
conflit entre appareils : le dernier dépôt gagne.

---

## 8. La page Paramètres

La page existe déjà (`apps/web/src/pages/SettingsPage.tsx`) avec le compte, le mot de passe, la
2FA et les codes de récupération. Il n'y a donc pas de page à créer, mais une carte
**Sauvegarde** à y ajouter : activer ou désactiver, date et taille du dernier dépôt,
« Sauvegarder maintenant », « Restaurer », « Supprimer du serveur », le code de récupération
montré une seule fois, et l'export comme l'import du fichier local. Les deux derniers restent
disponibles sans compte ; tout le reste est grisé hors connexion, comme la synchro Flex.

La carte retire en passant le message `settings.profileError`, devenu sans objet (§3).

---

## 9. Tests

**Le non-régression qui compte**, en Vitest : la liste des comptes est identique que la session
soit absente, lente, expirée ou authentifiée, et aucune redirection ne part sur une liste vide.
C'est le test qui échouerait si quiconque rebranchait un jour la base sur la session.

**L'aller-retour**, en Vitest : chiffrer puis déchiffrer puis restaurer rend une base identique
à l'originale, relevés HTML compris. Le même test sur le fichier local.

**Le déclencheur**, en Vitest : un import de relevé envoie, un snapshot de l'agent n'envoie pas.

**Le serveur**, en pytest : le plafond de 20 Mo refusé proprement, un seul blob par
utilisateur, le remplacement, la suppression, et surtout l'isolation — un utilisateur ne lit
jamais le blob d'un autre, ni ne le remplace.

`pnpm gen:api` est rejoué après l'ajout des routes ; `pnpm check` vérifie la fraîcheur du
schéma généré.

---

## 10. Décisions écartées

| Écarté | Pourquoi |
|---|---|
| Garder un profil IndexedDB par utilisateur, mais afficher « session expirée » au lieu d'une application vide | Honnête, mais contredit frontalement la règle fondatrice : serveur éteint, application inutilisable. Le compte doit ouvrir des fonctions, pas les données |
| Rapatrier les profils existants (`ib-analyzer-<id>`) vers la base unique | Écarté par l'utilisateur le 2026-09-21. Rien n'est détruit : l'ancienne base reste dans le navigateur et un rapatriement resterait possible plus tard. La table sectorielle, seule donnée saisie à la main et qu'aucun fichier IB ne reconstruit, est à exporter avant la bascule |
| Une garde `session.status === "loading"` dans `AppLayout` et `RootRedirect` | Traiterait le symptôme d'une cause supprimée (§2.3) |
| L'inscription libre sur le serveur | L'invitation reste le seul chemin, décision du sous-projet 3. L'obstacle réel n'était pas l'invitation mais le déplacement des données à la connexion, que ce sous-projet supprime |
| Une sauvegarde qui n'emporte que le dérivé, sans `db.statements` | Rendrait une base non reconstructible (§5.2) |
| Le déclencheur au fil de l'eau, ou à l'horloge | L'agent écrirait en boucle ; l'horloge enverrait sans changement et manquerait des changements (§5.3) |
| Chiffrer aussi l'export local | Une clé de plus à retenir pour un fichier qui ne quitte pas la machine |
| Détecter les conflits entre appareils | Un seul utilisateur par navigateur est supposé (§3) ; le dernier dépôt gagne |

---

## 11. Documentation

- `CLAUDE.md` : le sous-projet 6 est marqué fondu dans le 25 ; le registre gagne la ligne 25 ;
  la section des règles perd toute mention d'un profil par utilisateur et gagne la règle « la
  base locale appartient au navigateur, le compte n'ouvre que le proxy Flex et la sauvegarde ».
- `docs/points-reportes.md` : le point « la sauvegarde chiffrée doit décider du sort de
  `db.statements` » est fermé par le §5.2 ; une section « Reporté par le sous-projet 25 »
  recueille ce que la revue de branche relèvera.
- `apps/api/README.md` : la clé de développement n'est plus à exporter à la main (§4).
