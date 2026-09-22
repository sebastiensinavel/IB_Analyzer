# Sous-projet 26 — La clé enveloppée par une phrase de passe : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal :** remplacer le code de récupération de la sauvegarde chiffrée par une phrase de passe
choisie par l'utilisateur, qui enveloppe la clé AES-GCM au lieu de la remplacer.

**Architecture :** la clé aléatoire de 32 octets reste ce qui chiffre le paquet. Une phrase de
passe dérive, par Argon2id, une clé d'enveloppe qui chiffre ces 32 octets ; l'enveloppe (sel,
IV, clé enveloppée) voyage dans un en-tête devant le corps du blob. Le navigateur habituel
n'utilise jamais la phrase : il a la clé. Le serveur ne gagne ni colonne, ni endpoint, ni
migration.

**Tech Stack :** TypeScript, React 19, Dexie 4, WebCrypto, `@noble/hashes` (Argon2id), Vitest
sur `fake-indexeddb`, base-ui (shadcn).

**Spec :** `docs/specs/2026-09-22-sauvegarde-phrase-de-passe-design.md`

## Global Constraints

- **Le serveur ne voit ni la phrase, ni la clé, ni le contenu.** Aucun fichier d'`apps/api` n'est
  touché par ce plan. Aucune migration Django, aucun changement d'`openapi.json` ni de
  `apps/web/src/api/schema.d.ts`.
- **Paramètres reste atteignable sans compte** : `AppLayout` n'est pas touché.
- **Suite Argon2id de la version 2 du format** : Argon2id, `m = 65536` KiB (64 Mio), `t = 3`,
  `p = 1`, `dkLen = 32`, `asyncTick = 1`. Ces valeurs vivent **une seule fois**, dans
  `apps/web/src/db/backup/crypto.ts`.
- **Longueur minimale de la phrase : 12 caractères.** `MIN_PASSPHRASE_LENGTH` vit une seule fois,
  dans `apps/web/src/db/backup/crypto.ts`.
- **Import `@noble/hashes` avec l'extension `.js`** : `@noble/hashes/argon2.js`. Le paquet est en
  `"type": "module"` et sa carte d'exports ne porte que des clés suffixées `.js` — c'est déjà
  la forme utilisée par `packages/ib-parsers/src/hash.ts`.
- **Une valeur absente reste `null`**, jamais `0` (règle du dépôt).
- **`packages/ledger` et `packages/coverage` ne sont pas touchés.** Ce sous-projet vit
  entièrement dans `apps/web`.
- **Textes** : aucun texte visible en dur dans un composant. Toute chaîne passe par
  `apps/web/src/i18n/{fr,en}.json`, les deux fichiers mis à jour ensemble.
- **Commits en français**, sujet à l'impératif, et la case du plan cochée **dans le même
  commit** que la tâche.

## Structure des fichiers

| Fichier | Responsabilité | Tâches |
|---|---|---|
| `apps/web/package.json` | déclare `@noble/hashes` | 1 |
| `apps/web/src/db/backup/crypto.ts` | Argon2id, enveloppe, en-tête du blob. Le seul fichier qui connaît le format | 1, 2, 3, 6 |
| `apps/web/src/db/backup/crypto.test.ts` | fixe ce format | 1, 2, 3, 6 |
| `apps/web/src/db/schema.ts` | `BackupStateRecord.wrap`, Dexie 11 | 4 |
| `apps/web/src/db/schema.test.ts` | la montée 10 → 11 vide la table `backup` | 4 |
| `apps/web/src/db/backup/state.ts` | écrit, adopte et remplace l'enveloppe | 4 |
| `apps/web/src/db/backup/state.test.ts` | fixe ces trois écritures | 4 |
| `apps/web/src/db/backup/sync.ts` | pose l'en-tête au dépôt, le lit à la restauration | 5 |
| `apps/web/src/db/backup/sync.test.ts` | fixe les deux chemins d'ouverture | 5 |
| `apps/web/src/components/settings/BackupCard.tsx` | le formulaire de phrase, en ligne dans la carte | 6 |
| `apps/web/src/components/settings/BackupCard.test.tsx` | fixe l'interface | 6 |
| `apps/web/src/i18n/{fr,en}.json` | les textes | 6 |
| `apps/web/src/db/backup/file.ts` | commentaire réécrit, code inchangé | 7 |
| `docs/specs/2026-09-03-architecture-design.md` | §7.5, §10 | 7 |
| `CLAUDE.md`, `docs/points-reportes.md` | la règle et la dette | 7 |

**Rien dans `apps/api`. Rien dans `packages/`.** Si une tâche semble en avoir besoin, c'est un
signal d'arrêt : s'arrêter et demander.

---

## Task 1 : Argon2id, mesuré puis figé

**Files:**
- Modify: `apps/web/package.json` (dépendances)
- Modify: `apps/web/src/db/backup/crypto.ts`
- Test: `apps/web/src/db/backup/crypto.test.ts`

**Interfaces:**
- Consumes : rien.
- Produces : `MIN_PASSPHRASE_LENGTH: number` (12) et, **non exportée**, la fonction
  `deriveWrapKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>`.
  La tâche 2 l'utilise depuis le même fichier.

- [x] **Step 1 : ajouter la dépendance**

```bash
cd /home/seb/IA/IB_Analyzer2 && pnpm --filter web add @noble/hashes@^2.4.0
```

Vérifier que `apps/web/package.json` liste bien `"@noble/hashes": "^2.4.0"` dans
`dependencies` (pas `devDependencies` : le code part dans le paquet servi).

- [x] **Step 2 : mesurer le coût réel avant d'écrire quoi que ce soit**

Écrire ce script dans le répertoire de travail temporaire (jamais dans le dépôt) :

```js
// /tmp/argon-bench.mjs
import { argon2idAsync } from "@noble/hashes/argon2.js";

for (const m of [65536, 32768]) {
  const salt = new Uint8Array(16).fill(7);
  const started = performance.now();
  await argon2idAsync("une phrase de passe bien assez longue", salt, {
    m, t: 3, p: 1, dkLen: 32, asyncTick: 1,
  });
  console.log(`m=${m} KiB : ${Math.round(performance.now() - started)} ms`);
}
```

Le lancer depuis `apps/web`, pour que la résolution de module trouve le paquet :

```bash
cd /home/seb/IA/IB_Analyzer2/apps/web && node /tmp/argon-bench.mjs
```

**Décision à prendre sur le chiffre, pas sur une intuition** (spec §3) : si `m = 65536` tient
sous **5 000 ms**, garder 64 Mio. Sinon, retenir `m = 32768` et **corriger le spec dans le
même commit** — la ligne « Argon2id 64 Mio » du §2 et du §3, et la ligne du §10. Reporter les
deux mesures dans le message de commit.

- [x] **Step 3 : écrire le test qui échoue**

Ajouter à la fin de `apps/web/src/db/backup/crypto.test.ts` :

```ts
describe("deriveWrapKey", () => {
  it("rend la même clé pour la même phrase et le même sel", async () => {
    const salt = new Uint8Array(16).fill(3) as Uint8Array<ArrayBuffer>;
    const first = await deriveWrapKeyForTest("phrase de passe longue", salt);
    const second = await deriveWrapKeyForTest("phrase de passe longue", salt);
    expect(Array.from(first)).toEqual(Array.from(second));
    expect(first).toHaveLength(32);
  });

  it("rend une clé différente pour un autre sel", async () => {
    const one = await deriveWrapKeyForTest("phrase de passe longue", new Uint8Array(16).fill(1) as Uint8Array<ArrayBuffer>);
    const other = await deriveWrapKeyForTest("phrase de passe longue", new Uint8Array(16).fill(2) as Uint8Array<ArrayBuffer>);
    expect(Array.from(one)).not.toEqual(Array.from(other));
  });

  it("exige douze caractères", () => {
    expect(MIN_PASSPHRASE_LENGTH).toBe(12);
  });
});
```

