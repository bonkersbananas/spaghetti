import type { AgentInfo, AgentScope, AgentsResponse, AgentTokenInfo, NewTokenResponse } from "@shared/agents";
import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { canEdit } from "./read-only";

/** Every agent (so "via Claude for Alex" can be said), with tokens only for the signed-in person's own. */
export const agentsQuery = queryOptions({
  queryKey: ["agents"] as const,
  queryFn: async () => (await api<AgentsResponse>("/agents")).agents,
  staleTime: 5 * 60 * 1000,
});

/** Looks up an agent's name for "via …": `via(item.createdVia)`. Undefined for a person's own work (or an agent not known yet). */
export function useVia(): (agentId: string | null | undefined) => string | undefined {
  const { data } = useQuery(agentsQuery);
  return useCallback((agentId) => (agentId ? data?.find((agent) => agent.id === agentId)?.name : undefined), [data]);
}

const withAgent = (queryClient: QueryClient, agent: AgentInfo) =>
  queryClient.setQueryData<AgentInfo[]>(agentsQuery.queryKey, (agents) =>
    agents ? [...agents.filter((existing) => existing.id !== agent.id), agent] : [agent],
  );

/** Makes an agent with its first token. The token comes back once: show it, then it is gone. */
export async function createAgent(queryClient: QueryClient, input: { name: string; scopes: AgentScope[] }) {
  const made = await api<NewTokenResponse>("/agents", { method: "POST", json: { id: crypto.randomUUID(), ...input } });
  withAgent(queryClient, made.agent);
  return made;
}

/** Another token for an existing agent. */
export async function addToken(queryClient: QueryClient, agentId: string, scopes: AgentScope[]) {
  const made = await api<NewTokenResponse>(`/agents/${agentId}/tokens`, { method: "POST", json: { scopes } });
  withAgent(queryClient, made.agent);
  return made;
}

// --- revoking: undo first, then it takes effect ---------------------------------------------------

/** How long Undo stays: the token keeps working until this has passed. */
export const REVOKE_UNDO_MS = 6000;

interface PendingRevoke {
  agentId: string;
  /** The token's id; for an app connected by OAuth, the agent's own id, and the whole connection ends. */
  tokenId: string;
  connection?: boolean;
  timer: ReturnType<typeof setTimeout>;
}
const pending = new Map<string, PendingRevoke>();
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> = new Set();
const publish = () => {
  snapshot = new Set(pending.keys());
  for (const listener of listeners) listener();
};

/** Ids of tokens whose revoke is waiting out its Undo. */
export function usePendingRevokes(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot,
  );
}

function send(entry: PendingRevoke, options: RequestInit = {}) {
  const path = entry.connection
    ? `/agents/${entry.agentId}/connection`
    : `/agents/${entry.agentId}/tokens/${entry.tokenId}`;
  return api(path, { method: "DELETE", ...options });
}

/** Someone leaving the page during the Undo meant it: send what is waiting. */
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    for (const entry of pending.values()) void send(entry, { keepalive: true }).catch(() => undefined);
  });
}

/**
 * Revokes a token the house way: at once it reads as revoked and an Undo toast
 * appears, but the token only stops working when the toast is gone.
 */
export function revokeToken(queryClient: QueryClient, agent: AgentInfo, token: AgentTokenInfo) {
  if (!canEdit() || pending.has(token.id)) return;
  const entry: PendingRevoke = {
    agentId: agent.id,
    tokenId: token.id,
    timer: setTimeout(async () => {
      try {
        await send(entry);
      } catch {
        toast.error("Couldn't revoke that token", "It still works. Try again in a moment.");
      } finally {
        pending.delete(token.id);
        publish();
        void queryClient.invalidateQueries({ queryKey: agentsQuery.queryKey });
      }
    }, REVOKE_UNDO_MS),
  };
  pending.set(token.id, entry);
  publish();
  toast.undo("Token revoked", {
    description: `${agent.name} · ${token.prefix}…`,
    duration: REVOKE_UNDO_MS,
    onUndo: () => {
      clearTimeout(entry.timer);
      pending.delete(token.id);
      publish();
    },
  });
}

/** Disconnects an app that signed in with OAuth, the same way: it reads as disconnected now and ends after the Undo. */
export function disconnectApp(queryClient: QueryClient, agent: AgentInfo) {
  if (!canEdit() || pending.has(agent.id)) return;
  const entry: PendingRevoke = {
    agentId: agent.id,
    tokenId: agent.id,
    connection: true,
    timer: setTimeout(async () => {
      try {
        await send(entry);
      } catch {
        toast.error("Couldn't disconnect that app", "It is still connected. Try again in a moment.");
      } finally {
        pending.delete(agent.id);
        publish();
        void queryClient.invalidateQueries({ queryKey: agentsQuery.queryKey });
      }
    }, REVOKE_UNDO_MS),
  };
  pending.set(agent.id, entry);
  publish();
  toast.undo("App disconnected", {
    description: agent.name,
    duration: REVOKE_UNDO_MS,
    onUndo: () => {
      clearTimeout(entry.timer);
      pending.delete(agent.id);
      publish();
    },
  });
}
