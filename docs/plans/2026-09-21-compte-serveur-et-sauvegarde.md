# Sous-projet 25 — Le compte serveur : ce qu'il ouvre, ce qu'il sauvegarde

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** couper le lien entre la session Django et les données locales — une base IndexedDB
par navigateur —, et livrer la sauvegarde chiffrée opt-in qui rend cette coupure sans risque.

**Architecture :** `apps/web/src/db/profile.ts` disparaît ; `DbProvider` sert une constante.
Un nouveau dossier `apps/web/src/db/backup/` sérialise la base en un paquet JSON, le comprime
en gzip, le chiffre en AES-GCM 256 et le dépose sur trois routes Django qui ne stockent que des
octets opaques. Un déclencheur posé sur les tables Dexie — toutes sauf `snapshots` — décide
quand le dépôt part.

**Tech Stack :** TypeScript, React 19, Dexie 4, WebCrypto, `CompressionStream`, Vitest +
`fake-indexeddb` ; Django 5.2 LTS, django-ninja, PostgreSQL, pytest.

**Spec :** `docs/specs/2026-09-21-compte-serveur-et-sauvegarde-design.md` — à lire avant la
première tâche. Le plan argumente depuis la spec ; les deux voyagent ensemble.

## Global Constraints

- **Le serveur ne voit jamais une donnée de portefeuille.** `core.Backup` ne stocke que des
  octets chiffrés par le navigateur, leur taille et leur date. Aucun champ, aucune route,
  aucune migration ne porte de transaction, de position ni de secteur. Si une tâche semble en
  réclamer : s'arrêter et demander (`CLAUDE.md`).
