import { isOffTheBed } from "@shared/print-progress";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { AnimatePresence, m } from "motion/react";
import { useMemo } from "react";
import { BuildsIcon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/Photo";
import { PrintProgress } from "@/components/ui/PrintProgress";
import { heroPhoto, printingAttempts } from "@/lib/builds";
import { type AttemptView, type ItemView, useBuilds } from "@/lib/items";
import { duration, ease } from "@/lib/motion";
import { printerQuery } from "@/lib/pantry-queries";
import { fileThumbSrc, photoSrc } from "@/lib/previews";
import { usePrintProgress } from "@/lib/print-progress";
import { useIsDesktop } from "@/lib/use-media-query";
import { useNow } from "@/lib/use-now";
import { itemName } from "../journal/JournalEntry";

/** "45 min left", "Done by now", "On the bed": the progress sentence, short enough for a sidebar. */
function shortLabel(progress: { state: string; label: string }): string {
  if (progress.state === "due") return "Done by now";
  if (progress.state === "unknown") return "On the bed";
  // The printer's own words ("Layer 112 of 240 · about 38 min left") shrink to the part about time.
  return (progress.label.split(" · ").at(-1) ?? progress.label).replace(/^[Aa]bout /, "");
}

interface NowPrintingCardProps {
  item: ItemView;
  attempt: AttemptView;
}

/** The sidebar's small card: a thumbnail, the build's name, a ring and a few words on how far along it is. */
export function NowPrintingCard({ item, attempt }: NowPrintingCardProps) {
  const progress = usePrintProgress(attempt.id, attempt.printedAt, attempt.settings.estimatedMinutes);
  const offBed = isOffTheBed(attempt);
  const hero = heroPhoto(item);
  const plate = !hero && attempt.file?.hasThumb ? attempt.file : undefined;
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
      ) : plate ? (
        <Photo src={fileThumbSrc(plate.id)} alt="" fit="contain" className="size-9 shrink-0 rounded-sm p-0.5" />
      ) : (
        <span className="bg-ink/5 text-ink-faint flex size-9 shrink-0 items-center justify-center rounded-sm">
          <BuildsIcon size={18} aria-hidden />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-small text-ink truncate font-semibold">{itemName(item).text}</span>
        <span className="text-caption text-ink-faint tabular flex items-center gap-1.5">
          {offBed ? (
            "Off the bed · how did it go?"
          ) : (
            <>
              <PrintProgress
                variant="ring"
                startedAt={attempt.printedAt}
                estimatedMinutes={attempt.settings.estimatedMinutes}
                attemptId={attempt.id}
              />
              {shortLabel(progress)}
            </>
          )}
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
  // The sidebar is for desktop; on a phone its words would only sit hidden in the page.
  const isDesktop = useIsDesktop();
  const onToday = useLocation({ select: (location) => location.pathname === "/today" });
  // Ranked by what the printer says when the bridge reports, as Today and the card's own progress do.
  const live = useQuery(printerQuery).data?.bridge?.progress;
  const printing = useMemo(() => printingAttempts(items, now, live), [items, now, live]);
  const first = printing[0];
  const show = !!first && !onToday && isDesktop;

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
          <NowPrintingCard item={first.item} attempt={first.attempt} />
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
