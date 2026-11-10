import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { IdeaCard, type UpNextMenu } from "@/components/ideas/IdeaCard";
import { EmptyPot } from "@/components/illustrations";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PlusIcon } from "@/components/ui/icons";
import { Section } from "@/components/ui/Section";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useVia } from "@/lib/agents";
import { useCapture } from "@/lib/capture";
import { shortcutCaps } from "@/lib/hotkeys";
import { useIdeas } from "@/lib/items";
import { useArrived } from "@/lib/live";
import { peopleQuery } from "@/lib/queries";
import { dropUpNext, moveUpNext, setUpNext, splitQueue } from "@/lib/up-next";
import { useIsDesktop } from "@/lib/use-media-query";

export const Route = createFileRoute("/_app/ideas/")({
  component: Ideas,
});

/** The grid both pages of ideas share: two columns on phones, more on desktop. */
const grid = "grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 xl:grid-cols-4";

function Ideas() {
  const { items, isPending, error, refetch } = useIdeas();
  const { data: people } = useQuery(peopleQuery);
  const { landed } = useCapture();
  const arrived = useArrived();
  const via = useVia();
  const byId = new Map(people?.map((person) => [person.id, person]));
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const { queue, rest } = splitQueue(items);
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const menuFor = (item: (typeof items)[number], index: number): UpNextMenu => ({
    queued: index >= 0,
    onToggle: () => setUpNext(queryClient, item, index < 0),
    onMoveUp: index > 0 ? () => moveUpNext(queryClient, queue, item.id, -1) : undefined,
    onMoveDown: index >= 0 && index < queue.length - 1 ? () => moveUpNext(queryClient, queue, item.id, 1) : undefined,
  });
  const card = (item: (typeof items)[number], index: number) => (
    <IdeaCard
      key={item.id}
      item={item}
      person={byId.get(item.createdBy)}
      via={via(item.createdVia)}
      landing={item.id === landed || arrived.has(item.id)}
      headingLevel={queue.length > 0 ? 3 : 2}
      menu={menuFor(item, index)}
      drag={
        isDesktop && index >= 0 && queue.length > 1
          ? {
              dragging: dragged === item.id,
              over: over === item.id && dragged !== item.id,
              onDragStart: () => setDragged(item.id),
              onDragEnd: () => {
                setDragged(null);
                setOver(null);
              },
              onDragOver: () => setOver(item.id),
              onDrop: () => {
                if (dragged) dropUpNext(queryClient, queue, dragged, item.id);
                setDragged(null);
                setOver(null);
              },
            }
          : undefined
      }
    />
  );

  return (
    <>
      <PageHeader title="Ideas" subtitle="The inbox. Every print starts as a half-thought." />
      {isPending ? (
        <div className={grid} aria-hidden>
          {Array.from({ length: 8 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
            <CardSkeleton key={index} aspect="portrait" />
          ))}
        </div>
      ) : items.length ? (
        <>
          {queue.length > 0 && (
            <Section id="up-next-heading" title="Up next" count={queue.length} className="mb-12 md:mb-16">
              <ul className={grid} aria-label="Up next">
                {queue.map((item, index) => card(item, index))}
              </ul>
            </Section>
          )}
          {rest.length > 0 &&
            (queue.length > 0 ? (
              <Section id="inbox-heading" title="The rest">
                <ul className={grid} aria-label="Ideas">
                  {rest.map((item) => card(item, -1))}
                </ul>
              </Section>
            ) : (
              <ul className={grid} aria-label="Ideas">
                {rest.map((item) => card(item, -1))}
              </ul>
            ))}
        </>
      ) : error ? (
        <IdeasUnreachable onRetry={() => void refetch()} />
      ) : (
        <IdeasEmpty />
      )}
    </>
  );
}

/** The server can't be reached and there is nothing to show yet. The offline strip above says why. */
function IdeasUnreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      className="py-10 md:py-20"
      illustration={<EmptyPot />}
      title="The pot is out of reach"
      action={
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      Your ideas will be here when the connection is back. Anything you capture meanwhile is kept on this device.
    </EmptyState>
  );
}

function IdeasEmpty() {
  const { setOpen } = useCapture();
  // On desktop the sidebar's "New idea" is the screen's one primary action.
  const isDesktop = useIsDesktop();
  return (
    <EmptyState
      className="py-10 md:py-20"
      illustration={<EmptyPot />}
      title="Nothing simmering yet"
      action={
        <Button
          variant={isDesktop ? "secondary" : "primary"}
          icon={PlusIcon}
          shortcut={shortcutCaps("capture")}
          onClick={() => setOpen(true)}
        >
          Capture an idea
        </Button>
      }
    >
      Snap a photo of something that could be printed, or jot down a line. Titles can wait; tidy up later.
    </EmptyState>
  );
}