- **Plafond du blob : 20 Mo** (spec d'architecture §7.5), refusé proprement, jamais par une
  exception nue.
- **Une valeur absente reste `null`, jamais `0`.**
- **`AppDatabase` garde son paramètre `name`** : tous les tests de `apps/web` créent une base
  isolée par `new AppDatabase(\`test-${crypto.randomUUID()}\`)`. Le supprimer casserait toute
  la suite.
- **Aucun nom de domaine dans un fichier versionné.** Le client parle en chemins relatifs à
  `window.location.origin`, comme `apps/web/src/api/client.ts`.
- **shadcn ici est base-ui** : `render={<X/>}`, jamais `asChild`.
- **`pnpm check` une seule fois, à la fin** (tâche 12). Pendant l'itération : des tests ciblés,
  `npx vitest run <motif>` depuis `apps/web` — `pnpm --filter web test -- <motif>` ne filtre pas.
- **Chaque case du plan se coche dans le worktree, dans le même commit que la tâche.**

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `apps/web/src/db/profile.ts` | **supprimé** avec son test |
| `apps/web/src/db/DbProvider.tsx` | sert `db`, n'observe plus la session |
| `apps/web/src/db/schema.ts` | version 10 : table `backup` |
| `apps/web/src/db/backup/payload.ts` | la base ⇄ un objet JSON |
| `apps/web/src/db/backup/crypto.ts` | gzip, AES-GCM, code de récupération |
| `apps/web/src/db/backup/state.ts` | la clé et l'état local, hors du paquet |
| `apps/web/src/db/backup/file.ts` | export et import d'un fichier local |
| `apps/web/src/db/backup/trigger.ts` | quelles écritures déclenchent un dépôt |
| `apps/web/src/db/backup/sync.ts` | orchestration : construire, chiffrer, déposer |
| `apps/web/src/api/backup.ts` | les trois routes, côté navigateur |
| `apps/web/src/components/settings/BackupCard.tsx` | la carte de la page Paramètres |
| `apps/api/config/devkey.py` | la clé secrète de développement, une par checkout |
| `apps/api/core/models.py` | modèle `Backup` |
| `apps/api/core/api.py` | trois routes |

---

## Task 1: La base appartient au navigateur

**Files:**
- Delete: `apps/web/src/db/profile.ts`, `apps/web/src/db/profile.test.ts`
- Modify: `apps/web/src/db/DbProvider.tsx`, `apps/web/src/db/DbProvider.test.tsx`
- Modify: `apps/web/src/App.tsx` (commentaire), `apps/web/src/pages/SettingsPage.tsx:61`
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json` (retirer `settings.profileError`)
- Modify: `apps/api/core/schemas.py` (docstring de `SessionUserOut`)
- Test: `apps/web/src/db/DbProvider.test.tsx`

**Interfaces:**
- Consumes: rien.
- Produces: `useDb(): AppDatabase` inchangé de signature, mais toujours `db`. `useDbError`
  n'existe plus.

- [x] **Step 1: Écrire le test de non-régression**

Remplacer entièrement `apps/web/src/db/DbProvider.test.tsx` par :

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/api/session";
import { DbProvider, useDb } from "./DbProvider";
import { db } from "./schema";

function Probe() {
  const database = useDb();
  return <div data-testid="db-name">{database.name}</div>;
}

function renderWith(fetchImpl: typeof fetch) {
  vi.spyOn(globalThis, "fetch").mockImplementation(fetchImpl);
  return render(
    <SessionProvider>
      <DbProvider>
        <Probe />
      </DbProvider>
    </SessionProvider>,
  );
}

describe("DbProvider", () => {
  beforeEach(() => vi.restoreAllMocks());

  // Le bug du 2026-09-21 : la base suivait la session, donc toute coupure
  // affichait un portefeuille vide. Ce test est ce qui échouerait si on la
  // rebranchait.
  it.each([
    ["authentifiée", async () => new Response(JSON.stringify({ data: { user: { id: "9", email: "a@b.c" } } }), { status: 200 })],
    ["anonyme", async () => new Response("{}", { status: 401 })],
    ["serveur injoignable", async () => { throw new Error("offline"); }],
  ])("sert toujours la même base — session %s", async (_label, fetchImpl) => {
    renderWith(fetchImpl as typeof fetch);
    await waitFor(() => expect(screen.getByTestId("db-name")).toHaveTextContent(db.name));
    expect(db.name).toBe("ib-analyzer");
  });
});
```

- [x] **Step 2: Lancer le test, vérifier qu'il échoue**

Depuis `apps/web` : `npx vitest run src/db/DbProvider.test.tsx`
Attendu : ÉCHEC sur le cas « authentifiée » — la base rendue est `ib-analyzer-9`.

- [x] **Step 3: Réduire `DbProvider` à une constante**

`apps/web/src/db/DbProvider.tsx` en entier :

```tsx
import { createContext, useContext, type ReactNode } from "react";
import { db, type AppDatabase } from "./schema";

const DbContext = createContext<AppDatabase>(db);

/**
 * Every hook and every writer reads its database here, never by import.
 *
 * The database belongs to the browser, never to a Django account: the server is optional
 * (spec §2), so nothing it says — or fails to say — may change what the app shows. Until
 * sub-project 25 this provider picked a per-user profile from the session, which meant an
 * expired cookie, a restarted server or merely a slow answer emptied the account list and
 * bounced the user to /accounts. The account now opens two doors only, the Flex proxy and
 * the encrypted backup, and touches no data.
 */
export function useDb(): AppDatabase {
  return useContext(DbContext);
}

export function DbProvider({ children }: { children: ReactNode }) {
  return <DbContext.Provider value={db}>{children}</DbContext.Provider>;
}
```

- [x] **Step 4: Supprimer le profil et ses traces**

```bash
git rm apps/web/src/db/profile.ts apps/web/src/db/profile.test.ts
```

Dans `apps/web/src/pages/SettingsPage.tsx` : retirer l'import de `useDbError`, la ligne
`const dbError = useDbError();` et la ligne 61 `{dbError && <p …>{t("settings.profileError")}</p>}`.
Retirer la clé `settings.profileError` de `fr.json` et de `en.json`.

Dans `apps/web/src/App.tsx`, remplacer le commentaire par :

```tsx
      {/* SessionProvider only informs on the server's reachability and the user's login
          state; it never blocks a route — the server is optional (spec §2). DbProvider does
          not read it: the database belongs to the browser (sub-project 25). */}
```

Dans `apps/api/core/schemas.py`, remplacer la docstring de `SessionUserOut` par :

```python
    """Opaque and stable. The browser keys nothing local on it: since sub-project 25 the
    IndexedDB database belongs to the browser, not to the account."""
```

- [x] **Step 5: Lancer les tests, vérifier qu'ils passent**

Depuis `apps/web` : `npx vitest run src/db src/pages/SettingsPage`
Attendu : tout passe, aucune référence résiduelle à `profile`.
Puis `grep -rn "profileDb\|useDbError\|profileError" apps/web/src` : aucune sortie.

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "La base IndexedDB appartient au navigateur, plus au compte

Le profil par utilisateur faisait dépendre les données d'une réponse réseau :
session expirée, serveur éteint ou simplement lent affichaient un portefeuille
vide. Le test couvre les trois états de session."
```

---

## Task 2: Une clé secrète de développement stable par checkout

**Files:**
- Create: `apps/api/config/devkey.py`
- Create: `apps/api/tests/test_devkey.py`
- Modify: `apps/api/config/settings.py:10-19`
- Modify: `tools/dev-env/api.mjs:19-25`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `config.devkey.read_or_create_dev_secret(repo_root: Path) -> str`, et le fichier
  `<git dir du checkout>/dev-secret-key`.

- [x] **Step 1: Écrire le test**

`apps/api/tests/test_devkey.py` :

```python
from pathlib import Path

from config.devkey import checkout_git_dir, read_or_create_dev_secret


def test_creates_the_key_once_and_reuses_it(tmp_path):
    (tmp_path / ".git").mkdir()
    first = read_or_create_dev_secret(tmp_path)
    assert len(first) >= 50
    assert read_or_create_dev_secret(tmp_path) == first
    assert (tmp_path / ".git" / "dev-secret-key").read_text().strip() == first


def test_follows_a_worktree_to_its_own_git_directory(tmp_path):
    main = tmp_path / "main"
    (main / ".git" / "worktrees" / "feature").mkdir(parents=True)
    tree = tmp_path / "tree"
    tree.mkdir()
    (tree / ".git").write_text(f"gitdir: {main / '.git' / 'worktrees' / 'feature'}\n")

    assert checkout_git_dir(tree) == main / ".git" / "worktrees" / "feature"
    key = read_or_create_dev_secret(tree)
    assert (main / ".git" / "worktrees" / "feature" / "dev-secret-key").read_text().strip() == key
    assert key != read_or_create_dev_secret(main)


def test_falls_back_to_a_writable_path_when_there_is_no_git_directory(tmp_path):
    key = read_or_create_dev_secret(tmp_path)
    assert read_or_create_dev_secret(tmp_path) == key
```

- [x] **Step 2: Lancer le test, vérifier qu'il échoue**

`pnpm test:api -- apps/api/tests/test_devkey.py`
Attendu : ÉCHEC, `ModuleNotFoundError: No module named 'config.devkey'`.

- [x] **Step 3: Écrire `apps/api/config/devkey.py`**

```python
"""The development secret key, one per checkout, never committed.

Three different keys used to serve this application depending on how it was started —
settings' committed constant under DJANGO_DEBUG=1, tools/dev-env/api.mjs's own literal,
and whatever a human exported — and every switch between them silently invalidated every
session cookie at once (spec §2.2). One key per checkout, read or created here, is what
makes them agree.

It lives in the checkout's own git directory, beside `dev-slot`
(`checkoutGitDir`, tools/dev-env/ports.mjs): never versioned, and removed with the
worktree.
"""
import re
import secrets
from pathlib import Path

KEY_FILE = "dev-secret-key"


def checkout_git_dir(root: Path) -> Path:
    """`.git` in the main checkout, `.git/worktrees/<id>` in a linked worktree."""
    dot_git = root / ".git"
    if dot_git.is_dir():
        return dot_git
    if dot_git.is_file():
        match = re.search(r"^gitdir:\s*(.+)$", dot_git.read_text(), re.MULTILINE)
        if match:
            return (root / match.group(1).strip()).resolve()
    # No git directory at all (a source tarball, a container): the checkout root itself
    # is writable and per-checkout, which is all this needs.
    return root


def read_or_create_dev_secret(root: Path) -> str:
    path = checkout_git_dir(root) / KEY_FILE
    try:
        existing = path.read_text().strip()
        if existing:
            return existing
    except OSError:
        pass
    key = secrets.token_urlsafe(50)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{key}\n")
    return key
```

- [x] **Step 4: Brancher `settings.py`**

Remplacer les lignes 10 à 19 de `apps/api/config/settings.py` par :

```python
DEV_SECRET_KEY = "dev-only-not-for-production"
DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"
REPO_ROOT = BASE_DIR.parent.parent

# A forgotten DJANGO_SECRET_KEY in the VPS .env would otherwise start production on a key
# that is committed in this repository, and therefore public: session cookies and CSRF
# tokens forgeable by anyone who can read the code. Refusing to boot is the only safe
# failure here — a silent fallback is exactly what makes this class of bug survive.
#
# In DEBUG the key comes from the checkout's own git directory instead (config/devkey.py),
# so that every way of starting a dev server — `pnpm dev:api`, `pnpm dev:start`, a bare
# `manage.py runserver` — agrees on one key and stops invalidating each other's sessions.
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if not DEBUG:
        raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set outside DEBUG")
    SECRET_KEY = read_or_create_dev_secret(REPO_ROOT)
```

Ajouter en tête du fichier, après les imports existants :

```python
from config.devkey import read_or_create_dev_secret
```

- [x] **Step 5: Brancher `tools/dev-env/api.mjs`**

Dans `ports.mjs`, ajouter après `worktreeSlot` :

```js
/**
 * The checkout's development secret key, shared with Django's own config/devkey.py: one
 * file, so a server started here and one started by hand never invalidate each other's
 * sessions. Never versioned, removed with the worktree.
 *
 * @param {string} root directory of the checkout
 */
export function devSecretKey(root = REPO_ROOT) {
  const path = join(checkoutGitDir(root), "dev-secret-key");
  try {
    const existing = readFileSync(path, "utf8").trim();
    if (existing) return existing;
  } catch {
    // Not created yet: fall through and claim it.
  }
  const key = randomBytes(48).toString("base64url");
  writeFileSync(path, `${key}\n`);
  return key;
}
```

avec `import { randomBytes } from "node:crypto";` en tête.

Dans `api.mjs`, remplacer le littéral :

```js
import { describePorts, devPorts, devSecretKey, REPO_ROOT } from "./ports.mjs";

const env = {
  ...process.env,
  DATABASE_URL: ports.databaseUrl,
  // One key per checkout, the same file Django's config/devkey.py reads: a server started
  // here and one started by hand share a key, so neither invalidates the other's sessions.
  DJANGO_SECRET_KEY: process.env.DJANGO_SECRET_KEY || devSecretKey(),
};
```

Ajouter `dev-secret-key` à `.gitignore`.

- [x] **Step 6: Lancer les tests, vérifier qu'ils passent**

`pnpm test:api -- apps/api/tests/test_devkey.py`
Attendu : trois tests PASS.
Puis `node -e "import('./tools/dev-env/ports.mjs').then(m=>console.log(m.devSecretKey().length))"` :
un nombre, et le fichier créé n'apparaît pas dans `git status`.

- [x] **Step 7: Commit**

```bash
git add -A
git commit -m "Une clé secrète de développement stable par checkout

Trois clés différentes servaient l'application selon la façon de la démarrer, et
chaque bascule invalidait tous les cookies de session. Une seule clé, dans le
dossier git du checkout, lue par settings.py comme par dev-env."
```

---

## Task 3: Session glissante, et un corps de requête assez grand pour le blob

**Files:**
- Modify: `apps/api/config/settings.py`
- Create: `apps/api/tests/test_session_settings.py`

**Interfaces:**
- Produces: `SESSION_COOKIE_AGE = 30 * 24 * 3600`, `SESSION_SAVE_EVERY_REQUEST = True`,
  `DATA_UPLOAD_MAX_MEMORY_SIZE` au-dessus du plafond du blob.

- [ ] **Step 1: Écrire le test**

`apps/api/tests/test_session_settings.py` :

```python
from datetime import timedelta

from django.conf import settings
from django.test import Client
from django.utils import timezone


def test_the_session_is_rolling_and_lasts_a_month():
    assert settings.SESSION_SAVE_EVERY_REQUEST is True
    assert settings.SESSION_COOKIE_AGE == 30 * 24 * 3600


def test_a_request_pushes_the_expiry_back(db, django_user_model):
    user = django_user_model.objects.create_user(email="a@b.c", password="x" * 12)
    client = Client()
    client.force_login(user)

    from django.contrib.sessions.models import Session

    session = Session.objects.get(session_key=client.cookies["sessionid"].value)
    stale = timezone.now() + timedelta(days=1)
    Session.objects.filter(pk=session.pk).update(expire_date=stale)

    client.get("/api/csrf")

    assert Session.objects.get(pk=session.pk).expire_date > stale


def test_the_body_limit_leaves_room_for_a_twenty_megabyte_blob():
    assert settings.DATA_UPLOAD_MAX_MEMORY_SIZE > 20 * 1024 * 1024
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

`pnpm test:api -- apps/api/tests/test_session_settings.py`
Attendu : ÉCHEC — `SESSION_SAVE_EVERY_REQUEST` n'est pas défini, et
`DATA_UPLOAD_MAX_MEMORY_SIZE` vaut le défaut de Django, 2 621 440.

- [ ] **Step 3: Poser les réglages**

Après le bloc `SESSION_COOKIE_SAMESITE` de `apps/api/config/settings.py` :

```python
# Measured on the dev database the 2026-09-21: fourteen logins in sixteen days, none of
# them expired before the next one. Django's default expiry is fixed at login and never
# pushed back, so a daily user is still logged out every fortnight for no reason. Rolling
# it on every request is what makes "stay signed in while you use it" true.
SESSION_COOKIE_AGE = 30 * 24 * 3600
SESSION_SAVE_EVERY_REQUEST = True

# The encrypted backup blob is capped at 20 MB (architecture spec §7.5). Django's own
# default body limit is 2.5 MB, which would reject a legitimate deposit with
# RequestDataTooBig long before the endpoint's own check ever ran.
DATA_UPLOAD_MAX_MEMORY_SIZE = 21 * 1024 * 1024
```

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

`pnpm test:api -- apps/api/tests/test_session_settings.py`
Attendu : trois tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Session glissante de trente jours, et de la place pour le blob"
```

---

## Task 4: Le paquet — la base ⇄ un objet JSON

**Files:**
- Create: `apps/web/src/db/backup/payload.ts`
- Test: `apps/web/src/db/backup/payload.test.ts`

**Interfaces:**
- Produces:
  - `BACKUP_FORMAT: 1`
  - `BACKUP_TABLES: readonly ["accounts","transactions","imports","snapshots","sectors","statements","contracts","cashPoints"]`
  - `interface BackupPayload { format: number; createdAt: string; tables: Record<string, unknown[]> }`
  - `buildPayload(db: AppDatabase): Promise<BackupPayload>`
  - `restorePayload(db: AppDatabase, payload: BackupPayload): Promise<void>`
  - `class BackupFormatError extends Error`

- [ ] **Step 1: Écrire le test**

`apps/web/src/db/backup/payload.test.ts` :

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "@/db/accounts";
import { AppDatabase } from "@/db/schema";
import { BACKUP_FORMAT, BackupFormatError, buildPayload, restorePayload } from "./payload";

let db: AppDatabase;

beforeEach(async () => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
  await createAccount(db, { label: "Beta", ibAccountId: "U1234567" });
  await db.statements.put({
    id: "beta|2025-01-01|2025-12-31",
    accountId: "beta",
    fileName: "beta.htm",
    period: { start: "2025-01-01", end: "2025-12-31" },
    importedAt: "2026-01-02T00:00:00.000Z",
    text: "<html>relevé</html>",
    bytes: 19,
  });
  await db.sectors.put({
    ticker: "ZXAG",
    name: "Zxag",
    category: "Tech",
    score: 4,
    status: "",
    updatedAt: "2026-01-02T00:00:00.000Z",
  });
});

describe("buildPayload", () => {
  it("emporte les relevés HTML bruts, pas seulement le dérivé", async () => {
    const payload = await buildPayload(db);
    expect(payload.format).toBe(BACKUP_FORMAT);
    expect(payload.tables.statements).toHaveLength(1);
    expect((payload.tables.statements[0] as { text: string }).text).toBe("<html>relevé</html>");
  });
});

describe("restorePayload", () => {
  it("remplace la base, il ne fusionne pas", async () => {
    const payload = await buildPayload(db);
    await createAccount(db, { label: "Gamma", ibAccountId: "U7654321" });
    expect(await db.accounts.count()).toBe(2);

    await restorePayload(db, payload);

    expect((await db.accounts.toArray()).map((a) => a.id)).toEqual(["beta"]);
    expect(await db.sectors.get("ZXAG")).toMatchObject({ score: 4 });
    expect(await db.statements.count()).toBe(1);
  });

  it("vide une table absente du paquet plutôt que de la laisser derrière", async () => {
    const payload = await buildPayload(db);
    delete payload.tables.sectors;

    await restorePayload(db, payload);

    expect(await db.sectors.count()).toBe(0);
  });

  it("refuse un format qu'il ne connaît pas", async () => {
    await expect(restorePayload(db, { format: 99, createdAt: "", tables: {} })).rejects.toThrow(
      BackupFormatError,
    );
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Depuis `apps/web` : `npx vitest run src/db/backup/payload.test.ts`
Attendu : ÉCHEC, le module n'existe pas.

- [ ] **Step 3: Écrire `apps/web/src/db/backup/payload.ts`**

```ts
import type { AppDatabase } from "../schema";

export const BACKUP_FORMAT = 1;

/**
 * Every table of the database — `statements` included, and the `backup` table excluded.
 *
 * The raw statement HTML is in, decided the 2026-09-21 (spec §5.2): a backup that hands
 * back the rows without the files that produced them hands back a database that can no
 * longer be rebuilt, and turns "Relire les relevés" from a safety net into a trap. HTML
 * compresses ten to twenty fold, so the weight is no longer the argument it was.
 *
 * `backup` is out, and must stay out: it holds the key that encrypts this very payload.
 * A key saved inside what it encrypts saves nothing, and a restore must never overwrite
 * the key the device is currently using.
 */
export const BACKUP_TABLES = [
  "accounts",
  "transactions",
  "imports",
  "snapshots",
  "sectors",
  "statements",
  "contracts",
  "cashPoints",
] as const;

export interface BackupPayload {
  format: number;
  createdAt: string;
  tables: Record<string, unknown[]>;
}

export class BackupFormatError extends Error {
  constructor(format: unknown) {
    super(`Unsupported backup format: ${String(format)}`);
    this.name = "BackupFormatError";
  }
}

export async function buildPayload(db: AppDatabase): Promise<BackupPayload> {
  const tables: Record<string, unknown[]> = {};
  for (const name of BACKUP_TABLES) {
    tables[name] = await db.table(name).toArray();
  }
  return { format: BACKUP_FORMAT, createdAt: new Date().toISOString(), tables };
}

/**
 * Replaces, never merges (spec §7): two concurrent snapshots, two account records and two
 * hand-edited sector tables have no defined reconciliation, and the app has no arbiter to
 * offer. One transaction, so a failure leaves the database as it was.
 */
export async function restorePayload(db: AppDatabase, payload: BackupPayload): Promise<void> {
  if (payload.format !== BACKUP_FORMAT) throw new BackupFormatError(payload.format);
  await db.transaction("rw", BACKUP_TABLES.map((name) => db.table(name)), async () => {
    for (const name of BACKUP_TABLES) {
      await db.table(name).clear();
      const rows = payload.tables[name];
      if (Array.isArray(rows) && rows.length > 0) await db.table(name).bulkPut(rows);
    }
  });
}
```

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Depuis `apps/web` : `npx vitest run src/db/backup/payload.test.ts`
Attendu : quatre tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Le paquet de sauvegarde : la base entière, relevés HTML compris"
```

---

## Task 5: gzip, AES-GCM et le code de récupération

**Files:**
- Create: `apps/web/src/db/backup/crypto.ts`
- Test: `apps/web/src/db/backup/crypto.test.ts`

**Interfaces:**
- Produces:
  - `gzip(bytes: Uint8Array): Promise<Uint8Array>` / `gunzip(bytes: Uint8Array): Promise<Uint8Array>`
  - `encodePayload(payload: BackupPayload): Uint8Array` / `decodePayload(bytes: Uint8Array): BackupPayload`
  - `generateBackupKey(): Uint8Array` (32 octets)
  - `encryptBlob(key: Uint8Array, plain: Uint8Array): Promise<Uint8Array>` (`iv‖ciphertext`)
  - `decryptBlob(key: Uint8Array, blob: Uint8Array): Promise<Uint8Array>`
  - `toRecoveryCode(key: Uint8Array): string` / `fromRecoveryCode(code: string): Uint8Array`
  - `class BackupKeyError extends Error`

- [ ] **Step 1: Écrire le test**

`apps/web/src/db/backup/crypto.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import {
  BackupKeyError,
  decodePayload,
  decryptBlob,
  encodePayload,
  encryptBlob,
  fromRecoveryCode,
  generateBackupKey,
  gunzip,
  gzip,
  toRecoveryCode,
} from "./crypto";

const payload = { format: 1, createdAt: "2026-09-21T00:00:00.000Z", tables: { sectors: [{ ticker: "ZXAG" }] } };

describe("gzip", () => {
  it("fait l'aller-retour et réduit un texte répétitif", async () => {
    const plain = new TextEncoder().encode("<tr><td>ligne</td></tr>".repeat(500));
    const packed = await gzip(plain);
    expect(packed.byteLength).toBeLessThan(plain.byteLength / 5);
    expect(await gunzip(packed)).toEqual(plain);
  });
});

describe("encryptBlob", () => {
  it("fait l'aller-retour avec la bonne clé", async () => {
    const key = generateBackupKey();
    const plain = encodePayload(payload);
    const blob = await encryptBlob(key, plain);

    expect(blob).not.toEqual(plain);
    expect(decodePayload(await decryptBlob(key, blob))).toEqual(payload);
  });

  it("change à chaque dépôt : l'IV n'est jamais réutilisé", async () => {
    const key = generateBackupKey();
    const plain = encodePayload(payload);
    expect(await encryptBlob(key, plain)).not.toEqual(await encryptBlob(key, plain));
  });

  it("échoue avec une autre clé plutôt que de rendre n'importe quoi", async () => {
    const blob = await encryptBlob(generateBackupKey(), encodePayload(payload));
    await expect(decryptBlob(generateBackupKey(), blob)).rejects.toThrow();
  });
});

describe("toRecoveryCode", () => {
  it("fait l'aller-retour, groupes et casse compris", () => {
    const key = generateBackupKey();
    const code = toRecoveryCode(key);
    expect(code).toMatch(/^[A-Za-z0-9_-]{8}(-[A-Za-z0-9_-]{1,8})+$/);
    expect(fromRecoveryCode(code)).toEqual(key);
    expect(fromRecoveryCode(` ${code.replace(/-/g, "")} `)).toEqual(key);
  });

  it("refuse un code tronqué", () => {
    expect(() => fromRecoveryCode("trop-court")).toThrow(BackupKeyError);
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Depuis `apps/web` : `npx vitest run src/db/backup/crypto.test.ts`
Attendu : ÉCHEC, le module n'existe pas.

- [ ] **Step 3: Écrire `apps/web/src/db/backup/crypto.ts`**

```ts
import type { BackupPayload } from "./payload";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const GROUP = 8;

export class BackupKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupKeyError";
  }
}