Et compléter l'import en tête du fichier de test :

```ts
import { MIN_PASSPHRASE_LENGTH, deriveWrapKeyForTest } from "./crypto";
```

**Pourquoi un export `…ForTest`** : `deriveWrapKey` n'a aucun appelant hors de `crypto.ts`, et
l'exporter pour de bon inviterait un futur appelant à dériver ailleurs. L'alias dit ce qu'il
est. Un test qui appellerait `wrapKey` à la place mesurerait deux choses à la fois et ne
dirait plus laquelle a cassé.

- [x] **Step 4 : lancer le test, vérifier qu'il échoue**

```bash
cd /home/seb/IA/IB_Analyzer2/apps/web && npx vitest run src/db/backup/crypto.test.ts
```

Attendu : ÉCHEC, `deriveWrapKeyForTest is not exported` (ou `is not a function`).

- [x] **Step 5 : implémenter**

Dans `apps/web/src/db/backup/crypto.ts`, sous les imports existants :

```ts
import { argon2idAsync } from "@noble/hashes/argon2.js";
```

Puis, sous les constantes existantes (`KEY_BYTES`, `IV_BYTES`, `GROUP`) :

```ts
const SALT_BYTES = 16;

/**
 * Douze caractères, et rien d'autre : une règle, un test, aucune dépendance (spec §5).
 * La règle mesure la longueur et non l'entropie, donc `motdepasse123` passe — c'est assumé.
 * Le rempart contre une attaque hors ligne est Argon2id, pas un jugement sur le texte.
 */
export const MIN_PASSPHRASE_LENGTH = 12;

/**
 * La suite que l'octet de version 2 du format désigne (spec §2). Ces paramètres ne voyagent
 * **pas** dans le blob : un coût mémoire lu dans un fichier est un paramètre fourni par
 * l'attaquant, et un blob forgé annonçant quatre gigaoctets ferait tomber le navigateur qui
 * tente de le restaurer. Les changer un jour sera une version 3, que le lecteur aiguillera.
 *
 * `asyncTick` rend la main à la boucle d'événements : l'onglet reste vivant et le spinner
 * s'affiche réellement pendant les quelques secondes de dérivation. C'est ce qui dispense
 * d'un Web Worker.
 */
const ARGON2 = { m: 65536, t: 3, p: 1, dkLen: KEY_BYTES, asyncTick: 1 } as const;

async function deriveWrapKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await argon2idAsync(passphrase, salt, ARGON2));
}

/** Exporté sous ce nom pour que les tests mesurent la dérivation seule ; aucun code de
 *  production n'appelle cette fonction hors de ce fichier. */
export const deriveWrapKeyForTest = deriveWrapKey;
```

Si la mesure de l'étape 2 a imposé 32 Mio, écrire `m: 32768` **et** corriger le spec.

- [x] **Step 6 : lancer le test, vérifier qu'il passe**

```bash
cd /home/seb/IA/IB_Analyzer2/apps/web && npx vitest run src/db/backup/crypto.test.ts
```

Attendu : SUCCÈS, y compris les tests existants du fichier.

- [x] **Step 7 : commit**

```bash
cd /home/seb/IA/IB_Analyzer2 && git add apps/web/package.json pnpm-lock.yaml apps/web/src/db/backup/crypto.ts apps/web/src/db/backup/crypto.test.ts docs/plans/2026-09-22-sauvegarde-phrase-de-passe.md docs/specs/2026-09-22-sauvegarde-phrase-de-passe-design.md && git commit -m "Dérive une clé d'enveloppe par Argon2id

Mesuré avant d'être figé : <chiffres des deux mesures>."
```

---

## Task 2 : envelopper et déballer la clé

**Files:**
- Modify: `apps/web/src/db/backup/crypto.ts`
- Test: `apps/web/src/db/backup/crypto.test.ts`

**Interfaces:**
- Consumes : `deriveWrapKey`, `importKey`, `BackupKeyError` (tâche 1 et existant).
- Produces :
  - `interface BackupWrap { salt: Uint8Array<ArrayBuffer>; iv: Uint8Array<ArrayBuffer>; wrapped: Uint8Array<ArrayBuffer> }`
  - `wrapKey(key: Uint8Array<ArrayBuffer>, passphrase: string): Promise<BackupWrap>`
  - `unwrapKey(wrap: BackupWrap, passphrase: string): Promise<Uint8Array<ArrayBuffer>>`

- [ ] **Step 1 : écrire le test qui échoue**

```ts
describe("wrapKey / unwrapKey", () => {
  const PHRASE = "une phrase de passe";

  it("rend la clé d'origine", async () => {
    const key = generateBackupKey();
    const wrap = await wrapKey(key, PHRASE);
    expect(Array.from(await unwrapKey(wrap, PHRASE))).toEqual(Array.from(key));
  });

  it("refuse une phrase erronée par un BackupKeyError", async () => {
    const wrap = await wrapKey(generateBackupKey(), PHRASE);
    await expect(unwrapKey(wrap, "une autre phrase")).rejects.toBeInstanceOf(BackupKeyError);
  });

  it("tire un sel neuf à chaque enveloppe", async () => {
    const key = generateBackupKey();
    const one = await wrapKey(key, PHRASE);
    const other = await wrapKey(key, PHRASE);
    expect(Array.from(one.salt)).not.toEqual(Array.from(other.salt));
    expect(Array.from(one.wrapped)).not.toEqual(Array.from(other.wrapped));
  });

  it("enveloppe la clé en 48 octets : 32 de clé et 16 de balise", async () => {
    const wrap = await wrapKey(generateBackupKey(), PHRASE);
    expect(wrap.wrapped).toHaveLength(48);
    expect(wrap.salt).toHaveLength(16);
    expect(wrap.iv).toHaveLength(12);
  });
});
```

Compléter l'import du fichier de test avec `wrapKey`, `unwrapKey`, `generateBackupKey`,
`BackupKeyError` s'ils n'y sont pas déjà.

- [ ] **Step 2 : lancer le test, vérifier qu'il échoue**

```bash
cd /home/seb/IA/IB_Analyzer2/apps/web && npx vitest run src/db/backup/crypto.test.ts
```

Attendu : ÉCHEC, `wrapKey is not a function`.

- [ ] **Step 3 : implémenter**

Dans `crypto.ts`, après `decryptBlob` :

```ts
/** Les trois morceaux que l'en-tête du blob transporte (spec §2). */
export interface BackupWrap {
  salt: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  wrapped: Uint8Array<ArrayBuffer>;
}

/**
 * La phrase ne chiffre jamais le paquet, seulement les 32 octets de la clé qui, elle, le
 * chiffre. Changer de phrase réécrit donc 48 octets, jamais 20 Mo.
 */
export async function wrapKey(key: Uint8Array<ArrayBuffer>, passphrase: string): Promise<BackupWrap> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const wrapping = await deriveWrapKey(passphrase, salt);
  const wrapped = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(wrapping), key),
  );
  return { salt, iv, wrapped };
}

/**
 * Une phrase erronée dérive une clé d'enveloppe erronée, dont la balise d'authentification
 * d'AES-GCM échoue sur quarante-huit octets — jamais sur vingt mégaoctets. C'est tout ce qui
 * distingue une mauvaise phrase, et c'est suffisant : AES-GCM authentifie son propre chiffré.
 */
export async function unwrapKey(wrap: BackupWrap, passphrase: string): Promise<Uint8Array<ArrayBuffer>> {
  const wrapping = await deriveWrapKey(passphrase, wrap.salt);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: wrap.iv },
      await importKey(wrapping),
      wrap.wrapped,
    );
    return new Uint8Array(plain);
  } catch {
    throw new BackupKeyError("This passphrase does not open the backup");
  }
}
```

