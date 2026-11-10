import type { AgentInfo, AgentTokenInfo } from "@shared/agents";
import { SCOPE_INFO } from "@shared/agents";
import { relativeTime } from "@shared/time";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AgentSheet } from "@/components/agents/AgentSheet";
import { EmptyPot } from "@/components/illustrations";
import { PageHeader } from "@/components/shell/PageHeader";
import { ActionBar } from "@/components/ui/ActionBar";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { KeyIcon, PlusIcon } from "@/components/ui/icons";
import { RowSkeleton } from "@/components/ui/Skeleton";
import { agentsQuery, revokeToken, usePendingRevokes } from "@/lib/agents";
import { peopleQuery, sessionQuery } from "@/lib/queries";
import { canEdit, useReadOnly } from "@/lib/read-only";
import { useIsDesktop } from "@/lib/use-media-query";

export const Route = createFileRoute("/_app/agents")({
  component: Agents,
});

type Making = { open: boolean; agent?: AgentInfo };

function Agents() {
  const isDesktop = useIsDesktop();
  const { data: user } = useQuery(sessionQuery);
  const { data: people } = useQuery(peopleQuery);
  const { data: agents, isPending } = useQuery(agentsQuery);
  const readOnly = useReadOnly();
  const [making, setMaking] = useState<Making>({ open: false });
  const owner = people?.find((person) => person.id === user?.id) ?? user ?? undefined;
  const mine = agents?.filter((agent) => agent.ownerId === user?.id) ?? [];
  const open = (agent?: AgentInfo) => canEdit() && setMaking({ open: true, agent });
  const newAgent = (
    <Button variant="primary" icon={PlusIcon} onClick={() => open()} disabled={readOnly}>
      New agent
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Agents"
        subtitle="Helpers that work for you, like Claude or the printer bridge. What they do is marked “via”."
        actions={newAgent}
      />
      {isPending ? (
        <div className="max-w-content flex flex-col gap-3" aria-hidden>
          <RowSkeleton />
          <RowSkeleton />
        </div>
      ) : mine.length ? (
        <ul className="max-w-content flex flex-col gap-4" aria-label="Your agents">
          {mine.map((agent) => (
            <AgentCard key={agent.id} agent={agent} owner={owner} readOnly={readOnly} onAddToken={() => open(agent)} />
          ))}
        </ul>
      ) : (
        <EmptyState
          className="py-10 md:py-20"
          illustration={<EmptyPot />}
          title="No sous-chefs yet"
          action={isDesktop ? newAgent : undefined}
        >
          An agent is a helper with its own keys, like Claude searching your notes or a bridge that watches the printer.
          Each gets only what you allow.
        </EmptyState>
      )}
      {!isDesktop && (
        <ActionBar>
          <Button variant="primary" size="lg" icon={PlusIcon} fullWidth disabled={readOnly} onClick={() => open()}>
            New agent
          </Button>
        </ActionBar>
      )}
      <AgentSheet
        open={making.open}
        agent={making.agent}
        onOpenChange={(next) => setMaking((current) => ({ ...current, open: next }))}
      />
    </>
  );
}

function AgentCard({
  agent,
  owner,
  readOnly,
  onAddToken,
}: {
  agent: AgentInfo;
  owner?: { name: string; color: Parameters<typeof Avatar>[0]["person"]["color"] };
  readOnly: boolean;
  onAddToken: () => void;
}) {
  const live = agent.tokens.filter((token) => !token.revokedAt);
  return (
    <li className="bg-cream shadow-soft flex flex-col gap-4 rounded-lg p-5">
      <div className="flex items-center gap-3.5">
        {owner && <Avatar person={owner} size="md" via={agent.name} />}
        <div className="min-w-0 flex-1">
          <h2 className="text-lead text-ink font-semibold break-words">{agent.name}</h2>
          <p className="text-small text-ink-faint">Acts for {owner?.name.split(" ")[0] ?? "you"}</p>
        </div>
      </div>
      {live.length ? (
        <ul className="flex flex-col" aria-label={`Tokens for ${agent.name}`}>
          {live.map((token) => (
            <TokenRow key={token.id} agent={agent} token={token} readOnly={readOnly} />
          ))}
        </ul>
      ) : (
        <p className="text-small text-ink-faint">No working tokens. Make one when it's needed.</p>
      )}
      <Button variant="quiet" size="sm" icon={KeyIcon} onClick={onAddToken} disabled={readOnly} className="self-start">
        New token
      </Button>
    </li>
  );
}

function TokenRow({ agent, token, readOnly }: { agent: AgentInfo; token: AgentTokenInfo; readOnly: boolean }) {
  const queryClient = useQueryClient();
  const revoking = usePendingRevokes().has(token.id);
  return (
    <li className="border-ink/6 flex flex-col gap-2 border-t py-3 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-3">
        <span className="text-small text-ink-soft font-mono">{token.prefix}…</span>
        <span className="text-small text-ink-faint flex-1">
          {revoking
            ? "Revoked"
            : token.lastUsedAt
              ? `Used ${relativeTime(token.lastUsedAt).toLowerCase()}`
              : "Never used"}
        </span>
        <Button
          variant="quiet"
          size="sm"
          disabled={readOnly || revoking}
          onClick={() => revokeToken(queryClient, agent, token)}
          aria-label={`Revoke ${token.prefix}`}
        >
          Revoke
        </Button>
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label="Scopes">
        {token.scopes.map((scope) => (
          <li key={scope}>
            <Chip>{SCOPE_INFO[scope].label}</Chip>
          </li>
        ))}
      </ul>
    </li>
  );
}