async function through(bytes: Uint8Array, stream: ReadableWritablePair<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const source = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(source).arrayBuffer());
}

export function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return through(bytes, new CompressionStream("gzip"));
}

export function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return through(bytes, new DecompressionStream("gzip"));
}

export function encodePayload(payload: BackupPayload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

export function decodePayload(bytes: Uint8Array): BackupPayload {
  return JSON.parse(new TextDecoder().decode(bytes)) as BackupPayload;
}

/** Raw bytes, not a `CryptoKey`: a key is re-imported at each use, and raw bytes survive
 *  IndexedDB and `fake-indexeddb` alike, where a non-extractable `CryptoKey` does not. */
export function generateBackupKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(KEY_BYTES));
}

function importKey(key: Uint8Array): Promise<CryptoKey> {
  if (key.byteLength !== KEY_BYTES) throw new BackupKeyError(`A backup key is ${KEY_BYTES} bytes`);
  return crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** `iv ‖ ciphertext`. A fresh IV per deposit: AES-GCM forgives nothing here. */
export async function encryptBlob(key: Uint8Array, plain: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(key), plain as BufferSource);
  const out = new Uint8Array(IV_BYTES + cipher.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(cipher), IV_BYTES);
  return out;
}

export async function decryptBlob(key: Uint8Array, blob: Uint8Array): Promise<Uint8Array> {
  if (blob.byteLength <= IV_BYTES) throw new BackupKeyError("Backup blob too short to carry an IV");
  const iv = blob.subarray(0, IV_BYTES);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    await importKey(key),
    blob.subarray(IV_BYTES) as BufferSource,
  );
  return new Uint8Array(plain);
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Groups of eight, so a human can read it aloud and type it back. */
export function toRecoveryCode(key: Uint8Array): string {
  return (base64url(key).match(new RegExp(`.{1,${GROUP}}`, "g")) ?? []).join("-");
}