- [ ] **Step 4 : lancer le test, vérifier qu'il passe**

```bash
cd /home/seb/IA/IB_Analyzer2/apps/web && npx vitest run src/db/backup/crypto.test.ts
```

Attendu : SUCCÈS.

- [ ] **Step 5 : commit**

```bash
cd /home/seb/IA/IB_Analyzer2 && git add apps/web/src/db/backup/crypto.ts apps/web/src/db/backup/crypto.test.ts docs/plans/2026-09-22-sauvegarde-phrase-de-passe.md && git commit -m "Enveloppe la clé de sauvegarde dans une phrase de passe"
```

---

## Task 3 : l'en-tête du blob

**Files:**
- Modify: `apps/web/src/db/backup/crypto.ts`
- Test: `apps/web/src/db/backup/crypto.test.ts`

**Interfaces:**
- Consumes : `BackupWrap` (tâche 2).
- Produces :
  - `BLOB_VERSION: number` (2), `WRAP_HEADER_BYTES: number` (81)
  - `class BackupPackageError extends Error`
  - `packBlob(wrap: BackupWrap, body: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>`
  - `readHeader(blob: Uint8Array<ArrayBuffer>): { wrap: BackupWrap; body: Uint8Array<ArrayBuffer> }`

**Attention au compte d'octets.** Le spec §2 annonce 93 octets devant le chiffré : ce sont les
**81** que `packBlob` pose (`"IB2B"` 4, version 1, sel 16, IV d'enveloppe 12, clé enveloppée 48)
**plus les 12** de l'IV du corps, que `encryptBlob` écrit déjà lui-même en tête de ce qu'il
rend. `WRAP_HEADER_BYTES` vaut donc 81, jamais 93.

- [ ] **Step 1 : écrire le test qui échoue**

```ts
describe("packBlob / readHeader", () => {
  async function aWrap(): Promise<BackupWrap> {
    return wrapKey(generateBackupKey(), "une phrase de passe");
  }

  it("rend l'enveloppe et le corps intacts", async () => {
    const wrap = await aWrap();
    const body = new Uint8Array([1, 2, 3, 4, 5]) as Uint8Array<ArrayBuffer>;
    const read = readHeader(packBlob(wrap, body));
    expect(Array.from(read.wrap.salt)).toEqual(Array.from(wrap.salt));
    expect(Array.from(read.wrap.iv)).toEqual(Array.from(wrap.iv));
    expect(Array.from(read.wrap.wrapped)).toEqual(Array.from(wrap.wrapped));
    expect(Array.from(read.body)).toEqual([1, 2, 3, 4, 5]);
  });

  it("pose quatre-vingt-un octets devant le corps", async () => {
    const packed = packBlob(await aWrap(), new Uint8Array(10) as Uint8Array<ArrayBuffer>);
    expect(packed).toHaveLength(91);
    expect(WRAP_HEADER_BYTES).toBe(81);
  });

  it("refuse un paquet sans la magie", async () => {
    const packed = packBlob(await aWrap(), new Uint8Array(20) as Uint8Array<ArrayBuffer>);
    packed[0] = 0;
    expect(() => readHeader(packed)).toThrow(BackupPackageError);
  });

  it("refuse une version inconnue", async () => {
    const packed = packBlob(await aWrap(), new Uint8Array(20) as Uint8Array<ArrayBuffer>);
    packed[4] = 99;
    expect(() => readHeader(packed)).toThrow(BackupPackageError);
  });

  it("refuse un paquet trop court pour son propre en-tête", () => {
    expect(() => readHeader(new Uint8Array(40) as Uint8Array<ArrayBuffer>)).toThrow(BackupPackageError);
  });

  it("refuse un blob du sous-projet 25, qui n'a aucun en-tête", async () => {
    const legacy = await encryptBlob(generateBackupKey(), new Uint8Array([9, 9, 9]) as Uint8Array<ArrayBuffer>);
    expect(() => readHeader(legacy)).toThrow(BackupPackageError);
  });
});
```

Le dernier test est le seul qui parle encore du passé, et il dit la seule chose qu'on en dise :
un tel blob est refusé (spec §2, §10).

- [ ] **Step 2 : lancer le test, vérifier qu'il échoue**

```bash
cd /home/seb/IA/IB_Analyzer2/apps/web && npx vitest run src/db/backup/crypto.test.ts
```

Attendu : ÉCHEC, `packBlob is not a function`.

- [ ] **Step 3 : implémenter**

```ts
/** "IB2B". Un blob du sous-projet 25 n'avait aucun en-tête : il ne porte donc pas cette
 *  magie, et c'est par là qu'il est refusé (spec §10). */
const MAGIC = new Uint8Array([0x49, 0x42, 0x32, 0x42]);

/** L'octet de version nomme la suite entière : Argon2id 64 Mio/3/1, puis AES-GCM 256. */
export const BLOB_VERSION = 2;

const SALT_AT = MAGIC.length + 1;
const WRAP_IV_AT = SALT_AT + SALT_BYTES;
const WRAPPED_AT = WRAP_IV_AT + IV_BYTES;
const WRAPPED_BYTES = KEY_BYTES + 16;

/** 81 octets. Les 93 du spec §2 les comptent avec l'IV du corps, qu'`encryptBlob` écrit lui-même. */
export const WRAP_HEADER_BYTES = WRAPPED_AT + WRAPPED_BYTES;

/**
 * Un paquet que cette version ne sait pas lire — magie absente, version inconnue, trop court.
 * Distinct de `BackupKeyError` : dire « phrase de passe invalide » devant un blob corrompu
 * enverrait l'utilisateur retaper indéfiniment une phrase qui n'est pas en cause.
 */
export class BackupPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupPackageError";
  }
}

export function packBlob(wrap: BackupWrap, body: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(WRAP_HEADER_BYTES + body.byteLength);
  out.set(MAGIC, 0);
  out[MAGIC.length] = BLOB_VERSION;
  out.set(wrap.salt, SALT_AT);
  out.set(wrap.iv, WRAP_IV_AT);
  out.set(wrap.wrapped, WRAPPED_AT);
  out.set(body, WRAP_HEADER_BYTES);
  return out;
}

export function readHeader(blob: Uint8Array<ArrayBuffer>): { wrap: BackupWrap; body: Uint8Array<ArrayBuffer> } {
  if (blob.byteLength <= WRAP_HEADER_BYTES + IV_BYTES) {
    throw new BackupPackageError("Backup package too short to carry a header");
  }
  if (!MAGIC.every((byte, index) => blob[index] === byte)) {
    throw new BackupPackageError("Not a backup package");
  }
  if (blob[MAGIC.length] !== BLOB_VERSION) {
    throw new BackupPackageError(`Unsupported backup package version: ${String(blob[MAGIC.length])}`);
  }
  // `slice`, jamais `subarray` : une vue garderait vivant le tampon des vingt mégaoctets
  // entiers pour quarante-huit octets de clé, et rendrait `Uint8Array<ArrayBufferLike>`
  // là où WebCrypto veut `Uint8Array<ArrayBuffer>`.
  return {
    wrap: {
      salt: blob.slice(SALT_AT, WRAP_IV_AT),
      iv: blob.slice(WRAP_IV_AT, WRAPPED_AT),
      wrapped: blob.slice(WRAPPED_AT, WRAP_HEADER_BYTES),
    },
    body: blob.slice(WRAP_HEADER_BYTES),
  };
}
```

- [ ] **Step 4 : lancer le test, vérifier qu'il passe**

```bash
cd /home/seb/IA/IB_Analyzer2/apps/web && npx vitest run src/db/backup/crypto.test.ts
```

Attendu : SUCCÈS.

- [ ] **Step 5 : commit**

```bash
cd /home/seb/IA/IB_Analyzer2 && git add apps/web/src/db/backup/crypto.ts apps/web/src/db/backup/crypto.test.ts docs/plans/2026-09-22-sauvegarde-phrase-de-passe.md && git commit -m "Pose l'enveloppe dans un en-tête devant le corps du blob"
```

---

## Task 4 : l'enveloppe en base, et la montée Dexie qui l'impose

**Files:**
- Modify: `apps/web/src/db/schema.ts` (interface `BackupStateRecord`, constructeur)
- Modify: `apps/web/src/db/backup/state.ts`
- Test: `apps/web/src/db/schema.test.ts`, `apps/web/src/db/backup/state.test.ts`

**Interfaces:**
- Consumes : `BackupWrap`, `wrapKey` (tâches 2).
- Produces :
  - `BackupStateRecord.wrap: BackupWrap` — **champ obligatoire**
  - `enableBackup(db: AppDatabase, passphrase: string): Promise<BackupStateRecord>`
  - `adoptBackupKey(db: AppDatabase, key: Uint8Array<ArrayBuffer>, wrap: BackupWrap): Promise<BackupStateRecord>`
  - `rewrapBackupKey(db: AppDatabase, passphrase: string): Promise<BackupStateRecord>`

- [ ] **Step 1 : écrire les tests qui échouent**

Dans `apps/web/src/db/schema.test.ts`, à la suite des cas existants :

```ts
it("vide la table backup en montant de 10 à 11, sans toucher au reste", async () => {
  const name = `upgrade-backup-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old.version(10).stores({ backup: "id", accounts: "id" });
  await old.open();
  await old.table("backup").put({ id: "local", enabled: true, key: new Uint8Array(32) });
  await old.table("accounts").put({
    id: "beta",
    label: "Beta",
    ibAccountId: "U1234567",
    createdAt: "2026-09-01T00:00:00.000Z",
    warnedDroppedKinds: [],
  });
  old.close();

  const upgraded = new AppDatabase(name);
  await upgraded.open();
  expect(await upgraded.backup.toArray()).toEqual([]);
  // La ligne du compte prouve que la montée vise `backup` et ne balaye pas la base : sans
  // elle, une migration qui détruirait tout passerait ce test.
  expect(await upgraded.accounts.count()).toBe(1);
  upgraded.close();
});
```

`Dexie` s'importe déjà en tête de `schema.test.ts`. Le fichier construit ses bases héritées
par une classe `LegacyDatabase` ; ici un `Dexie` nu suffit, parce que la seule chose qui
compte est qu'une base réelle existe en version 10 avec une ligne dans `backup`.

Dans `apps/web/src/db/backup/state.test.ts` :

```ts
it("écrit une enveloppe à l'activation", async () => {
  const row = await enableBackup(db, "une phrase de passe");
  expect(row.wrap.salt).toHaveLength(16);
  expect(Array.from(await unwrapKey(row.wrap, "une phrase de passe"))).toEqual(Array.from(row.key));
});

