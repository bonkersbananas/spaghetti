import { printProgress } from "@shared/print-progress";
import { Link, useLocation } from "@tanstack/react-router";
import { AnimatePresence, m } from "motion/react";
import { useMemo } from "react";
import { BuildsIcon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/Photo";
import { PrintProgress } from "@/components/ui/PrintProgress";
import { heroPhoto, printingAttempts } from "@/lib/builds";
import { type AttemptView, type ItemView, useBuilds } from "@/lib/items";
import { duration, ease } from "@/lib/motion";
import { photoSrc } from "@/lib/previews";
import { useNow } from "@/lib/use-now";
import { itemName } from "../journal/JournalEntry";

/** "45 min left", "Done by now", "On the bed": the progress sentence, short enough for a sidebar. */
function shortLabel(startedAt: number, estimatedMinutes: number | undefined, now: number): string {
  const { state, label } = printProgress(startedAt, estimatedMinutes, now);
  if (state === "due") return "Done by now";
  if (state === "unknown") return "On the bed";
  return label.replace(/^About /, "");
}

interface NowPrintingCardProps {
  item: ItemView;
  attempt: AttemptView;
  now: number;
}

/** The sidebar's small card: a thumbnail, the build's name, a ring and a few words on how far along it is. */
export function NowPrintingCard({ item, attempt, now }: NowPrintingCardProps) {
  const hero = heroPhoto(item);
  return (
    <Link
      to="/builds/$buildId"
      params={{ buildId: item.id }}
      search={{ attempt: attempt.id }}
      className="bg-cream shadow-soft hover:shadow-raised pressable focus-ring flex items-center gap-2.5 rounded-md p-2"
    >
      {hero ? (
        <Photo
          src={photoSrc(hero.id, "thumb")}
          alt=""
          color={hero.color || undefined}
          className="size-9 shrink-0 rounded-sm"
        />
      ) : (
        <span className="bg-ink/5 text-ink-faint flex size-9 shrink-0 items-center justify-center rounded-sm">
          <BuildsIcon size={18} aria-hidden />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-small text-ink truncate font-semibold">{itemName(item).text}</span>
        <span className="text-caption text-ink-faint tabular flex items-center gap-1.5">
          <PrintProgress
            variant="ring"
            startedAt={attempt.printedAt}
            estimatedMinutes={attempt.settings.estimatedMinutes}
          />
          {shortLabel(attempt.printedAt, attempt.settings.estimatedMinutes, now)}
        </span>
      </span>
    </Link>
  );
}

/**
 * The print on the bed, at the foot of the sidebar: what it is and how far along, one click from its
 * build. With several, the one that should be done by now comes first and "and 1 more" leads to Today.
 * Hidden on Today, which shows every print in full.
 */
export function NowPrinting() {
  const { items } = useBuilds();
  const now = useNow();
  const onToday = useLocation({ select: (location) => location.pathname === "/today" });
  const printing = useMemo(() => printingAttempts(items, now), [items, now]);
  const first = printing[0];
  const show = !!first && !onToday;

  return (
    <AnimatePresence initial={false}>
      {show && first && (
        <m.div
          key="now-printing"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: duration.base, ease: ease.out }}
          className="mb-3 flex flex-col gap-1.5"
        >
          <NowPrintingCard item={first.item} attempt={first.attempt} now={now} />
          {printing.length > 1 && (
            <Link
              to="/today"
              className="text-caption text-ink-faint hover:text-ink-soft focus-ring rounded-xs px-2 font-medium"
            >
              and {printing.length - 1} more
            </Link>
          )}
        </m.div>
      )}
    </AnimatePresence>
  );
}