export function fromRecoveryCode(code: string): Uint8Array {
  const raw = code.trim().replace(/-/g, "").replace(/_/g, "/");
  const normalized = raw.replace(/\//g, "_").replace(/[^A-Za-z0-9_-]/g, "");
  let binary: string;
  try {
    binary = atob(normalized.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    throw new BackupKeyError("Recovery code is not readable");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength !== KEY_BYTES) throw new BackupKeyError(`A backup key is ${KEY_BYTES} bytes`);
  return bytes;
}
```

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Depuis `apps/web` : `npx vitest run src/db/backup/crypto.test.ts`
Attendu : six tests PASS. Si `CompressionStream` manque dans l'environnement jsdom, le
corriger dans `apps/web/vitest.setup.ts` en réexportant celui de `node:stream/web`, jamais en
affaiblissant le test.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Compression gzip, chiffrement AES-GCM et code de récupération"
```

---

## Task 6: La clé et l'état local, hors du paquet

**Files:**
- Modify: `apps/web/src/db/schema.ts` (version 10, table `backup`)
- Create: `apps/web/src/db/backup/state.ts`
- Test: `apps/web/src/db/backup/state.test.ts`

**Interfaces:**
- Produces:
  - `interface BackupStateRecord { id: "local"; enabled: boolean; key: Uint8Array; lastBackupAt: string | null; lastBackupBytes: number | null }`
  - `readBackupState(db): Promise<BackupStateRecord | null>`
  - `enableBackup(db): Promise<BackupStateRecord>` — engendre la clé si absente
  - `disableBackup(db): Promise<void>` — garde la clé, coupe les dépôts
  - `adoptBackupKey(db, key: Uint8Array): Promise<BackupStateRecord>` — restauration sur un nouvel appareil
  - `recordBackup(db, at: string, bytes: number): Promise<void>`

- [ ] **Step 1: Écrire le test**

`apps/web/src/db/backup/state.test.ts` :

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "@/db/schema";
import { generateBackupKey } from "./crypto";
import { adoptBackupKey, disableBackup, enableBackup, readBackupState, recordBackup } from "./state";

let db: AppDatabase;

beforeEach(() => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
});

describe("enableBackup", () => {
  it("part désactivée : rien ne quitte le navigateur sans un geste", async () => {
    expect(await readBackupState(db)).toBeNull();
  });

  it("engendre une clé une seule fois et la garde à travers une désactivation", async () => {
    const first = await enableBackup(db);
    expect(first.key).toHaveLength(32);
    expect(first.lastBackupAt).toBeNull();

    await disableBackup(db);
    const again = await enableBackup(db);
    expect(again.key).toEqual(first.key);
    expect(again.enabled).toBe(true);
  });
});

describe("recordBackup", () => {
  it("retient la date et la taille du dernier dépôt", async () => {
    await enableBackup(db);
    await recordBackup(db, "2026-09-21T10:00:00.000Z", 4096);
    expect(await readBackupState(db)).toMatchObject({
      lastBackupAt: "2026-09-21T10:00:00.000Z",
      lastBackupBytes: 4096,
    });
  });
});

describe("adoptBackupKey", () => {
  it("remplace la clé du poste par celle du code de récupération", async () => {
    await enableBackup(db);
    const other = generateBackupKey();
    await adoptBackupKey(db, other);
    expect((await readBackupState(db))?.key).toEqual(other);
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Depuis `apps/web` : `npx vitest run src/db/backup/state.test.ts`
Attendu : ÉCHEC, le module et la table n'existent pas.

- [ ] **Step 3: Ajouter la version 10 du schéma**

Dans `apps/web/src/db/schema.ts`, après l'interface `SectorRecord` :

```ts
/**
 * The backup's own state, deliberately outside `BACKUP_TABLES`: it holds the key that
 * encrypts the payload. A key saved inside what it encrypts saves nothing, and a restore
 * must never overwrite the key the device is currently using.
 */
export interface BackupStateRecord {
  /** One row per browser. */
  id: "local";
  enabled: boolean;
  /** Raw AES-GCM 256 bytes; shown once as a recovery code, never sent to the server. */
  key: Uint8Array;
  lastBackupAt: string | null;
  lastBackupBytes: number | null;
}
```

Déclarer la table dans la classe, sous `cashPoints` :

```ts
  backup!: EntityTable<BackupStateRecord, "id">;
```

et, après la version 9 :

```ts
    // Additive: adds the `backup` table and rewrites no existing row.
    this.version(10).stores({
      backup: "id",
    });
```

- [ ] **Step 4: Écrire `apps/web/src/db/backup/state.ts`**

```ts
import type { AppDatabase, BackupStateRecord } from "../schema";
import { generateBackupKey } from "./crypto";

const ROW_ID = "local" as const;

export type { BackupStateRecord };

export async function readBackupState(db: AppDatabase): Promise<BackupStateRecord | null> {
  return (await db.backup.get(ROW_ID)) ?? null;
}

/**
 * Off by default (architecture spec §7.5): a user who wants nothing on the server has
 * nothing to do. Enabling twice keeps the first key — regenerating it would strand the
 * blob already deposited, and the recovery code already written down.
 */
export async function enableBackup(db: AppDatabase): Promise<BackupStateRecord> {
  const existing = await readBackupState(db);
  const row: BackupStateRecord = existing
    ? { ...existing, enabled: true }
    : { id: ROW_ID, enabled: true, key: generateBackupKey(), lastBackupAt: null, lastBackupBytes: null };
  await db.backup.put(row);
  return row;
}

/** Keeps the key: the user may re-enable, and the server blob is still theirs to read. */
export async function disableBackup(db: AppDatabase): Promise<void> {
  const existing = await readBackupState(db);
  if (existing) await db.backup.put({ ...existing, enabled: false });
}

/** Restoring on a new device: the recovery code's key replaces this browser's. */
export async function adoptBackupKey(db: AppDatabase, key: Uint8Array): Promise<BackupStateRecord> {
  const existing = await readBackupState(db);
  const row: BackupStateRecord = {
    id: ROW_ID,
    enabled: true,
    key,
    lastBackupAt: existing?.lastBackupAt ?? null,
    lastBackupBytes: existing?.lastBackupBytes ?? null,
  };
  await db.backup.put(row);
  return row;
}

export async function recordBackup(db: AppDatabase, at: string, bytes: number): Promise<void> {
  const existing = await readBackupState(db);
  if (existing) await db.backup.put({ ...existing, lastBackupAt: at, lastBackupBytes: bytes });
}
```

- [ ] **Step 5: Lancer les tests, vérifier qu'ils passent**

Depuis `apps/web` : `npx vitest run src/db/backup src/db/schema.test.ts`
Attendu : tout PASS, la version 10 n'abîme aucune base existante.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "La clé de sauvegarde vit en IndexedDB, hors du paquet qu'elle chiffre"
```

---

## Task 7: L'export et l'import d'un fichier local

**Files:**
- Create: `apps/web/src/db/backup/file.ts`
- Test: `apps/web/src/db/backup/file.test.ts`

**Interfaces:**
- Produces:
  - `backupFileName(now: Date): string` → `ib-analyzer-2026-09-21.json.gz`
  - `exportToBlob(db): Promise<Blob>`
  - `importFromFile(db, file: File): Promise<void>`

- [ ] **Step 1: Écrire le test**

`apps/web/src/db/backup/file.test.ts` :

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "@/db/accounts";
import { AppDatabase } from "@/db/schema";
import { backupFileName, exportToBlob, importFromFile } from "./file";

let db: AppDatabase;

beforeEach(async () => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
  await createAccount(db, { label: "Beta", ibAccountId: "U1234567" });
});

describe("backupFileName", () => {
  it("porte la date du jour", () => {
    expect(backupFileName(new Date("2026-09-21T22:00:00.000Z"))).toBe("ib-analyzer-2026-09-21.json.gz");
  });
});

describe("exportToBlob", () => {
  // Le chemin de sauvegarde de qui n'a pas de compte Django : il doit suffire à lui seul.
  it("fait l'aller-retour par un fichier, sans serveur ni compte", async () => {
    const blob = await exportToBlob(db);
    const file = new File([blob], backupFileName(new Date()));

    const other = new AppDatabase(`test-${crypto.randomUUID()}`);
    await importFromFile(other, file);

    expect((await other.accounts.toArray()).map((a) => a.id)).toEqual(["beta"]);
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Depuis `apps/web` : `npx vitest run src/db/backup/file.test.ts`
Attendu : ÉCHEC, le module n'existe pas.

- [ ] **Step 3: Écrire `apps/web/src/db/backup/file.ts`**

```ts
import type { AppDatabase } from "../schema";
import { decodePayload, encodePayload, gunzip, gzip } from "./crypto";
import { buildPayload, restorePayload } from "./payload";

/**
 * The local file is the backup of whoever never creates a Django account — the first
 * requirement of this sub-project. It is not encrypted: it never leaves the machine, and
 * one more key to remember would make it a backup nobody can read back. It does carry the
 * Flex token, since it carries the account records; the Settings card says so.
 */
export function backupFileName(now: Date): string {
  return `ib-analyzer-${now.toISOString().slice(0, 10)}.json.gz`;
}

export async function exportToBlob(db: AppDatabase): Promise<Blob> {
  const packed = await gzip(encodePayload(await buildPayload(db)));
  return new Blob([packed as BlobPart], { type: "application/gzip" });
}

export async function importFromFile(db: AppDatabase, file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  await restorePayload(db, decodePayload(await gunzip(bytes)));
}
```

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Depuis `apps/web` : `npx vitest run src/db/backup/file.test.ts`
Attendu : deux tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Export et import d'un fichier local, la sauvegarde sans compte"
```

---

## Task 8: Le serveur — un blob opaque par utilisateur

**Files:**
- Modify: `apps/api/core/models.py`
- Create: `apps/api/core/migrations/0004_backup.py`
- Modify: `apps/api/core/api.py`, `apps/api/core/schemas.py`
- Create: `apps/api/tests/test_backup_api.py`
- Modify: `apps/api/openapi.json`, `apps/web/src/api/schema.d.ts` (régénérés)

**Interfaces:**
- Produces : `POST /api/backup` (corps binaire, remplace), `GET /api/backup` (octets),
  `DELETE /api/backup`, `GET /api/backup/status` → `{ present: bool, updatedAt: str | None,
  bytes: int | None }`.

- [ ] **Step 1: Écrire le test**

`apps/api/tests/test_backup_api.py` :

```python
import pytest
from django.test import Client

from core.models import MAX_BACKUP_BYTES

pytestmark = pytest.mark.django_db


def signed_in(django_user_model, email):
    user = django_user_model.objects.create_user(email=email, password="x" * 14)
    client = Client()
    client.force_login(user)
    return client


def test_deposit_then_read_gives_the_same_bytes(django_user_model):
    client = signed_in(django_user_model, "a@b.c")
    blob = bytes(range(256)) * 4

    assert client.post("/api/backup", data=blob, content_type="application/octet-stream").status_code == 200
    answer = client.get("/api/backup")

    assert answer.status_code == 200
    assert answer.content == blob


def test_a_second_deposit_replaces_the_first(django_user_model):
    client = signed_in(django_user_model, "a@b.c")
    client.post("/api/backup", data=b"first", content_type="application/octet-stream")
    client.post("/api/backup", data=b"second", content_type="application/octet-stream")

    assert client.get("/api/backup").content == b"second"


def test_status_tells_size_and_date_without_downloading(django_user_model):
    client = signed_in(django_user_model, "a@b.c")
    assert client.get("/api/backup/status").json() == {"present": False, "updatedAt": None, "bytes": None}

    client.post("/api/backup", data=b"12345", content_type="application/octet-stream")
    status = client.get("/api/backup/status").json()

    assert status["present"] is True
    assert status["bytes"] == 5
    assert status["updatedAt"]


def test_delete_removes_it(django_user_model):
    client = signed_in(django_user_model, "a@b.c")
    client.post("/api/backup", data=b"gone", content_type="application/octet-stream")

    assert client.delete("/api/backup").status_code == 200
    assert client.get("/api/backup").status_code == 404


def test_over_the_cap_is_refused_cleanly(django_user_model):
    client = signed_in(django_user_model, "a@b.c")
    answer = client.post(
        "/api/backup", data=b"x" * (MAX_BACKUP_BYTES + 1), content_type="application/octet-stream"
    )

    assert answer.status_code == 413
    assert answer.json()["code"] == "backup-too-large"
    assert client.get("/api/backup").status_code == 404


def test_one_user_never_reads_or_replaces_another(django_user_model):
    mine = signed_in(django_user_model, "a@b.c")
    theirs = signed_in(django_user_model, "d@e.f")
    mine.post("/api/backup", data=b"mine", content_type="application/octet-stream")

    assert theirs.get("/api/backup").status_code == 404
    theirs.post("/api/backup", data=b"theirs", content_type="application/octet-stream")
    assert mine.get("/api/backup").content == b"mine"


def test_anonymous_is_refused(client):
    assert client.get("/api/backup").status_code == 401
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

`pnpm test:api -- apps/api/tests/test_backup_api.py`
Attendu : ÉCHEC, `ImportError` sur `MAX_BACKUP_BYTES`.

- [ ] **Step 3: Écrire le modèle**

À la fin de `apps/api/core/models.py` :

```python
# Architecture spec §7.5. The browser compresses before encrypting, so this is a ceiling
# no honest payload approaches, not a budget.
MAX_BACKUP_BYTES = 20 * 1024 * 1024


class Backup(models.Model):
    """One opaque blob per user, replaced on every deposit.

    This is not the forbidden table. The stop signal in CLAUDE.md is about a model holding
    transactions, positions or sectors — portfolio data the server could read. This holds
    bytes the server cannot decrypt and whose structure it does not know; §7.1 of the
    architecture spec has provided for it since the beginning: "users, and for those who
    enabled it, an opaque encrypted blob. Nothing else."
    """

    user = models.OneToOneField("core.User", on_delete=models.CASCADE, related_name="backup")
    blob = models.BinaryField()
    bytes = models.PositiveIntegerField()
    updated_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f"backup of {self.user_id} ({self.bytes} bytes)"
```

Puis : `uv run --project apps/api python apps/api/manage.py makemigrations core --name backup`

- [ ] **Step 4: Écrire les routes**

Dans `apps/api/core/schemas.py` :

```python
class BackupStatusOut(Schema):
    present: bool
    updatedAt: str | None
    bytes: int | None
```

Dans `apps/api/core/api.py`, ajouter les imports puis les quatre vues :

```python
from django.http import HttpResponse
from ninja.security import django_auth

from core.models import MAX_BACKUP_BYTES, Backup
from core.schemas import BackupStatusOut

TOO_LARGE = {"code": "backup-too-large", "detail": "This backup is larger than the 20 MB limit."}
NO_BACKUP = {"code": "backup-missing", "detail": "No backup has been deposited yet."}


@router.post("/backup", auth=django_auth, response={200: BackupStatusOut, 413: ErrorOut})
def put_backup(request):
    """The body is raw ciphertext: never parsed, never logged, never inspected."""
    blob = request.body
    if len(blob) > MAX_BACKUP_BYTES:
        return Status(413, TOO_LARGE)
    now = timezone.now()
    Backup.objects.update_or_create(
        user=request.user, defaults={"blob": blob, "bytes": len(blob), "updated_at": now}
    )
    return Status(200, {"present": True, "updatedAt": now.isoformat(), "bytes": len(blob)})


@router.get("/backup", auth=django_auth, response={200: bytes, 404: ErrorOut})
def get_backup(request):
    """Returns a plain `HttpResponse`: ninja hands any `HttpResponseBase` back untouched,
    before it ever looks at `response_models` — the same pattern `ib.api._relay` uses."""
    backup = Backup.objects.filter(user=request.user).first()
    if backup is None:
        return Status(404, NO_BACKUP)
    return HttpResponse(bytes(backup.blob), status=200, content_type="application/octet-stream")


@router.delete("/backup", auth=django_auth, response={200: BackupStatusOut})
def delete_backup(request):
    Backup.objects.filter(user=request.user).delete()
    return Status(200, {"present": False, "updatedAt": None, "bytes": None})


@router.get("/backup/status", auth=django_auth, response={200: BackupStatusOut})
def backup_status(request):
    backup = Backup.objects.filter(user=request.user).first()
    if backup is None:
        return Status(200, {"present": False, "updatedAt": None, "bytes": None})
    return Status(200, {"present": True, "updatedAt": backup.updated_at.isoformat(), "bytes": backup.bytes})
```

- [ ] **Step 5: Lancer les tests, vérifier qu'ils passent**

`pnpm test:api -- apps/api/tests/test_backup_api.py`
Attendu : sept tests PASS. Si `response={200: bytes}` fait tousser ninja, déclarer `200: str`
comme le fait `ib/api.py` : la réponse réelle reste l'`HttpResponse` binaire.

- [ ] **Step 6: Régénérer le schéma**

```bash
uv run --project apps/api python apps/api/manage.py export_openapi_schema --api config.api.api --output apps/api/openapi.json
pnpm gen:api
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Trois routes pour un blob opaque, plafonné à 20 Mo et isolé par utilisateur"
```

---

## Task 9: Le client des trois routes

**Files:**
- Create: `apps/web/src/api/backup.ts`
- Test: `apps/web/src/api/backup.test.ts`

**Interfaces:**
- Produces:
  - `type BackupResult<T> = { ok: true; value: T } | { ok: false; kind: "unreachable" | "anonymous" | "too-large" | "missing" | "failed" }`
  - `fetchBackupStatus(): Promise<BackupResult<{ present: boolean; updatedAt: string | null; bytes: number | null }>>`
  - `putBackup(blob: Uint8Array): Promise<BackupResult<{ updatedAt: string; bytes: number }>>`
  - `getBackup(): Promise<BackupResult<Uint8Array>>`
  - `deleteBackup(): Promise<BackupResult<void>>`

- [ ] **Step 1: Écrire le test**

`apps/web/src/api/backup.test.ts` :

```ts
import { describe, expect, it, vi } from "vitest";
import { getBackup, putBackup } from "./backup";

describe("putBackup", () => {
  it("envoie les octets bruts, jamais du JSON", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ present: true, updatedAt: "2026-09-21T10:00:00Z", bytes: 3 }), { status: 200 }),
    );

    const result = await putBackup(new Uint8Array([1, 2, 3]));

    expect(result).toEqual({ ok: true, value: { updatedAt: "2026-09-21T10:00:00Z", bytes: 3 } });
    const [, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ "content-type": "application/octet-stream" });
  });

  it("distingue le plafond dépassé d'un échec quelconque", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 413 }));
    expect(await putBackup(new Uint8Array([1]))).toEqual({ ok: false, kind: "too-large" });
  });

  it("un serveur injoignable n'est jamais une exception", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    expect(await putBackup(new Uint8Array([1]))).toEqual({ ok: false, kind: "unreachable" });
  });
});

