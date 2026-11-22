import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RefObject } from "react";
import { ActionMenu, ActionMenuItem } from "@/components/ui/ActionMenu";
import { Avatar } from "@/components/ui/Avatar";
import { PrinterMark } from "@/components/ui/PrinterMark";
import { peopleQuery, sessionQuery } from "@/lib/queries";
import { sayWhoStarted } from "@/lib/started-by";
import { useWho } from "@/lib/who";

interface WhoStartedProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The byline it was opened from: the popover hangs from it on desktop, and focus goes back to it. */
  anchor: RefObject<HTMLButtonElement | null>;
  itemId: string;
  attemptId: string;
  startedBy: string | null;
}

/**
 * "Who started it?" for a print from the printer (decision 0076): the two of you, you first, and once someone is
 * named, "Just the printer" to take it back. A tap says it and closes; the toast has Undo.
 */
export default function WhoStarted({ open, onOpenChange, anchor, itemId, attemptId, startedBy }: WhoStartedProps) {
  const queryClient = useQueryClient();
  const { data: people = [] } = useQuery(peopleQuery);
  const { data: me } = useQuery(sessionQuery);
  const who = useWho();
  const ordered = [...people].sort((a, b) => Number(b.id === me?.id) - Number(a.id === me?.id));
  const say = (id: string | null, said: string) =>
    sayWhoStarted(queryClient, { itemId, attemptId, before: startedBy, who: id, said });
  return (
    <ActionMenu
      open={open}
      onOpenChange={onOpenChange}
      title="Who started it?"
      description="The printer can't tell. Only this print changes."
      anchor={anchor}
      returnFocus={anchor}
      titled
      align="end"
    >
      {ordered.map((person) => {
        const name = who(person) ?? person.name;
        return (
          <ActionMenuItem
            key={person.id}
            picture={<Avatar person={person} size="sm" decorative />}
            current={startedBy === person.id}
            onSelect={() => say(person.id, `Started by ${name === "You" ? "you" : name}`)}
          >
            {name}
          </ActionMenuItem>
        );
      })}
      {startedBy && (
        <ActionMenuItem picture={<PrinterMark size="sm" decorative />} onSelect={() => say(null, "Just the printer's")}>
          Just the printer
        </ActionMenuItem>
      )}
    </ActionMenu>
  );
}
