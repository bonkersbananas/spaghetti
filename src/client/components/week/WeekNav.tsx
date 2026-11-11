import { addWeeks, mondayOf } from "@shared/week";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/Button";
import { NextIcon, PreviousIcon } from "@/components/ui/icons";
import { shortcutCaps } from "@/lib/hotkeys";

interface WeekNavProps {
  monday: string;
  /** Another week's page opens when this one is the current week and "next" would be the future. */
  className?: string;
}

/**
 * Previous and next week, a thumb's reach apart on a phone and a key press on a keyboard (← and →, bound by the
 * page). The weeks after this one aren't there yet, so "Next" rests on the current week.
 */
export function WeekNav({ monday }: WeekNavProps) {
  const navigate = useNavigate();
  const hasNext = monday < mondayOf(Date.now());
  const go = (to: string) => void navigate({ to: "/week/$monday", params: { monday: to } });
  return (
    <nav aria-label="Weeks" className="flex items-center justify-between gap-3">
      <Button
        variant="secondary"
        icon={PreviousIcon}
        shortcut={shortcutCaps("weekPrevious")}
        onClick={() => go(addWeeks(monday, -1))}
      >
        Previous
      </Button>
      {hasNext ? (
        <Button variant="secondary" shortcut={shortcutCaps("weekNext")} onClick={() => go(addWeeks(monday, 1))}>
          Next
          <NextIcon size={20} weight="bold" aria-hidden />
        </Button>
      ) : (
        <span />
      )}
    </nav>
  );
}