it("garde la clé quand on réactive, et réenveloppe avec la phrase donnée", async () => {
  const first = await enableBackup(db, "première phrase");
  await disableBackup(db);
  const second = await enableBackup(db, "deuxième phrase");
  expect(Array.from(second.key)).toEqual(Array.from(first.key));
  expect(Array.from(await unwrapKey(second.wrap, "deuxième phrase"))).toEqual(Array.from(first.key));
});

it("adopte la clé et l'enveloppe ensemble", async () => {
  const key = generateBackupKey();
  const wrap = await wrapKey(key, "phrase adoptée");
  const row = await adoptBackupKey(db, key, wrap);
  expect(row.enabled).toBe(true);
  expect(Array.from(row.key)).toEqual(Array.from(key));
  expect(Array.from(row.wrap.wrapped)).toEqual(Array.from(wrap.wrapped));
});

it("réenveloppe sans toucher à la clé", async () => {
  const before = await enableBackup(db, "ancienne phrase");
  const after = await rewrapBackupKey(db, "nouvelle phrase longue");
  expect(Array.from(after.key)).toEqual(Array.from(before.key));
  expect(Array.from(await unwrapKey(after.wrap, "nouvelle phrase longue"))).toEqual(Array.from(before.key));
  await expect(unwrapKey(after.wrap, "ancienne phrase")).rejects.toBeInstanceOf(BackupKeyError);
});

it("refuse de réenvelopper quand rien n'est activé", async () => {
  await expect(rewrapBackupKey(db, "une phrase de passe")).rejects.toBeInstanceOf(BackupKeyError);
});
```

**Tous les `enableBackup(db)` déjà présents dans `state.test.ts` prennent maintenant une
phrase** : les compléter par `"une phrase de passe"`, et ajouter `{ timeout: 20_000 }` en
troisième argument de chaque `it` qui active — Argon2id rend ces cas lents.

- [ ] **Step 2 : lancer les tests, vérifier qu'ils échouent**

```bash
cd /home/seb/IA/IB_Analyzer2/apps/web && npx vitest run src/db/schema.test.ts src/db/backup/state.test.ts
```

Attendu : ÉCHEC — `enableBackup` attend un argument de moins, `rewrapBackupKey` n'existe pas,
la table `backup` n'est pas vidée.

- [ ] **Step 3 : implémenter le schéma**

Dans `apps/web/src/db/schema.ts`, remplacer le commentaire de `key` et ajouter `wrap` :

```ts
  /**
   * Raw AES-GCM 256 bytes, never sent to the server and never shown to the user: the
   * recovery code that used to display them is gone (sub-project 26).
   *
   * `Uint8Array<ArrayBuffer>`, not the default `Uint8Array<ArrayBufferLike>`: WebCrypto's
   * `BufferSource` excludes a `SharedArrayBuffer`-backed view, so the wider type would need a
   * cast at every call into `crypto.subtle`.
   */
  key: Uint8Array<ArrayBuffer>;
  /**
   * The key, wrapped by a passphrase-derived key, copied into the header of every deposit.
   *
   * Required, never optional: the type then carries the guarantee that an interface hint
   * would only have stated — an active backup always has an envelope, and no in-between
   * state exists where the key sits there without one.
   */
  wrap: BackupWrap;
```

Et importer le type en tête du fichier :

```ts
import type { BackupWrap } from "./backup/crypto";
```

Puis, à la fin du constructeur, après la version 10 :

```ts
    // The recovery code is gone (sub-project 26): a row written before it carries a key with
    // no envelope, a state the type no longer admits. Clearing the table returns the browser
    // to "server backup disabled", which the Settings card already states in full — the user
    // re-enables it by choosing a passphrase, and the first deposit replaces the server's
    // only blob. Dexie inherits the schema of the previous version, so no `.stores()` here.
    this.version(11).upgrade((tx) => tx.table("backup").clear());
```

- [ ] **Step 4 : implémenter les écritures**

Dans `apps/web/src/db/backup/state.ts`, remplacer `enableBackup` et `adoptBackupKey`, et
ajouter `rewrapBackupKey` :

```ts
import { BackupKeyError, generateBackupKey, wrapKey, type BackupWrap } from "./crypto";

/**
 * Off by default (architecture spec §7.5): a user who wants nothing on the server has
 * nothing to do. Enabling twice keeps the first key — regenerating it would strand the blob
 * already deposited — but always re-wraps with the passphrase just typed, which is the one
 * the user means to use from now on.
 */
export async function enableBackup(db: AppDatabase, passphrase: string): Promise<BackupStateRecord> {
  const existing = await readBackupState(db);
  const key = existing?.key ?? generateBackupKey();
  const row: BackupStateRecord = {
    id: ROW_ID,
    enabled: true,
    key,
    wrap: await wrapKey(key, passphrase),
    lastBackupAt: existing?.lastBackupAt ?? null,
    lastBackupBytes: existing?.lastBackupBytes ?? null,
    lastBackupError: existing?.lastBackupError ?? null,
  };
  await db.backup.put(row);
  return row;
}