describe("getBackup", () => {
  it("rend les octets tels quels", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([7, 8]), { status: 200 }));
    expect(await getBackup()).toEqual({ ok: true, value: new Uint8Array([7, 8]) });
  });

  it("une sauvegarde absente n'est pas un échec", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 404 }));
    expect(await getBackup()).toEqual({ ok: false, kind: "missing" });
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Depuis `apps/web` : `npx vitest run src/api/backup.test.ts`
Attendu : ÉCHEC, le module n'existe pas.

- [ ] **Step 3: Écrire `apps/web/src/api/backup.ts`**

```ts
/**
 * The three backup routes. Plain `fetch` rather than the generated `openapi-fetch` client:
 * the deposit and the download carry raw bytes, which that client is not shaped for. Same
 * precedent as `allauth.ts`, and the same absolute URL rule as `client.ts` — Node's undici
 * rejects a relative one, in the build and in jsdom alike.
 */
import { csrfToken } from "./csrf";

const BASE = `${window.location.origin}/api/backup`;

export type BackupFailure = "unreachable" | "anonymous" | "too-large" | "missing" | "failed";
export type BackupResult<T> = { ok: true; value: T } | { ok: false; kind: BackupFailure };

export interface BackupStatus {
  present: boolean;
  updatedAt: string | null;
  bytes: number | null;
}

function failureFor(status: number): BackupFailure {
  if (status === 401 || status === 403) return "anonymous";
  if (status === 413) return "too-large";
  if (status === 404) return "missing";
  return "failed";
}

async function call(path: string, init: RequestInit = {}): Promise<Response | null> {
  const token = csrfToken();
  try {
    return await fetch(`${BASE}${path}`, {
      credentials: "same-origin",
      headers: { ...(token ? { "X-CSRFToken": token } : {}), ...(init.headers ?? {}) },
      ...init,
    });
  } catch {
    // The server is optional (spec §2): unreachable is a state, never an exception.
    return null;
  }
}

export async function fetchBackupStatus(): Promise<BackupResult<BackupStatus>> {
  const answer = await call("/status");
  if (answer === null) return { ok: false, kind: "unreachable" };
  if (!answer.ok) return { ok: false, kind: failureFor(answer.status) };
  return { ok: true, value: (await answer.json()) as BackupStatus };
}

export async function putBackup(blob: Uint8Array): Promise<BackupResult<{ updatedAt: string; bytes: number }>> {
  const answer = await call("", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: blob as BodyInit,
  });
  if (answer === null) return { ok: false, kind: "unreachable" };
  if (!answer.ok) return { ok: false, kind: failureFor(answer.status) };
  const body = (await answer.json()) as BackupStatus;
  return { ok: true, value: { updatedAt: body.updatedAt ?? "", bytes: body.bytes ?? blob.byteLength } };
}

export async function getBackup(): Promise<BackupResult<Uint8Array>> {
  const answer = await call("");
  if (answer === null) return { ok: false, kind: "unreachable" };
  if (!answer.ok) return { ok: false, kind: failureFor(answer.status) };
  return { ok: true, value: new Uint8Array(await answer.arrayBuffer()) };
}

export async function deleteBackup(): Promise<BackupResult<void>> {
  const answer = await call("", { method: "DELETE" });
  if (answer === null) return { ok: false, kind: "unreachable" };
  if (!answer.ok) return { ok: false, kind: failureFor(answer.status) };
  return { ok: true, value: undefined };
}
```

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Depuis `apps/web` : `npx vitest run src/api/backup.test.ts`
Attendu : cinq tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Le client des trois routes de sauvegarde"
```

---

## Task 10: Quand la sauvegarde part

**Files:**
- Create: `apps/web/src/db/backup/sync.ts`
- Create: `apps/web/src/db/backup/trigger.ts`
- Create: `apps/web/src/db/backup/BackupSync.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/db/backup/trigger.test.ts`, `apps/web/src/db/backup/sync.test.ts`

**Interfaces:**
- Produces:
  - `TRIGGER_TABLES: readonly string[]` — toutes sauf `snapshots` et `backup`
  - `installBackupTrigger(db: AppDatabase, onChange: () => void): () => void`
  - `suppressBackupTrigger<T>(run: () => Promise<T>): Promise<T>`
  - `pushBackup(db: AppDatabase): Promise<BackupResult<{ updatedAt: string; bytes: number }> | null>`
  - `pullBackup(db: AppDatabase, key: Uint8Array): Promise<BackupResult<void>>`
  - `BACKUP_DEBOUNCE_MS = 30_000`

- [ ] **Step 1: Écrire le test du déclencheur**

`apps/web/src/db/backup/trigger.test.ts` :

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount } from "@/db/accounts";
import { AppDatabase } from "@/db/schema";
import { SAMPLE_SNAPSHOT } from "@/mocks/positions";
import { installBackupTrigger, suppressBackupTrigger } from "./trigger";

let db: AppDatabase;

beforeEach(() => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
});

describe("installBackupTrigger", () => {
  // La règle de la spec §5.3 : on sauvegarde ce qui ne se reconstruit pas tout seul.
  it("réagit à un compte créé", async () => {
    const onChange = vi.fn();
    installBackupTrigger(db, onChange);

    await createAccount(db, { label: "Beta", ibAccountId: "U1234567" });

    expect(onChange).toHaveBeenCalled();
  });

  it("ignore un snapshot de l'agent, qui revient toutes les cinq minutes", async () => {
    const onChange = vi.fn();
    installBackupTrigger(db, onChange);

    await db.snapshots.put({
      accountId: "beta",
      source: "agent",
      asOf: "2026-09-21T14:00:00.000Z",
      importedAt: "2026-09-21T14:00:00.000Z",
      positions: SAMPLE_SNAPSHOT.positions,
      cashAvailable: null,
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("se tait pendant une restauration, qui réécrit toute la base", async () => {
    const onChange = vi.fn();
    installBackupTrigger(db, onChange);

    await suppressBackupTrigger(async () => {
      await createAccount(db, { label: "Beta", ibAccountId: "U1234567" });
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("se débranche", async () => {
    const onChange = vi.fn();
    installBackupTrigger(db, onChange)();

    await createAccount(db, { label: "Beta", ibAccountId: "U1234567" });

    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Depuis `apps/web` : `npx vitest run src/db/backup/trigger.test.ts`
Attendu : ÉCHEC, le module n'existe pas.

- [ ] **Step 3: Écrire `apps/web/src/db/backup/trigger.ts`**

```ts
import type { AppDatabase } from "../schema";
import { BACKUP_TABLES } from "./payload";

