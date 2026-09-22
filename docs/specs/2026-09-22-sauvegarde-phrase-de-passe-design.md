# Sous-projet 26 — La sauvegarde sans rien à conserver : clé enveloppée par une phrase de passe

Statut : spécifié (2026-09-22).

La sauvegarde chiffrée livrée au sous-projet 25 tire une clé AES-GCM 256 au hasard, la range
en IndexedDB et la montre **une seule fois**, sous forme de code de récupération. Restaurer
sur un navigateur neuf exige ce code : l'utilisateur a donc un objet de quarante-trois
caractères à garder en lieu sûr, pour la seule fois de sa vie où il en aura besoin. Perdu, la
sauvegarde est un blob illisible — y compris pour nous, ce qui est la propriété recherchée et
le piège en même temps.

Ce sous-projet remplace ce code par **une phrase de passe que l'utilisateur choisit**. La clé
aléatoire reste ce qui chiffre le paquet ; la phrase ne chiffre qu'elle, et l'enveloppe
voyage dans l'en-tête du blob. Rien à conserver, rien de plus sur le serveur.

Deux règles fondatrices encadrent le travail. **Le serveur ne voit ni la phrase, ni la clé,
ni le contenu** : il reçoit quatre-vingt-treize octets de plus qu'avant, dont il ne sait rien.
Et **Paramètres reste atteignable sans compte** : c'est le chemin de restauration d'un
navigateur neuf, qui par définition n'a rien.

---

## 1. Périmètre

**Critère de réussite :** sur un navigateur neuf, sans aucune donnée locale, saisir l'adresse
du compte, son mot de passe et la phrase de passe de la sauvegarde restitue le portefeuille
entier. Sur le navigateur habituel, rien n'est jamais demandé — ni à l'ouverture, ni au dépôt
automatique, ni à la restauration.

Dans le périmètre :

1. l'en-tête du blob et son moteur cryptographique (§2, §3) ;
2. l'enveloppe stockée localement, et le typage qui la rend obligatoire (§4) ;
3. les cinq chemins de l'interface (§5) ;
4. le retrait du code de récupération et la montée Dexie qui l'accompagne (§6) ;
5. les textes, en français et en anglais (§8) ;
6. les tests qui fixent tout cela (§9).

Hors périmètre, délibérément (arbitré le 2026-09-22, §10) : l'export local `.json.gz`, qui
reste en clair ; le mot de passe du compte Django, qui ne touche jamais la clé ; toute
lecture d'un blob déposé avant ce sous-projet.

---

## 2. Le format du blob

Le corps ne change pas : c'est toujours la charge gzippée, chiffrée en AES-GCM 256 par une
clé de trente-deux octets tirée de `crypto.getRandomValues`. Ce qui change est ce qui le
précède.

```
"IB2B" (4) ‖ version=2 (1) ‖ sel (16) ‖ ivEnveloppe (12) ‖ cléEnveloppée (48) ‖ ivCorps (12) ‖ corps
```

Quatre-vingt-treize octets d'en-tête. La clé enveloppée fait quarante-huit octets : les
trente-deux de la clé, plus les seize de la balise d'authentification d'AES-GCM.

**C'est cette balise qui détecte une phrase erronée.** AES-GCM authentifie son propre chiffré :
une mauvaise phrase dérive une mauvaise clé d'enveloppe, dont le déchiffrement échoue sur
quarante-huit octets, jamais sur vingt mégaoctets. L'échec remonte comme un `BackupKeyError`,
exactement la forme d'erreur que la carte Paramètres sait déjà rendre.

**Les paramètres Argon2id ne sont pas dans l'en-tête ; l'octet de version les nomme.** La
version 2 désigne la suite entière : Argon2id 64 Mio, trois passes, parallélisme 1, puis
AES-GCM 256 pour l'enveloppe comme pour le corps. Changer un paramètre un jour sera une
version 3, que le lecteur aiguillera. Deux raisons, dont la seconde est la vraie : ça
économise douze octets, mais surtout **un coût mémoire lu dans le fichier est un paramètre
fourni par l'attaquant** — un blob forgé annonçant quatre gigaoctets ferait tomber le
navigateur qui tente de le restaurer. Ce que le format ne porte pas ne peut pas être
retourné contre lui.