/** Restoring on a new device: the key the passphrase opened, and the envelope it came in,
 *  replace this browser's — the two together, because the key alone is no longer a
 *  representable state. */
export async function adoptBackupKey(
  db: AppDatabase,
  key: Uint8Array<ArrayBuffer>,
  wrap: BackupWrap,
): Promise<BackupStateRecord> {
  const existing = await readBackupState(db);
  const row: BackupStateRecord = {
    id: ROW_ID,
    enabled: true,
    key,
    wrap,
    lastBackupAt: existing?.lastBackupAt ?? null,
    lastBackupBytes: existing?.lastBackupBytes ?? null,
    lastBackupError: existing?.lastBackupError ?? null,
  };
  await db.backup.put(row);
  return row;
}

/**
 * Changing the passphrase re-wraps the key this browser already holds in the clear; it never
 * unlocks anything, so the old passphrase is not asked for — requiring it would be a ritual
 * with no security property, on a device that already has everything (spec §5).
 *
 * The server still carries the old envelope until the deposit this triggers lands, so the old
 * passphrase still opens the backup until then. The card says so.
 */
export async function rewrapBackupKey(db: AppDatabase, passphrase: string): Promise<BackupStateRecord> {
  const existing = await readBackupState(db);
  if (!existing) throw new BackupKeyError("No backup key to re-wrap");
  const row: BackupStateRecord = { ...existing, wrap: await wrapKey(existing.key, passphrase) };
  await db.backup.put(row);
  return row;
}
```

- [ ] **Step 5 : lancer les tests, vérifier qu'ils passent**

```bash
cd /home/seb/IA/IB_Analyzer2/apps/web && npx vitest run src/db/schema.test.ts src/db/backup/state.test.ts
```

Attendu : SUCCÈS. Les appelants de `enableBackup`/`adoptBackupKey` dans `BackupCard.tsx` ne
compilent plus — c'est attendu, la tâche 6 les reprend. Ne pas les « réparer » ici en passant
une phrase bidon.

- [ ] **Step 6 : commit**

```bash
cd /home/seb/IA/IB_Analyzer2 && git add apps/web/src/db/schema.ts apps/web/src/db/schema.test.ts apps/web/src/db/backup/state.ts apps/web/src/db/backup/state.test.ts docs/plans/2026-09-22-sauvegarde-phrase-de-passe.md && git commit -m "Rend l'enveloppe obligatoire et vide la table backup en Dexie 11"
```

---

## Task 5 : le dépôt porte l'en-tête, la restauration le lit

**Files:**
- Modify: `apps/web/src/db/backup/sync.ts`
- Test: `apps/web/src/db/backup/sync.test.ts`

**Interfaces:**
- Consumes : `packBlob`, `readHeader`, `unwrapKey`, `BackupPackageError` (tâches 2, 3) ;
  `adoptBackupKey` n'est **pas** appelé ici — la carte adopte (tâche 6).
- Produces :
  - `type BackupOpener = { key: Uint8Array<ArrayBuffer> } | { passphrase: string }`
  - `pullBackup(db: AppDatabase, opener: BackupOpener): Promise<BackupResult<{ key: Uint8Array<ArrayBuffer>; wrap: BackupWrap }>>`
  - `pushBackup` garde sa signature.

- [ ] **Step 1 : écrire les tests qui échouent**

Le fichier moque `globalThis.fetch` par `vi.spyOn`, jamais le module `@/api/backup` : garder
cette forme. Ce petit serveur en mémoire sert les cinq cas ci-dessous.

```ts
/** Le serveur en un objet : il retient le dernier dépôt et le ressert au téléchargement. */
function serveBackup(initial: Uint8Array | null = null) {
  const held = { blob: initial };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const method = (init as RequestInit | undefined)?.method ?? "GET";
    if (method === "POST") {
      held.blob = new Uint8Array((init as RequestInit).body as ArrayBuffer);
      return new Response(
        JSON.stringify({ present: true, updatedAt: "2026-09-22T10:00:00Z", bytes: held.blob.byteLength }),
        { status: 200 },
      );
    }
    if (held.blob === null) return new Response(null, { status: 404 });
    return new Response(held.blob as BodyInit, { status: 200 });
  });
  return held;
}

it("dépose un blob qui porte l'en-tête", async () => {
  await enableBackup(db, "une phrase de passe");
  const held = serveBackup();
  await pushBackup(db);
  expect(() => readHeader(held.blob as Uint8Array<ArrayBuffer>)).not.toThrow();
});

it("ouvre par la clé locale, sans toucher à la phrase", async () => {
  const row = await enableBackup(db, "une phrase de passe");
  serveBackup();
  await pushBackup(db);
  const result = await pullBackup(db, { key: row.key });
  expect(result.ok).toBe(true);
});

it("ouvre par la phrase sur un navigateur qui n'a pas la clé", async () => {
  const row = await enableBackup(db, "une phrase de passe");
  serveBackup();
  await pushBackup(db);
  await db.backup.clear();
  const result = await pullBackup(db, { passphrase: "une phrase de passe" });
  expect(result.ok).toBe(true);
  if (result.ok) expect(Array.from(result.value.key)).toEqual(Array.from(row.key));
});

it("refuse une phrase erronée par un BackupKeyError et n'écrit rien", async () => {
  await enableBackup(db, "une phrase de passe");
  serveBackup();
  await pushBackup(db);
  await db.backup.clear();
  await db.accounts.clear();
  await expect(pullBackup(db, { passphrase: "mauvaise phrase" })).rejects.toBeInstanceOf(BackupKeyError);
  expect(await db.accounts.count()).toBe(0);
});

it("refuse un paquet sans en-tête par un BackupPackageError", async () => {
  serveBackup(await encryptBlob(generateBackupKey(), new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer>));
  await expect(pullBackup(db, { passphrase: "une phrase de passe" })).rejects.toBeInstanceOf(BackupPackageError);
});
```

**Tous les `enableBackup(db)` déjà présents dans ce fichier prennent maintenant une phrase** :
les compléter par `"une phrase de passe"`. Argon2id rend ces cas lents — ajouter
`{ timeout: 20_000 }` en troisième argument de chaque `it` du fichier qui active la sauvegarde.

- [ ] **Step 2 : lancer les tests, vérifier qu'ils échouent**

```bash
cd /home/seb/IA/IB_Analyzer2/apps/web && npx vitest run src/db/backup/sync.test.ts
```

Attendu : ÉCHEC — `pullBackup` prend encore une clé nue.

- [ ] **Step 3 : implémenter**

Dans `sync.ts`, la ligne du dépôt devient :

```ts
    const body = await encryptBlob(state.key, await gzip(encodePayload(await buildPayload(db))));
    const result = await putBackup(packBlob(state.wrap, body));
```

Et `pullBackup` :

```ts
/** Ce avec quoi on ouvre : la clé que ce navigateur détient déjà, ou la phrase qu'on vient
 *  de taper sur un navigateur neuf. Jamais les deux. */
export type BackupOpener = { key: Uint8Array<ArrayBuffer> } | { passphrase: string };

/**
 * Une phrase — ou une clé — qui n'ouvre pas le blob remonte en `BackupKeyError`, jamais en
 * échec générique : AES-GCM authentifie son propre chiffré, donc un rejet de `decrypt` veut
 * dire exactement une chose. Un paquet que cette version ne sait pas lire remonte en
 * `BackupPackageError`, qui est une autre chose : l'appelant doit pouvoir dire « retapez
 * votre phrase » sans le dire devant un blob corrompu.
 *
 * Rend la clé et l'enveloppe dont le paquet s'est ouvert, pour que l'appelant les adopte —
 * et seulement après que la restauration a réussi.
 */