/** Thirty seconds: long enough to fold an import's many writes into one deposit. */
export const BACKUP_DEBOUNCE_MS = 30_000;

/**
 * Every table of the payload except `snapshots`.
 *
 * The rule of spec §5.3 in one line: we back up what does not rebuild itself. The agent
 * writes a snapshot on every poll, a few seconds apart, and would push megabytes in a loop
 * all session long; its snapshot is rebuilt by the next poll anyway. Scoping by table
 * rather than by call site is deliberate — a future writer cannot forget to call us.
 */
export const TRIGGER_TABLES: readonly string[] = BACKUP_TABLES.filter((name) => name !== "snapshots");

let suppressed = 0;

/** A restore rewrites every table; it must not push what it has just pulled. */
export async function suppressBackupTrigger<T>(run: () => Promise<T>): Promise<T> {
  suppressed += 1;
  try {
    return await run();
  } finally {
    suppressed -= 1;
  }
}

export function installBackupTrigger(db: AppDatabase, onChange: () => void): () => void {
  const fire = () => {
    if (suppressed === 0) onChange();
  };
  const unsubscribes: (() => void)[] = [];
  for (const name of TRIGGER_TABLES) {
    const table = db.table(name);
    for (const event of ["creating", "updating", "deleting"] as const) {
      table.hook(event, fire);
      unsubscribes.push(() => table.hook(event).unsubscribe(fire));
    }
  }
  return () => {
    for (const off of unsubscribes) off();
  };
}
```

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Depuis `apps/web` : `npx vitest run src/db/backup/trigger.test.ts`
Attendu : quatre tests PASS.

- [ ] **Step 5: Écrire l'orchestration et son test**

`apps/web/src/db/backup/sync.ts` :

```ts
import { getBackup, putBackup, type BackupResult } from "@/api/backup";
import type { AppDatabase } from "../schema";
import { decodePayload, decryptBlob, encodePayload, encryptBlob, gunzip, gzip } from "./crypto";
import { buildPayload, restorePayload } from "./payload";
import { readBackupState, recordBackup } from "./state";
import { suppressBackupTrigger } from "./trigger";

