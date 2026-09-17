import { useEffect, useState } from "react";

/** Written next to the wheel by apps/tws-agent/scripts/write_index.py at image build time. */
export interface AgentIndex {
  version: string;
  filename: string;
}

export async function fetchAgentIndex(origin: string): Promise<AgentIndex | null> {
  try {
    const response = await fetch(`${origin}/agent/index.json`, { cache: "no-cache" });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return null;
    const { version, filename } = body as { version?: unknown; filename?: unknown };
    return typeof version === "string" && typeof filename === "string" ? { version, filename } : null;
  } catch {
    return null;
  }
}

export type AgentIndexState = { status: "loading" } | { status: "ok"; index: AgentIndex } | { status: "unavailable" };

export function useAgentIndex(origin: string): AgentIndexState {
  const [state, setState] = useState<AgentIndexState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    void fetchAgentIndex(origin).then((index) => {
      if (!cancelled) setState(index ? { status: "ok", index } : { status: "unavailable" });
    });
    return () => {
      cancelled = true;
    };
  }, [origin]);
  return state;
}