**Un blob sans la magie `"IB2B"` est refusé.** Le format du sous-projet 25 n'avait aucun
en-tête : son absence serait donc reconnaissable, et une branche pourrait le lire. Cette
branche n'existe pas — décidé le 2026-09-22, §10.

## 3. Le moteur cryptographique

Tout vit dans `apps/web/src/db/backup/crypto.ts`, à côté de `encryptBlob`/`decryptBlob` qui
ne changent pas.

- **`deriveWrapKey(phrase, sel)`** appelle `argon2idAsync` de `@noble/hashes/argon2` avec
  `{ m: 65536, t: 3, p: 1, dkLen: 32, asyncTick: 1 }`. La variante asynchrone rend la main à
  la boucle d'événements périodiquement : l'onglet reste vivant et le spinner s'affiche
  réellement pendant la dérivation, là où la variante synchrone figerait le fil principal
  plusieurs secondes sans rien repeindre. Aucun Web Worker n'est donc nécessaire.
- **`wrapKey(clé, phrase)`** tire un sel de seize octets et un IV de douze, dérive, chiffre
  les trente-deux octets de clé, et rend `{ salt, iv, wrapped }`.
- **`unwrapKey(enveloppe, phrase)`** dérive et déchiffre ; un échec devient `BackupKeyError`.
- **`packBlob(enveloppe, corpsChiffré)`** et **`readHeader(octets)`** posent et lisent les
  quatre-vingt-treize octets. `readHeader` refuse une magie absente ou inconnue, un octet de
  version inconnu, et un blob trop court pour son propre en-tête.

`@noble/hashes` est déjà une dépendance de production du dépôt (`packages/ib-parsers`, pour
le hachage synchrone) ; `apps/web` la déclare à son tour.

**Le coût réel d'Argon2id 64 Mio en JavaScript pur est à mesurer, pas à supposer.** Le plan
le mesure à sa première tâche. Plafond acceptable : **cinq secondes** sur la machine de
développement. Au-delà, la version 2 descend à 32 Mio, écrit noir sur blanc dans ce spec
avant que le reste ne soit construit — jamais découvert après coup.

## 4. Ce qui est stocké localement

`BackupStateRecord` gagne un champ, **obligatoire** :

```ts
wrap: { salt: Uint8Array<ArrayBuffer>; iv: Uint8Array<ArrayBuffer>; wrapped: Uint8Array<ArrayBuffer> };
```

Obligatoire, et non optionnel, parce que le typage porte alors une garantie que l'interface
n'aurait qu'énoncée : **toute sauvegarde active a une enveloppe**, il n'existe aucun état
intermédiaire où la clé serait là sans elle. Un champ optionnel aurait rouvert exactement la
branche que §10 ferme.

La phrase de passe, elle, n'est retenue **nulle part** : ni en IndexedDB, ni en mémoire au-delà
du formulaire qui la saisit. Elle n'est nécessaire qu'à l'activation, à la restauration sur un
navigateur neuf, et à son propre changement.

`NEVER_BACKED_UP` exclut déjà la table `backup` en entier : l'enveloppe ne voyage donc jamais
*dans* la charge qu'elle protège, seulement devant elle, dans l'en-tête. C'est la même raison
qui en excluait la clé, et elle vaut mot pour mot.

Les signatures de `db/backup/state.ts` suivent :

- `enableBackup(db, phrase)` tire la clé, l'enveloppe, écrit la ligne ;
- `adoptBackupKey(db, clé, enveloppe)` prend les deux ensemble — la clé seule n'est plus un
  état représentable ;
- `rewrapBackupKey(db, nouvellePhrase)` réenveloppe la clé que ce navigateur détient déjà.

## 5. Les cinq chemins

| Chemin | Ce qui se passe | Phrase demandée |
|---|---|---|
| **Activation** | Clé tirée, phrase saisie deux fois, Argon2id, enveloppe écrite | oui, une fois |
| **Dépôt automatique** | `state.wrap` recopié devant le corps, aucune dérivation | jamais |
| **Restauration, navigateur habituel** | La clé est là : l'en-tête est sauté, le corps déchiffré | jamais |
| **Restauration, navigateur neuf** | En-tête lu → phrase → Argon2id → clé → corps ; clé **et** enveloppe adoptées | oui, une fois par navigateur |
| **Changer la phrase** | Nouveau sel, réenveloppe des trente-deux octets, dépôt déclenché | la nouvelle seulement |