/** `null` when the backup is off: not an error, simply nothing to do. */
export async function pushBackup(
  db: AppDatabase,
): Promise<BackupResult<{ updatedAt: string; bytes: number }> | null> {
  const state = await readBackupState(db);
  if (!state?.enabled) return null;

  const blob = await encryptBlob(state.key, await gzip(encodePayload(await buildPayload(db))));
  const result = await putBackup(blob);
  if (result.ok) await recordBackup(db, result.value.updatedAt, result.value.bytes);
  return result;
}

export async function pullBackup(db: AppDatabase, key: Uint8Array): Promise<BackupResult<void>> {
  const blob = await getBackup();
  if (!blob.ok) return blob;
  const payload = decodePayload(await gunzip(await decryptBlob(key, blob.value)));
  await suppressBackupTrigger(() => restorePayload(db, payload));
  return { ok: true, value: undefined };
}
```

`apps/web/src/db/backup/sync.test.ts` :

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount } from "@/db/accounts";
import { AppDatabase } from "@/db/schema";
import { enableBackup, readBackupState } from "./state";
import { pullBackup, pushBackup } from "./sync";

let db: AppDatabase;

beforeEach(async () => {
  vi.restoreAllMocks();
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
  await createAccount(db, { label: "Beta", ibAccountId: "U1234567" });
});

describe("pushBackup", () => {
  it("ne fait rien tant que la sauvegarde n'est pas activée", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await pushBackup(db)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dépose des octets que le serveur ne peut pas lire, et retient la date", async () => {
    await enableBackup(db);
    let deposited = new Uint8Array();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      deposited = new Uint8Array((init as RequestInit).body as ArrayBuffer);
      return new Response(JSON.stringify({ present: true, updatedAt: "2026-09-21T10:00:00Z", bytes: deposited.byteLength }), { status: 200 });
    });

    await pushBackup(db);

    expect(new TextDecoder().decode(deposited)).not.toContain("beta");
    expect(await readBackupState(db)).toMatchObject({ lastBackupAt: "2026-09-21T10:00:00Z" });
  });
});

describe("pullBackup", () => {
  it("fait l'aller-retour complet par le serveur", async () => {
    const state = await enableBackup(db);
    let deposited = new Uint8Array();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if ((init as RequestInit)?.method === "POST") {
        deposited = new Uint8Array((init as RequestInit).body as ArrayBuffer);
        return new Response(JSON.stringify({ present: true, updatedAt: "2026-09-21T10:00:00Z", bytes: 1 }), { status: 200 });
      }
      return new Response(deposited as BodyInit, { status: 200 });
    });
    await pushBackup(db);

    const other = new AppDatabase(`test-${crypto.randomUUID()}`);
    expect(await pullBackup(other, state.key)).toEqual({ ok: true, value: undefined });
    expect((await other.accounts.toArray()).map((a) => a.id)).toEqual(["beta"]);
  });
});
```

- [ ] **Step 6: Brancher le déclencheur dans l'application**

`apps/web/src/db/backup/BackupSync.tsx` :

```tsx
import { useEffect } from "react";
import { useDb } from "../DbProvider";
import { pushBackup } from "./sync";
import { BACKUP_DEBOUNCE_MS, installBackupTrigger } from "./trigger";

/**
 * Mounted once, beside the router: a deposit follows the writes that count, wherever in the
 * app they happen. Rendered nothing — it is a subscription, not a view.
 */
export function BackupSync() {
  const db = useDb();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const uninstall = installBackupTrigger(db, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void pushBackup(db), BACKUP_DEBOUNCE_MS);
    });
    return () => {
      clearTimeout(timer);
      uninstall();
    };
  }, [db]);
  return null;
}
```

Dans `apps/web/src/App.tsx`, à l'intérieur de `<DbProvider>` :

```tsx
        <DbProvider>
          <BackupSync />
          <RouterProvider router={router} />
        </DbProvider>
```

- [ ] **Step 7: Lancer les tests, vérifier qu'ils passent**

