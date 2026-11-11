import { OUTCOME_LABELS, tagLabel } from "@shared/attempts";
import { relativeTime } from "@shared/time";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { lastActivity } from "@/components/builds/BuildCard";
import { OutcomeStrip } from "@/components/builds/OutcomeStrip";
import { itemName } from "@/components/journal/JournalEntry";
import { Button } from "@/components/ui/Button";
import { BuildsIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { Photo } from "@/components/ui/Photo";
import { Section } from "@/components/ui/Section";
import { heroPhoto, useTagOptions } from "@/lib/builds";
import { cn } from "@/lib/cn";
import type { ItemView } from "@/lib/items";
import { duration, ease, spring } from "@/lib/motion";
import { photoSrc } from "@/lib/previews";

const MOST = 4;

const outcomeInk = { success: "text-basil-ink", partial: "text-semolina-ink", failed: "text-tomato-ink" } as const;

/** Builds in progress with nothing printing, the ones touched most recently first. */
export function pickUpAgain(builds: ItemView[]): ItemView[] {
  return builds
    .filter((build) => build.stage === "building" && !build.attempts.some((attempt) => attempt.outcome === null))
    .sort((a, b) => lastActivity(b) - lastActivity(a));
}

function Row({ item }: { item: ItemView }) {
  const failureOptions = useTagOptions("failure");
  const hero = heroPhoto(item);
  const last = item.attempts.at(-1);
  const name = itemName(item);
  const tag = last?.failureTags[0];
  return (
    <Link
      to="/builds/$buildId"
      params={{ buildId: item.id }}
      className="pressable focus-ring hover:bg-ink/4 -mx-1.5 flex items-center gap-3.5 rounded-lg p-1.5"
    >
      {hero ? (
        <Photo
          src={photoSrc(hero.id, "thumb")}
          alt=""
          color={hero.color || undefined}
          className="size-12 shrink-0 rounded-md"
        />
      ) : (
        <span className="bg-ink/5 text-ink-faint flex size-12 shrink-0 items-center justify-center rounded-md">
          <BuildsIcon size={22} aria-hidden />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn("text-body truncate", name.titled ? "text-ink font-semibold" : "text-ink-soft font-medium")}
        >
          {name.text}
        </span>
        <MetaList className="text-small text-ink-faint">
          {last?.outcome ? (
            <span className={cn("font-semibold", outcomeInk[last.outcome])}>{OUTCOME_LABELS[last.outcome]}</span>
          ) : (
            <span>No attempts yet</span>
          )}
          {last && tag && <span>{tagLabel("failure", tag, failureOptions)}</span>}
          {last && <span className="whitespace-nowrap">{relativeTime(last.finishedAt ?? last.printedAt)}</span>}
        </MetaList>
      </span>
      {item.attempts.length > 0 && (
        <OutcomeStrip
          attempts={item.attempts.map((attempt) => ({
            id: attempt.id,
            number: attempt.number,
            outcome: attempt.outcome,
          }))}
          className="shrink-0"
        />
      )}
    </Link>
  );
}

/** Where to go on: builds waiting for their next attempt. Nothing is drawn when there are none. */
export function PickUpAgain({ builds }: { builds: ItemView[] }) {
  const reduce = useReducedMotion();
  const waiting = pickUpAgain(builds);
  if (waiting.length === 0) return null;
  return (
    <Section id="today-pickup" title="Pick up again" size="overline">
      {/* A build whose print just got its answer arrives here, and the rows make room for it. */}
      <div className="flex flex-col gap-1">
        <AnimatePresence initial={false} mode="popLayout">
          {waiting.slice(0, MOST).map((item) => (
            <m.div
              key={item.id}
              layout={reduce ? false : "position"}
              transition={spring.gentle}
              initial={{ opacity: 0 }}
              // After the card on the bed has gone, so the build seems to move here rather than show twice.
              animate={{
                opacity: 1,
                transition: reduce
                  ? { duration: 0 }
                  : { duration: duration.base, ease: ease.out, delay: duration.base },
              }}
              exit={{ opacity: 0, transition: { duration: reduce ? 0 : duration.fast } }}
            >
              <Row item={item} />
            </m.div>
          ))}
        </AnimatePresence>
      </div>
      {waiting.length > MOST && (
        <Link to="/builds" className="focus-ring self-start rounded-sm">
          <Button variant="quiet" size="sm" tabIndex={-1} className="-ml-3">
            All builds
          </Button>
        </Link>
      )}
    </Section>
  );
}