Quatre points que ce tableau ne dit pas assez fort :

**La double saisie à l'activation n'est pas de la ceinture-bretelles.** Une faute de frappe
sur un mot de passe de connexion se découvre à la connexion suivante, dans la minute. Ici,
elle ne se découvre que le jour où le navigateur d'origine a disparu — et ce jour-là, il n'y
a plus aucun recours.

**Changer la phrase ne demande pas l'ancienne**, parce que le navigateur détient déjà la clé
en clair : il la réenveloppe, il ne la déverrouille pas. Exiger l'ancienne serait un rituel
sans propriété de sécurité, sur un appareil qui a déjà tout.

**Changer la phrase n'est effectif qu'une fois le dépôt arrivé.** Tant qu'il n'a pas atterri,
le serveur porte l'ancienne enveloppe, et l'ancienne phrase ouvre encore. La carte le dit ;
c'est la vérité du système, pas une approximation à cacher.

**Une phrase oubliée rend la sauvegarde illisible, définitivement.** Le gain de ce sous-projet
n'est pas la récupérabilité — elle n'existait pas davantage avec le code —, c'est le confort :
un secret qu'on retient au lieu d'un secret qu'on range. La carte le dit **avant** l'activation,
pas après.

**Exigence sur la phrase : douze caractères au minimum, et rien d'autre.** Une règle, un test,
aucune dépendance. Sous le champ, une ligne qui dit ce qui est en jeu : le blob est sur un
serveur, une phrase courte s'y attaque hors ligne, et l'oublier ferme la porte. La règle
mesure la longueur et non l'entropie, ce qui laisse passer `motdepasse123` : c'est assumé
(§10), le rempart est Argon2id, pas un jugement sur le texte.

## 6. Le retrait du code de récupération

`toRecoveryCode` et `fromRecoveryCode` disparaissent de `crypto.ts`, avec leurs tests et le
long commentaire qui justifiait le point comme séparateur. La phrase de passe est le seul
chemin.

**Dexie monte en version 11, dont la seule montée supprime la ligne `backup`.** Conséquence
assumée, et dite ici plutôt que découverte : le navigateur retrouve l'état « sauvegarde
serveur désactivée ». L'utilisateur la réactive en choisissant une phrase, une clé neuve est
tirée, et le premier dépôt remplace le blob du serveur — il y en a un seul par utilisateur.
Rien à nettoyer côté serveur, et rien qui parte en silence : une sauvegarde désactivée est un
état que la carte affiche déjà en toutes lettres.

## 7. Le serveur : rien

Aucun endpoint, aucune colonne sur `core.Backup`, aucune migration Django, aucun changement
d'`openapi.json` ni du schéma TypeScript généré. Le serveur reçoit des octets un peu plus
longs, dont il ne sait rien de plus qu'avant.

C'est ce que l'en-tête-dans-le-blob achète. Ranger l'enveloppe à côté du blob, dans une
colonne, aurait été la solution évidente et aurait coûté une migration, un champ à l'API, un
champ au schéma généré, et une raison de rouvrir `apps/api` — pour soixante-seize octets qui
tiennent devant le corps qu'ils protègent.

## 8. Les textes

`apps/web/src/i18n/{fr,en}.json`. Sortent : `backupRecoveryHint`, `backupRecoveryPrompt`,
`backupInvalidCode`. Entrent, entre autres : le libellé et l'aide du champ de phrase, celui du
champ de confirmation, le refus d'une confirmation qui diffère, le refus d'une phrase trop
courte, l'avertissement d'oubli, le bouton « Changer la phrase de passe », l'attente pendant
la dérivation, et le message qui dit qu'un changement n'est effectif qu'au prochain dépôt.

La parité des clés entre les deux fichiers n'est vérifiée par aucun test (dette notée au
sous-projet 27) : elle se relit à la main ici.

## 9. Les tests

**`apps/web`, Vitest sur `fake-indexeddb`**, avec un ledger semé en base, jamais en moquant
les hooks.