export async function pullBackup(
  db: AppDatabase,
  opener: BackupOpener,
): Promise<BackupResult<{ key: Uint8Array<ArrayBuffer>; wrap: BackupWrap }>> {
  const blob = await getBackup();
  if (!blob.ok) return blob;
  const { wrap, body } = readHeader(blob.value);
  const key = "key" in opener ? opener.key : await unwrapKey(wrap, opener.passphrase);
  let plain: Uint8Array<ArrayBuffer>;
  try {
    plain = await decryptBlob(key, body);
  } catch (error) {
    throw error instanceof BackupKeyError ? error : new BackupKeyError("This key does not open the backup");
  }
  const payload = decodePayload(await gunzip(plain));
  await suppressBackupTrigger(() => restorePayload(db, payload));
  return { ok: true, value: { key, wrap } };
}
```

Compléter les imports de `sync.ts` : `packBlob`, `readHeader`, `unwrapKey`, `type BackupWrap`.

- [ ] **Step 4 : lancer les tests, vérifier qu'ils passent**

```bash
cd /home/seb/IA/IB_Analyzer2/apps/web && npx vitest run src/db/backup/sync.test.ts
```

Attendu : SUCCÈS.

- [ ] **Step 5 : commit**

```bash
cd /home/seb/IA/IB_Analyzer2 && git add apps/web/src/db/backup/sync.ts apps/web/src/db/backup/sync.test.ts docs/plans/2026-09-22-sauvegarde-phrase-de-passe.md && git commit -m "Dépose l'en-tête et ouvre le blob par la clé ou par la phrase"
```

---

## Task 6 : le formulaire de phrase, et le retrait du code de récupération

**Files:**
- Modify: `apps/web/src/components/settings/BackupCard.tsx`
- Modify: `apps/web/src/db/backup/crypto.ts` (retrait de `toRecoveryCode`/`fromRecoveryCode`)
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Test: `apps/web/src/components/settings/BackupCard.test.tsx`, `apps/web/src/db/backup/crypto.test.ts`

**Interfaces:**
- Consumes : `MIN_PASSPHRASE_LENGTH`, `BackupPackageError`, `BackupKeyError` (tâches 1, 3) ;
  `enableBackup(db, phrase)`, `adoptBackupKey(db, clé, enveloppe)`, `rewrapBackupKey(db, phrase)`
  (tâche 4) ; `pullBackup(db, opener)` (tâche 5).
- Produces : rien que d'autres tâches consomment.

**Pas de boîte de dialogue.** `packages/ui` n'a pas de `dialog.tsx`, et en ajouter un
imposerait `pnpm dlx shadcn add` puis la réécriture des imports `@/` en relatifs
(`packages/ui/README.md`). Le formulaire est **en ligne dans la carte**, à la place qu'occupait
l'encadré du code de récupération. `window.prompt` ne convient plus : il ne sait ni masquer la
saisie, ni en demander deux.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
it("demande la phrase deux fois à l'activation", async () => {
  renderCard({ authenticated: true });
  await userEvent.click(screen.getByRole("button", { name: "Activer la sauvegarde serveur" }));
  expect(screen.getByLabelText("Phrase de passe")).toBeInTheDocument();
  expect(screen.getByLabelText("Confirmez la phrase de passe")).toBeInTheDocument();
});

it("refuse une confirmation qui diffère", async () => {
  renderCard({ authenticated: true });
  await userEvent.click(screen.getByRole("button", { name: "Activer la sauvegarde serveur" }));
  await userEvent.type(screen.getByLabelText("Phrase de passe"), "une phrase de passe");
  await userEvent.type(screen.getByLabelText("Confirmez la phrase de passe"), "une autre phrase");
  await userEvent.click(screen.getByRole("button", { name: "Valider" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Les deux phrases ne correspondent pas.");
  expect(await db.backup.count()).toBe(0);
});

it("refuse une phrase de moins de douze caractères", async () => {
  renderCard({ authenticated: true });
  await userEvent.click(screen.getByRole("button", { name: "Activer la sauvegarde serveur" }));
  await userEvent.type(screen.getByLabelText("Phrase de passe"), "court");
  await userEvent.type(screen.getByLabelText("Confirmez la phrase de passe"), "court");
  await userEvent.click(screen.getByRole("button", { name: "Valider" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("au moins 12 caractères");
  expect(await db.backup.count()).toBe(0);
});

it("active et n'affiche plus aucun code de récupération", async () => {
  renderCard({ authenticated: true });
  await userEvent.click(screen.getByRole("button", { name: "Activer la sauvegarde serveur" }));
  await userEvent.type(screen.getByLabelText("Phrase de passe"), "une phrase de passe");
  await userEvent.type(screen.getByLabelText("Confirmez la phrase de passe"), "une phrase de passe");
  await userEvent.click(screen.getByRole("button", { name: "Valider" }));
  await waitFor(async () => expect(await db.backup.count()).toBe(1));
  expect(screen.queryByText(/code de récupération/i)).not.toBeInTheDocument();
});

it("ne demande rien pour restaurer sur un navigateur qui a la clé", async () => {
  await enableBackup(db, "une phrase de passe");
  renderCard({ authenticated: true });
  await userEvent.click(screen.getByRole("button", { name: "Restaurer" }));
  await waitFor(() => expect(screen.queryByLabelText("Phrase de passe de la sauvegarde")).not.toBeInTheDocument());
});

it("demande la phrase pour restaurer sur un navigateur qui n'a pas la clé", async () => {
  renderCard({ authenticated: true });
  await userEvent.click(screen.getByRole("button", { name: "Restaurer" }));
  expect(await screen.findByLabelText("Phrase de passe de la sauvegarde")).toBeInTheDocument();
});

it("change la phrase sans changer la clé", async () => {
  const before = await enableBackup(db, "ancienne phrase");
  renderCard({ authenticated: true });
  await userEvent.click(screen.getByRole("button", { name: "Changer la phrase de passe" }));
  await userEvent.type(screen.getByLabelText("Phrase de passe"), "nouvelle phrase longue");
  await userEvent.type(screen.getByLabelText("Confirmez la phrase de passe"), "nouvelle phrase longue");
  await userEvent.click(screen.getByRole("button", { name: "Valider" }));
  await waitFor(async () => {
    const row = await readBackupState(db);
    expect(Array.from(row!.wrap.wrapped)).not.toEqual(Array.from(before.wrap.wrapped));
    expect(Array.from(row!.key)).toEqual(Array.from(before.key));
  });
});
```

**Reprendre le harnais `renderCard` et les moquages de `@/api/backup` déjà présents dans
`BackupCard.test.tsx`** — lire le fichier avant d'écrire, ne pas inventer un second harnais.
Les tests d'Argon2id sont lents : ajouter `{ timeout: 20_000 }` en troisième argument de chaque
`it` qui active, change ou restaure par phrase.

Supprimer aussi de `crypto.test.ts` les cas de `toRecoveryCode`/`fromRecoveryCode`.

- [ ] **Step 2 : lancer les tests, vérifier qu'ils échouent**

```bash
cd /home/seb/IA/IB_Analyzer2/apps/web && npx vitest run src/components/settings/BackupCard.test.tsx
```

Attendu : ÉCHEC — aucun champ « Phrase de passe » n'existe.

- [ ] **Step 3 : les textes**

Dans `apps/web/src/i18n/fr.json`, **supprimer** `backupRecoveryHint`, `backupRecoveryPrompt`
et `backupInvalidCode`, puis ajouter, au même endroit dans le bloc `settings` :

