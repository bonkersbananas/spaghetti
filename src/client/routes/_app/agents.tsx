import type { AgentInfo, AgentTokenInfo } from "@shared/agents";
import { SCOPE_INFO } from "@shared/agents";
import type { PersonColor } from "@shared/people";
import { displayName } from "@shared/people";
import { relativeTime } from "@shared/time";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { AgentSheet } from "@/components/agents/AgentSheet";
import { ShareCard } from "@/components/agents/ShareCard";
import { EmptyPot } from "@/components/illustrations";
import { PageHeader } from "@/components/shell/PageHeader";
import { AgentAvatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { KeyIcon, PlusIcon } from "@/components/ui/icons";
import { RowSkeleton } from "@/components/ui/Skeleton";
import { agentsQuery, disconnectApp, revokeToken, usePendingRevokes } from "@/lib/agents";
import { peopleQuery, sessionQuery } from "@/lib/queries";
import { canEdit, useReadOnly } from "@/lib/read-only";
import { useIsDesktop } from "@/lib/use-media-query";

// Webhooks and their sheet load on their own, after the page: the Agents screen's first load stays as it was.
const Webhooks = lazy(() => import("@/components/agents/Webhooks"));

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
  // An app that was disconnected stays in the list for "via Claude" in the journal, but not here.
  const mine = agents?.filter((agent) => agent.ownerId === user?.id && agent.connection?.connected !== false) ?? [];
  const open = (agent?: AgentInfo) => canEdit() && setMaking({ open: true, agent });
  const newAgent = (
    <Button variant="secondary" icon={PlusIcon} onClick={() => open()} disabled={readOnly}>
      New agent
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Agents"
        subtitle="Claude, the printer bridge and other helpers."
        // The empty state carries its own button.
        actions={!isPending && !mine.length ? undefined : newAgent}
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
          className="py-6 md:py-12"
          illustration={<EmptyPot />}
          title="No sous-chefs in the kitchen yet"
          action={newAgent}
        >
          A helper with a key of its own, such as Claude or a bridge at home, that does only what you allow.
        </EmptyState>
      )}
      {/* On a phone the header has no room for it: it follows the last agent, in the page, not floating over it. */}
      {!isDesktop && mine.length > 0 && (
        <div className="max-w-content mt-4">
          <Button variant="secondary" icon={PlusIcon} fullWidth onClick={() => open()} disabled={readOnly}>
            New agent
          </Button>
        </div>
      )}
      <ShareCard />
      <div className="mt-12 md:mt-16">
        <Suspense fallback={<div aria-hidden className="h-24" />}>
          <Webhooks agents={mine} />
        </Suspense>
      </div>
      <p className="text-small text-ink-faint mt-12 md:mt-16">
        <a
          href="/api/openapi.json"
          target="_blank"
          rel="noreferrer"
          className="focus-ring text-ink-soft decoration-ink/30 font-semibold underline underline-offset-2"
        >
          API reference
        </a>
        : what a token can do, as OpenAPI.
      </p>
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
  owner?: { name: string; color: PersonColor };
  readOnly: boolean;
  onAddToken: () => void;
}) {
  const live = agent.tokens.filter((token) => !token.revokedAt);
  if (agent.connection) return <ConnectedCard agent={agent} owner={owner} readOnly={readOnly} />;
  return (
    <li className="bg-cream shadow-soft flex flex-col gap-4 rounded-lg p-5">
      <div className="flex items-center gap-3.5">
        {owner && <AgentAvatar name={agent.name} owner={owner} size="lg" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-lead text-ink font-semibold break-words">{agent.name}</h2>
          <p className="text-small text-ink-faint">Acts for {displayName(owner, "you")}</p>
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
    <li className="border-ink/6 flex flex-wrap items-center gap-x-3 gap-y-2 border-t py-3 first:border-t-0 first:pt-0 last:pb-0">
      <span className="text-small text-ink-soft font-mono">{token.prefix}…</span>
      {/* One quiet row from tablet width up; on a phone the scopes take the line below. */}
      <ul
        className="order-last flex basis-full flex-wrap gap-1.5 md:order-none md:flex-1 md:basis-auto"
        aria-label="Scopes"
      >
        {token.scopes.map((scope) => (
          <li key={scope}>
            <Chip>{SCOPE_INFO[scope].label}</Chip>
          </li>
        ))}
      </ul>
      <span className="text-small text-ink-faint max-md:flex-1">
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
    </li>
  );
}

/** An app that signed in with OAuth (Claude's own apps): one connection, with what it may do and one way to end it. */
function ConnectedCard({
  agent,
  owner,
  readOnly,
}: {
  agent: AgentInfo;
  owner?: { name: string; color: PersonColor };
  readOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const ending = usePendingRevokes().has(agent.id);
  const connection = agent.connection;
  if (!connection) return null;
  return (
    <li className="bg-cream shadow-soft flex flex-col gap-4 rounded-lg p-5">
      <div className="flex items-center gap-3.5">
        {owner && <AgentAvatar name={agent.name} owner={owner} size="lg" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-lead text-ink font-semibold break-words">{agent.name}</h2>
          <p className="text-small text-ink-faint">Signed in with {connection.app}</p>
        </div>
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label="Scopes">
        {connection.scopes.map((scope) => (
          <li key={scope}>
            <Chip>{SCOPE_INFO[scope].label}</Chip>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-small text-ink-faint flex-1">
          {ending
            ? "Disconnected"
            : connection.lastUsedAt
              ? `Used ${relativeTime(connection.lastUsedAt).toLowerCase()}`
              : "Not used yet"}
        </span>
        <Button
          variant="quiet"
          size="sm"
          disabled={readOnly || ending}
          onClick={() => disconnectApp(queryClient, agent)}
          aria-label={`Disconnect ${agent.name}`}
        >
          Disconnect
        </Button>
      </div>
    </li>
  );
}