Depuis `apps/web` : `npx vitest run src/db/backup`
Attendu : tout PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Le dépôt suit les écritures qui comptent, jamais les snapshots de l'agent"
```

---

## Task 11: La carte Sauvegarde de la page Paramètres

**Files:**
- Create: `apps/web/src/components/settings/BackupCard.tsx`
- Modify: `apps/web/src/pages/SettingsPage.tsx`
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Test: `apps/web/src/components/settings/BackupCard.test.tsx`

**Interfaces:**
- Consumes: `readBackupState`, `enableBackup`, `disableBackup`, `adoptBackupKey`,
  `pushBackup`, `pullBackup`, `deleteBackup`, `exportToBlob`, `importFromFile`,
  `toRecoveryCode`, `fromRecoveryCode`, `useSession`.

- [ ] **Step 1: Écrire le test**

`apps/web/src/components/settings/BackupCard.test.tsx` :

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { I18nextProvider } from "react-i18next";
import { AppDatabase } from "@/db/schema";
import { DbProvider } from "@/db/DbProvider";
import { readBackupState } from "@/db/backup/state";
import { BackupCard } from "./BackupCard";

vi.mock("@/api/session", () => ({
  useSession: () => ({ status: "authenticated", user: { id: "9", email: "a@b.c" } }),
}));

function renderCard() {
  return render(
    <I18nextProvider i18n={i18n}>
      <DbProvider>
        <BackupCard />
      </DbProvider>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ present: false, updatedAt: null, bytes: null }), { status: 200 }),
  );
  await new AppDatabase().backup.clear();
});

describe("BackupCard", () => {
  it("part désactivée et le dit", async () => {
    renderCard();
    expect(await screen.findByText(i18n.t("settings.backupDisabled"))).toBeInTheDocument();
  });

  it("montre le code de récupération une seule fois à l'activation", async () => {
    renderCard();
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.backupEnable") }));

    await waitFor(async () => expect((await readBackupState(new AppDatabase()))?.enabled).toBe(true));
    expect(screen.getByText(i18n.t("settings.backupRecoveryHint"))).toBeInTheDocument();
  });

  it("propose l'export local même sans compte", async () => {
    renderCard();
    expect(await screen.findByRole("button", { name: i18n.t("settings.backupExport") })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Depuis `apps/web` : `npx vitest run src/components/settings/BackupCard.test.tsx`
Attendu : ÉCHEC, le composant n'existe pas.

- [ ] **Step 3: Ajouter les clés i18n**

Dans `apps/web/src/i18n/fr.json`, sous `settings` :

```json
    "backup": "Sauvegarde",
    "backupDisabled": "Sauvegarde serveur désactivée. Rien ne quitte ce navigateur.",
    "backupEnable": "Activer la sauvegarde serveur",
    "backupDisable": "Désactiver",
    "backupNow": "Sauvegarder maintenant",
    "backupRestore": "Restaurer",
    "backupDelete": "Supprimer du serveur",
    "backupLast": "Dernier dépôt le {{date}} ({{size}}).",
    "backupNever": "Aucun dépôt pour l'instant.",
    "backupRecoveryHint": "Notez ce code de récupération : il ne s'affichera plus. Sans lui, la sauvegarde est illisible, y compris pour nous.",
    "backupRecoveryPrompt": "Code de récupération",
    "backupRestoreConfirm": "Restaurer remplace toutes les données de ce navigateur par la sauvegarde du {{date}}. Continuer ?",
    "backupSignedOutHint": "Connectez-vous pour déposer une sauvegarde sur le serveur.",
    "backupExport": "Exporter un fichier",
    "backupImport": "Importer un fichier",
    "backupFileHint": "Le fichier contient tout, y compris votre jeton Flex. Gardez-le comme un mot de passe.",
```

et l'équivalent anglais dans `en.json` (mêmes clés, mêmes interpolations).

- [ ] **Step 4: Écrire `BackupCard.tsx`**

Le composant rend une `Card` avec, dans l'ordre : l'état (activée / désactivée, dernier
dépôt), les boutons serveur — `backupEnable` / `backupDisable`, `backupNow`, `backupRestore`,
`backupDelete` —, le code de récupération affiché une seule fois après une activation, puis
une séparation et les deux boutons de fichier local, `backupExport` et `backupImport`.

Règles de rendu :
- `useSession()` : hors `authenticated`, les boutons serveur sont `disabled` et
  `backupSignedOutHint` s'affiche ; **l'export et l'import de fichier restent actifs**.
- `backupExport` construit le `Blob` par `exportToBlob(db)`, puis déclenche un téléchargement
  par un `<a download={backupFileName(new Date())}>` et `URL.createObjectURL`.
- `backupImport` et la restauration passent tous deux par une confirmation qui nomme ce qui
  va être écrasé (`backupRestoreConfirm`).
- La restauration demande `backupRecoveryPrompt` seulement si `readBackupState` ne rend
  aucune clé sur ce navigateur ; la clé saisie passe par `fromRecoveryCode` puis
  `adoptBackupKey`.
- Les tailles s'affichent en ko/Mo ; une valeur absente reste « — ».

Dans `SettingsPage.tsx`, monter `<BackupCard />` juste après la carte `settings.account`.

- [ ] **Step 5: Lancer les tests, vérifier qu'ils passent**

Depuis `apps/web` : `npx vitest run src/components/settings src/pages/SettingsPage`
Attendu : tout PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "La carte Sauvegarde : serveur chiffré, et fichier local sans compte"
```

---

## Task 12: Documentation et vérification finale

**Files:**
- Modify: `CLAUDE.md`, `docs/points-reportes.md`, `apps/api/README.md`
- Modify: `docs/specs/2026-09-21-compte-serveur-et-sauvegarde-design.md` (statut)

- [ ] **Step 1: Mettre à jour `CLAUDE.md`**

Dans le registre des sous-projets : la ligne 6 devient
`| 6 | Sauvegarde chiffrée et page Paramètres | fondu dans le 25 |`, et une ligne 25 est
ajoutée : `| 25 | Le compte serveur : ce qu'il ouvre, ce qu'il sauvegarde | fait (2026-09-__) |`.

Dans les règles, remplacer toute mention d'un profil par utilisateur par :

```markdown
- **La base locale appartient au navigateur, jamais à un compte** : une seule base
  `ib-analyzer` par origine, connecté ou non. Le compte Django n'ouvre que deux portes, le
  proxy Flex et la sauvegarde chiffrée, et ne touche jamais aux données. Un `DbProvider` qui
  relirait la session ferait réapparaître le bug du 2026-09-21 : session expirée, serveur
  éteint ou simplement lent affichaient un portefeuille vide.
- **La sauvegarde est un blob opaque, opt-in** : `core.Backup` ne stocke que des octets
  chiffrés par le navigateur (AES-GCM 256, clé en IndexedDB hors du paquet, montrée une fois
  comme code de récupération), leur taille et leur date, plafonnés à 20 Mo. Le paquet emporte
  toutes les tables sauf `backup`, `statements` compris. Le dépôt suit les écritures qui
  comptent — `TRIGGER_TABLES`, toutes sauf `snapshots` — jamais les snapshots de l'agent.
```

- [ ] **Step 2: Mettre à jour `docs/points-reportes.md`**

Barrer le point ouvert et le dater :

```markdown
- ~~**La sauvegarde chiffrée du sous-projet 6 doit décider du sort de `db.statements`.**~~ —
  **fermé par le sous-projet 25** (2026-09-21) : les relevés sont dans le paquet, qui est
  compressé en gzip avant chiffrement. Une sauvegarde sans eux rendrait une base non
  reconstructible.
```

Ajouter une section `## Reporté par le sous-projet 25` avec, au minimum, la ligne
« et tout ce que la revue de branche aura relevé ».

- [ ] **Step 3: Mettre à jour `apps/api/README.md`**

Le paragraphe qui demande d'exporter `DJANGO_SECRET_KEY` à la main est remplacé : la clé est
désormais engendrée par checkout dans son dossier git (`config/devkey.py`), et aucune
manipulation n'est requise en développement.

- [ ] **Step 4: Passer le statut de la spec à « implémenté »**

`Statut : implémenté (2026-09-__).` en tête du fichier de spec.

- [ ] **Step 5: Vérification complète**

```bash
pnpm check
pnpm test:api
```

Attendu : les deux vertes. C'est la seule exécution complète du plan — les tâches
précédentes n'ont lancé que des tests ciblés.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Documentation du sous-projet 25"
```

- [ ] **Step 7: Démarrer l'instance de dev du worktree pour la relecture**

```bash
pnpm dev:start
pnpm dev:status
```

Donner les deux URL à Seb. **Ne pas merger** : il regarde la branche avant de décider, et
`pnpm dev:stop` se lance dans le worktree **avant** `git merge` et `git worktree remove`.

---

## Auto-revue du plan

**Couverture de la spec :** §3 → tâche 1. §4 → tâches 2 et 3. §5.1 → tâche 8. §5.2 → tâches
4, 5, 6. §5.3 → tâche 10. §6 → tâche 7. §7 → tâches 4 (remplacement) et 11 (confirmation,
code de récupération). §8 → tâche 11. §9 → tests dans chaque tâche. §11 → tâche 12.

**Cohérence des types :** `BackupPayload` est défini en tâche 4 et consommé tel quel en 5, 7 et
10. `BackupStateRecord` est défini dans `schema.ts` (tâche 6) et réexporté par `state.ts`.
`BackupResult<T>` naît en tâche 9 et sert en tâche 10. `TRIGGER_TABLES` dérive de
`BACKUP_TABLES`, donc une table ajoutée au paquet est déclenchante par défaut — il faut
l'exclure sciemment, ce qui est le bon sens de la règle.

**Point d'attention pour l'exécutant :** la tâche 6 ajoute la version 10 du schéma Dexie.
Deux déclarations divergentes d'une même version corrompent une base existante (voir le
commentaire de la version 5). Si une autre branche a déjà publié une version 10, prendre la
11 et le dire dans le commit.