`crypto.test.ts` : aller-retour enveloppe ; phrase erronée → `BackupKeyError` ; magie absente,
magie inconnue, octet de version inconnu, blob trop court, tous refusés ; deux enveloppes de
la même clé et de la même phrase diffèrent par leur sel.

`state.test.ts` : enveloppe écrite à l'activation ; adoptée avec la clé à la restauration ;
remplacée par `rewrapBackupKey` sans que la clé bouge.

`sync.test.ts` : le dépôt porte l'en-tête ; le navigateur habituel ignore l'en-tête et entre
par sa clé locale ; le navigateur neuf entre par la phrase et adopte les deux ; une phrase
erronée sur un navigateur neuf ne laisse rien derrière elle.

`schema.test.ts` : la montée 10 → 11 supprime la ligne `backup`. Ce test constate un effet de
migration réel — contrairement aux sept `expect(upgraded.verno)` cérémonielles notées au
sous-projet 25, qui constatent ce que le constructeur déclare.

`BackupCard.test.tsx` : double saisie ; refus d'une confirmation qui diffère ; refus sous
douze caractères ; la phrase demandée à la restauration sur un navigateur sans clé et pas sur
un navigateur qui en a une ; le changement de phrase.

**Vérification visuelle** par le driver de `run-frontend` sur la page Paramètres, en clair et
en sombre : le formulaire d'activation, celui de restauration, celui de changement.

---

## 10. Décisions écartées

| Écarté | Pourquoi |
|---|---|
| Dériver la clé du mot de passe du compte Django | Le mot de passe transite par le serveur à la connexion : la clé ne serait plus hors de sa portée. C'est la ligne du §13 de l'architecture, qui reste vraie et que ce sous-projet ne touche pas |
| Un pré-hachage côté navigateur, Django n'authentifiant que `KDF(mot de passe, sel)` | Réécrit le formulaire de connexion et d'inscription d'allauth, impose une migration des mots de passe, et le serveur voit toujours un dérivé du secret |
| OPAQUE ou SRP | Remplace tout le chemin de connexion d'allauth par de la cryptographie maison, pour une application de trois endpoints |
| Garder le code de récupération comme second chemin | Deux chemins d'ouverture à écrire, traduire et tester, pour un recours que la phrase de passe rend rarement nécessaire. Le choix de la simplicité, fait en connaissance de ce qu'il coûte : phrase oubliée, plus rien |
| Ranger l'enveloppe dans une colonne de `core.Backup` | Une migration Django, un champ à l'API et au schéma généré, et une raison de rouvrir `apps/api`, pour ce qui tient en soixante-seize octets devant le corps (§7) |
| Chiffrer l'export local `.json.gz` | Il ne quitte pas la machine, et c'est la seule sauvegarde de qui ne veut aucun compte serveur : la chiffrer imposerait une phrase à quelqu'un qui a choisi de n'avoir aucun secret à gérer. Le commentaire de `file.ts`, qui invoque « une clé de plus à retenir », est réécrit puisque l'argument a changé |
| Lire les blobs déposés avant ce sous-projet | Un seul utilisateur au 2026-09-22, et le VPS n'est pas en ligne. Une branche de compatibilité, son invite d'interface et ses tests, pour un unique blob que le premier dépôt remplace |
| PBKDF2 via WebCrypto | Natif et sans dépendance, mais sans coût mémoire : un GPU en essaie des milliards en parallèle, là où c'est précisément la mémoire qu'Argon2id fait payer à l'attaquant |
| Une jauge de force `@zxcvbn-ts` | Plusieurs centaines de kilo-octets de dictionnaires dans le paquet, pour un jugement consultatif que personne n'est tenu d'écouter |
| Une phrase de six mots proposée par l'application | Entropie garantie, mais on retombe sur un secret qu'on ne choisit pas, donc qu'on écrit quelque part — exactement ce que ce sous-projet supprime |
| Dériver dans un Web Worker | `argon2idAsync` et son `asyncTick` gardent déjà l'onglet vivant ; un Worker ajouterait un fichier, un protocole de messages et une difficulté de test sous jsdom, sans rien gagner |
| Exiger l'ancienne phrase pour en changer | Un rituel sans propriété de sécurité : le navigateur qui change la phrase détient déjà la clé en clair (§5) |
