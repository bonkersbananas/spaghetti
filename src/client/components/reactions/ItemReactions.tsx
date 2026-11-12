import { displayName } from "@shared/people";
import type { Reaction, ReactionKind } from "@shared/reactions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AddReactionButton, ReactionPicker, ReactionPills } from "@/components/ui/Message";
import { Popover } from "@/components/ui/Popover";
import { Sheet } from "@/components/ui/Sheet";
import { peopleQuery, sessionQuery } from "@/lib/queries";
import { reactToItem } from "@/lib/reactions";
import { useIsDesktop } from "@/lib/use-media-query";

interface ItemReactionsProps {
  itemId: string;
  reactions: readonly Reaction[] | undefined;
  /** "idea" or "build": what the picker's title calls it. */
  noun: string;
  readOnly: boolean;
  className?: string;
}

/**
 * How the two of you feel about an idea or build: the reactions given, then a quiet smiley to add one. A pill's tap
 * gives the same one or takes yours back; the smiley opens the curated set (a small menu on desktop, a sheet on phones).
 */
export default function ItemReactions({ itemId, reactions, noun, readOnly, className }: ItemReactionsProps) {
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const { data: me } = useQuery(sessionQuery);
  const { data: people } = useQuery(peopleQuery);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const nameOf = (id: string) =>
    displayName(
      people?.find((person) => person.id === id),
      "Someone",
    );
  const react = (kind: ReactionKind) => me && reactToItem(queryClient, itemId, kind, me.id);
  const given = new Set((reactions ?? []).filter((r) => r.userId === me?.id).map((r) => r.kind));
  const disabled = readOnly || !me;
  const title = `React to this ${noun}`;

  const button = (
    <AddReactionButton label={title} disabled={disabled} onClick={isDesktop ? undefined : () => setSheetOpen(true)} />
  );
  return (
    <ReactionPills
      reactions={reactions}
      me={me?.id}
      nameOf={nameOf}
      onToggle={react}
      disabled={disabled}
      className={className}
    >
      {isDesktop ? (
        <Popover
          label={title}
          side="bottom"
          align="start"
          className="w-auto p-1.5"
          trigger={button}
          open={menuOpen}
          onOpenChange={setMenuOpen}
        >
          <ReactionPicker
            compact
            given={given}
            onPick={(kind) => {
              react(kind);
              setMenuOpen(false);
            }}
          />
        </Popover>
      ) : (
        <>
          {button}
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title={title}>
            <ReactionPicker
              given={given}
              onPick={(kind) => {
                react(kind);
                setSheetOpen(false);
              }}
            />
          </Sheet>
        </>
      )}
    </ReactionPills>
  );
}