```json
    "backupPassphrase": "Phrase de passe",
    "backupPassphraseConfirm": "Confirmez la phrase de passe",
    "backupPassphrasePrompt": "Phrase de passe de la sauvegarde",
    "backupPassphraseHint": "Choisissez une phrase d'au moins 12 caractères. Elle chiffre la clé de votre sauvegarde avant qu'elle ne quitte ce navigateur : nous ne pouvons pas la retrouver, et oubliée, la sauvegarde est définitivement illisible.",
    "backupPassphraseTooShort": "La phrase de passe doit faire au moins 12 caractères.",
    "backupPassphraseMismatch": "Les deux phrases ne correspondent pas.",
    "backupInvalidPassphrase": "Cette phrase de passe n'ouvre pas la sauvegarde.",
    "backupUnreadablePackage": "La sauvegarde déposée sur le serveur n'est pas lisible par cette version de l'application.",
    "backupChangePassphrase": "Changer la phrase de passe",
    "backupChangePending": "La nouvelle phrase ne prendra effet qu'au prochain dépôt ; d'ici là, l'ancienne ouvre encore la sauvegarde.",
    "backupDeriving": "Chiffrement de la clé…",
    "backupConfirm": "Valider",
    "backupCancel": "Annuler",
```

Dans `apps/web/src/i18n/en.json`, aux mêmes clés :

```json
    "backupPassphrase": "Passphrase",
    "backupPassphraseConfirm": "Confirm the passphrase",
    "backupPassphrasePrompt": "Backup passphrase",
    "backupPassphraseHint": "Choose a phrase of at least 12 characters. It encrypts your backup key before it ever leaves this browser: we cannot recover it, and if you forget it the backup is unreadable for good.",
    "backupPassphraseTooShort": "The passphrase must be at least 12 characters long.",
    "backupPassphraseMismatch": "The two phrases do not match.",
    "backupInvalidPassphrase": "This passphrase does not open the backup.",
    "backupUnreadablePackage": "The backup deposited on the server cannot be read by this version of the application.",
    "backupChangePassphrase": "Change the passphrase",
    "backupChangePending": "The new phrase takes effect at the next deposit; until then, the old one still opens the backup.",
    "backupDeriving": "Encrypting the key…",
    "backupConfirm": "Confirm",
    "backupCancel": "Cancel",
```

La parité des clés entre les deux fichiers n'est vérifiée par aucun test (dette du sous-projet
27) : la relire à la main, clé par clé.

- [ ] **Step 4 : implémenter la carte**

Retirer de `crypto.ts` les fonctions `toRecoveryCode`, `fromRecoveryCode`, la constante `GROUP`,
la fonction `base64url` et le long commentaire sur le point comme séparateur.

Dans `BackupCard.tsx`, les imports à ajuster : retirer `fromRecoveryCode` et `toRecoveryCode`,
ajouter `BackupPackageError` et `MIN_PASSPHRASE_LENGTH` depuis `@/db/backup/crypto`,
`rewrapBackupKey` depuis `@/db/backup/state`, `type BackupOpener` depuis `@/db/backup/sync`, et
`Input` depuis `@ib/ui/input`.

```tsx
type FormMode = "enable" | "restore" | "change";

const [form, setForm] = useState<{ mode: FormMode; passphrase: string; confirm: string } | null>(null);
```

Retirer `recoveryCode`, son `useState` et son encadré de rendu. Remplacer `restoreFailureMessage`
par :

```tsx
  function restoreFailureMessage(error: unknown): string {
    if (error instanceof BackupKeyError) return t("settings.backupInvalidPassphrase");
    if (error instanceof BackupPackageError) return t("settings.backupUnreadablePackage");
    if (error instanceof BackupSchemaError) return t("settings.backupTooNew");
    return t("settings.actionFailed");
  }
```

Le cœur du formulaire :

```tsx
  /** La validation vit ici et pas dans `state.ts` : c'est une règle d'interface, et le moteur
   *  n'a pas à connaître de texte visible. */
  function passphraseProblem(mode: FormMode, passphrase: string, confirm: string): string | null {
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) return t("settings.backupPassphraseTooShort");
    if (mode !== "restore" && passphrase !== confirm) return t("settings.backupPassphraseMismatch");
    return null;
  }

  async function handleSubmitForm() {
    if (!form) return;
    const problem = passphraseProblem(form.mode, form.passphrase, form.confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (form.mode === "enable") await enableBackup(db, form.passphrase);
      else if (form.mode === "change") await rewrapBackupKey(db, form.passphrase);
      else await runRestore({ passphrase: form.passphrase });
      setForm(null);
    } catch (error) {
      setError(restoreFailureMessage(error));
    } finally {
      setBusy(false);
    }
  }
```

`handleEnable` devient `() => setForm({ mode: "enable", passphrase: "", confirm: "" })`, et un
bouton « Changer la phrase de passe », visible quand `enabled`, ouvre le mode `change`.

`handleRestore` se scinde : le bouton décide quel chemin ouvrir, `runRestore` fait le travail.

```tsx
  /** Le navigateur habituel a la clé : rien n'est demandé (spec §5). Un navigateur neuf n'a
   *  que la phrase, et le formulaire s'ouvre avant toute question au serveur. */
  async function handleRestore() {
    const current = await readBackupState(db);
    if (current) await runRestore({ key: current.key });
    else setForm({ mode: "restore", passphrase: "", confirm: "" });
  }

  /**
   * La clé et l'enveloppe ne sont adoptées qu'une fois la restauration réussie. Les écrire
   * d'abord armerait ce navigateur d'une clé qui peut n'être pas la bonne, et la prochaine
   * écriture rechiffrerait toute la base sous elle, remplaçant l'unique copie du serveur par
   * un blob que plus personne n'ouvre.
   */
  async function runRestore(opener: BackupOpener) {
    setBusy(true);
    setError(null);
    try {
      const status = await fetchBackupStatus();
      if (!status.ok) {
        setError(failureMessage(status.kind));
        return;
      }
      if (!status.value.present) {
        setError(failureMessage("missing"));
        return;
      }
      const date = status.value.updatedAt ? formatDateTime(status.value.updatedAt) : "—";
      if (!window.confirm(t("settings.backupRestoreConfirm", { date }))) return;
      const result = await pullBackup(db, opener);
      if (!result.ok) {
        setError(failureMessage(result.kind));
        return;
      }
      if (!("key" in opener)) await adoptBackupKey(db, result.value.key, result.value.wrap);
    } finally {
      setBusy(false);
    }
  }
```

`runRestore` ne rattrape pas : l'appelant le fait — `handleSubmitForm` par son `catch`, et
`handleRestore` doit en gagner un identique pour le chemin par clé.

Le rendu du formulaire, à la place de l'ancien encadré du code :

```tsx
        {form && (
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <label className="text-xs text-muted-foreground" htmlFor="backup-passphrase">
              {form.mode === "restore" ? t("settings.backupPassphrasePrompt") : t("settings.backupPassphrase")}
            </label>
            <Input
              id="backup-passphrase"
              type="password"
              autoComplete="new-password"
              value={form.passphrase}
              onChange={(event) => setForm({ ...form, passphrase: event.target.value })}
            />
            {form.mode !== "restore" && (
              <>
                <label className="text-xs text-muted-foreground" htmlFor="backup-passphrase-confirm">
                  {t("settings.backupPassphraseConfirm")}
                </label>
                <Input
                  id="backup-passphrase-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={form.confirm}
                  onChange={(event) => setForm({ ...form, confirm: event.target.value })}
                />
              </>
            )}
            <p className="text-xs text-muted-foreground">{t("settings.backupPassphraseHint")}</p>
            {form.mode === "change" && (
              <p className="text-xs text-muted-foreground">{t("settings.backupChangePending")}</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => void handleSubmitForm()} disabled={busy}>
                {busy ? t("settings.backupDeriving") : t("settings.backupConfirm")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setForm(null)} disabled={busy}>
                {t("settings.backupCancel")}
              </Button>
            </div>
          </div>
        )}
```

