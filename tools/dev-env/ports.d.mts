export interface DevPorts {
  /** Directory name of the linked worktree, null in the main checkout. */
  worktree: string | null;
  /** 0 in the main checkout, 1, 2… per live worktree: the ports sit this far above the root's. */
  slot: number;
  /** Vite dev server port. */
  web: number;
  /** Django dev server port, target of the Vite proxy. */
  api: number;
  /** PostgreSQL database name (the test database is `test_` + this). */
  database: string;
  databaseUrl: string;
}

export const REPO_ROOT: string;
export const ROOT_WEB_PORT: 5173;
export const ROOT_API_PORT: 8000;
export const AGENT_PORT: 8100;

export function worktreeName(root: string): string | null;
export function checkoutGitDir(root: string): string;
export function worktreeSlot(root: string): number;
export function portsFor(worktree: string | null, slot: number, env: NodeJS.ProcessEnv): DevPorts;
export function devPorts(root?: string, env?: NodeJS.ProcessEnv): DevPorts;
export function describePorts(p: DevPorts): string;
