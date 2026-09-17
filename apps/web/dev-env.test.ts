import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_PORT, portsFor, worktreeName, worktreeSlot } from "../../tools/dev-env/ports.mjs";

describe("portsFor", () => {
  it("keeps the historical ports at the repository root", () => {
    expect(portsFor(null, 0, {})).toEqual({
      worktree: null,
      slot: 0,
      web: 5173,
      api: 8000,
      database: "ib_analyzer",
      databaseUrl: "postgres://ib:ib@127.0.0.1:5432/ib_analyzer",
    });
  });

  it("puts a worktree one port above the root per slot, with a database named after it", () => {
    expect(portsFor("dev-ports", 1, {})).toEqual({
      worktree: "dev-ports",
      slot: 1,
      web: 5174,
      api: 8001,
      database: "ib_analyzer_dev_ports",
      databaseUrl: "postgres://ib:ib@127.0.0.1:5432/ib_analyzer_dev_ports",
    });
    expect(portsFor("Sauvegarde.Chiffree", 2, {})).toMatchObject({ web: 5175, api: 8002, database: "ib_analyzer_sauvegarde_chiffree" });
  });

  it("never hands the agent's port to Django", () => {
    expect(portsFor("x", 99, {}).api).toBeLessThan(AGENT_PORT);
    expect(() => portsFor("x", 100, {})).toThrow(/slot/);
  });

  it("lets the environment override every value", () => {
    const p = portsFor("dev-ports", 1, {
      WEB_PORT: "6000",
      API_PORT: "9000",
      DATABASE_URL: "postgres://x:y@db:1/z",
    });
    expect(p).toMatchObject({ web: 6000, api: 9000, database: "z", databaseUrl: "postgres://x:y@db:1/z" });
  });

  it("rejects a port that is not a number", () => {
    expect(() => portsFor(null, 0, { WEB_PORT: "abc" })).toThrow(/WEB_PORT/);
  });
});

describe("worktreeName", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is null when .git is a directory (the main checkout)", () => {
    dir = mkdtempSync(join(tmpdir(), "root-"));
    mkdirSync(join(dir, ".git"));
    expect(worktreeName(dir)).toBeNull();
  });

  it("is the directory name when .git is a file (a linked worktree)", () => {
    dir = mkdtempSync(join(tmpdir(), "wt-"));
    const root = join(dir, "dev-ports");
    mkdirSync(root);
    writeFileSync(join(root, ".git"), "gitdir: /somewhere/.git/worktrees/dev-ports\n");
    expect(worktreeName(root)).toBe("dev-ports");
  });
});

describe("worktreeSlot", () => {
  let dir: string;
  let repo: string;
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  const add = (name: string) => {
    const path = join(repo, ".claude", "worktrees", name);
    git("worktree", "add", "-q", "-b", name, path);
    return path;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "slots-"));
    repo = join(dir, "repo");
    mkdirSync(repo);
    git("init", "-q");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is 0 in the main checkout", () => {
    expect(worktreeSlot(repo)).toBe(0);
  });

  it("numbers worktrees 1, 2… in the order they first ask, and keeps each one's number", () => {
    const a = add("a");
    const b = add("b");
    expect(worktreeSlot(b)).toBe(1);
    expect(worktreeSlot(a)).toBe(2);
    expect(worktreeSlot(b)).toBe(1);
    expect(worktreeSlot(a)).toBe(2);
  });

  it("hands a removed worktree's number to the next one, without moving the others", () => {
    const a = add("a");
    const b = add("b");
    expect(worktreeSlot(a)).toBe(1);
    expect(worktreeSlot(b)).toBe(2);
    git("worktree", "remove", a);
    const c = add("c");
    expect(worktreeSlot(c)).toBe(1);
    expect(worktreeSlot(b)).toBe(2);
  });

  it("frees the number of a worktree deleted by hand, before git prunes it", () => {
    const a = add("a");
    expect(worktreeSlot(a)).toBe(1);
    rmSync(a, { recursive: true, force: true });
    expect(worktreeSlot(add("b"))).toBe(1);
  });
});