`Input` s'importe de `@ib/ui/input`. Le `<label htmlFor>` est ce que `getByLabelText` des tests
lit ; sans lui, les tests ne trouvent rien.

- [ ] **Step 5 : lancer les tests, vérifier qu'ils passent**

```bash
cd /home/seb/IA/IB_Analyzer2/apps/web && npx vitest run src/components/settings/BackupCard.test.tsx src/db/backup/crypto.test.ts src/pages/SettingsPage.test.tsx
```

Attendu : SUCCÈS. `SettingsPage.test.tsx` référence peut-être le code de récupération : le
corriger ici, c'est le même retrait.

- [ ] **Step 6 : commit**

```bash
cd /home/seb/IA/IB_Analyzer2 && git add apps/web/src/components/settings/BackupCard.tsx apps/web/src/components/settings/BackupCard.test.tsx apps/web/src/db/backup/crypto.ts apps/web/src/db/backup/crypto.test.ts apps/web/src/i18n/fr.json apps/web/src/i18n/en.json apps/web/src/pages/SettingsPage.test.tsx docs/plans/2026-09-22-sauvegarde-phrase-de-passe.md && git commit -m "Demande une phrase de passe et retire le code de récupération"
```

---

## Task 7 : l'écrit, et la vérification complète

**Files:**
- Modify: `apps/web/src/db/backup/file.ts` (commentaire seul)
- Modify: `docs/specs/2026-09-03-architecture-design.md` (§7.5, §10)
- Modify: `CLAUDE.md`
- Modify: `docs/points-reportes.md`

**Interfaces:** aucune.

- [ ] **Step 1 : le commentaire de `file.ts`**

Son argument — « une clé de plus à retenir en ferait une sauvegarde que personne ne peut
relire » — a changé de sens maintenant qu'une phrase existe. Le remplacer par :

```ts
/**
 * The local file is the backup of whoever never creates a Django account — the first
 * requirement of sub-project 25. It is not encrypted, and deliberately stays that way
 * (sub-project 26, spec §10): it never leaves the machine, and encrypting it would impose a
 * passphrase on exactly the person who chose to have no secret to manage. It does carry the
 * Flex token, since it carries the account records; the Settings card says so.
 */
```

- [ ] **Step 2 : le §7.5 de l'architecture**

Remplacer les trois puces du bloc « Côté navigateur » par :

```markdown
- **Clé AES-GCM 256 générée par WebCrypto** au premier envoi, stockée en IndexedDB.
- **Enveloppée par une phrase de passe** que l'utilisateur choisit : Argon2id dérive une clé
  d'enveloppe, et l'enveloppe voyage dans l'en-tête du blob. Le serveur ne voit ni la phrase,
  ni la clé. Il n'y a rien à conserver ; une phrase oubliée rend la sauvegarde illisible
  (sous-projet 26).
- Restaurer sur un autre appareil demande cette phrase, une fois par appareil. Sur l'appareil
  habituel, rien n'est jamais demandé.
```

Et dans le tableau du §10, la ligne du blob : « personne sans le code de récupération » devient
« personne sans la phrase de passe ». Le paragraphe qui suit ce tableau nomme lui aussi le code
de récupération : le réécrire en « le seul secret supplémentaire est la phrase de passe de la
sauvegarde, demandée uniquement pour restaurer sur un nouvel appareil ».

**Le §13 n'est pas touché.** Sa ligne « Clé de sauvegarde dérivée du mot de passe » reste vraie :
ce sous-projet n'utilise pas le mot de passe du compte.

- [ ] **Step 3 : la puce de `CLAUDE.md`**

Remplacer la puce « La sauvegarde est un blob opaque, opt-in » par :

```markdown
- **La sauvegarde est un blob opaque, opt-in** : `core.Backup` ne stocke que des octets
  chiffrés par le navigateur (AES-GCM 256), leur taille et leur date, plafonnés à 20 Mo. La
  clé vit en IndexedDB et **voyage enveloppée dans l'en-tête du blob** : une phrase de passe
  d'au moins `MIN_PASSPHRASE_LENGTH` caractères dérive par Argon2id la clé qui l'enveloppe
  (`packBlob`/`readHeader`, `apps/web/src/db/backup/crypto.ts`, octet de version 2). Le
  serveur ne voit ni la phrase ni la clé, et ne gagne pour cela ni colonne ni endpoint. Il n'y
  a **plus de code de récupération** depuis le sous-projet 26, et aucun blob antérieur n'est
  lu. `BackupStateRecord.wrap` est obligatoire : une sauvegarde active a toujours une
  enveloppe. Le paquet emporte toutes les tables sauf `backup`, `statements` compris. Le dépôt
  suit les écritures qui comptent — `TRIGGER_TABLES`, toutes sauf `snapshots` — jamais les
  snapshots de l'agent. L'export local `.json.gz`, lui, reste en clair.
```

Et, dans le tableau des sous-projets, passer la ligne 26 à `fait (2026-09-22)`.

- [ ] **Step 4 : `docs/points-reportes.md`**

Remplacer toute la section « Sous-projet 26 à ouvrir : la sauvegarde sans rien à conserver » par :

```markdown
## Reporté par le sous-projet 26 (la clé enveloppée par une phrase de passe)

- **Le format hérité n'est lu par personne**, choix du 2026-09-22 au motif d'un utilisateur
  unique et d'un VPS qui n'est pas en ligne. Une deuxième installation avant la mise en ligne
  exigerait de réintroduire une branche de compatibilité, son invite d'interface et ses tests.
- **La règle de force de la phrase mesure la longueur, pas l'entropie** : `motdepasse123`
  passe. Le rempart est Argon2id, assumé au spec §10.
- **Changer la phrase n'est effectif qu'au prochain dépôt** : d'ici là, l'ancienne ouvre encore
  le blob du serveur. Dit à l'utilisateur, jamais forcé par un dépôt immédiat.
- **La parité des clés entre `fr.json` et `en.json` n'est toujours vérifiée par aucun test** —
  dette du sous-projet 27, que ce sous-projet a de nouveau relue à la main.
- Et tout ce que la revue de branche aura relevé.
```

- [ ] **Step 5 : la vérification complète, une seule fois**

```bash
cd /home/seb/IA/IB_Analyzer2 && pnpm check
```

`pnpm check` lance lint, typage, build et **tous** les tests. Attendu : vert. La suite d'`apps/web`
flanche sous charge (dette du sous-projet 27, `findBy…` à une seconde) : un échec isolé dans
`AppLayout.test.tsx` **n'est pas** un échec de ce travail, mais il se constate et se dit, il ne
se masque pas par une relance jusqu'au vert.

- [ ] **Step 6 : la vérification visuelle**

Depuis la racine du dépôt, avec le skill `run-frontend`, capturer la page Paramètres en clair et
en sombre : la carte au repos, le formulaire d'activation ouvert, le formulaire de restauration
ouvert. Vérifier que les deux champs tiennent dans la carte et que le texte d'avertissement ne
déborde pas.

- [ ] **Step 7 : commit**

```bash
cd /home/seb/IA/IB_Analyzer2 && git add apps/web/src/db/backup/file.ts docs/specs/2026-09-03-architecture-design.md CLAUDE.md docs/points-reportes.md docs/plans/2026-09-22-sauvegarde-phrase-de-passe.md && git commit -m "Consigne la phrase de passe dans le spec, la règle et la dette"
```

---

## Fin de branche

Une fois les sept tâches cochées : `pnpm dev:start` dans le worktree, donner les deux URL à
Seb, et attendre sa décision avant le merge. `pnpm dev:stop` **avant** `git merge` et
`git worktree remove`.
