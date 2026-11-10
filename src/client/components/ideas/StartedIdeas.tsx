import { beganAsIdea } from "@shared/deleted";
import { Link } from "@tanstack/react-router";
import { itemName } from "@/components/journal/JournalEntry";
import { ArrowRightIcon, BuildsIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { Photo } from "@/components/ui/Photo";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { heroPhoto } from "@/lib/builds";
import { cn } from "@/lib/cn";
import type { ItemView } from "@/lib/items";
import { photoSrc } from "@/lib/previews";

/** How many started ideas Ideas shows before it points at Builds. */
const MOST = 6;

/** The ideas that were started, newest start first: builds that were captured as an idea before. */
export function startedIdeas(builds: ItemView[]): ItemView[] {
  return builds
    .filter((build) => beganAsIdea(build))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0) || (b.id > a.id ? 1 : -1));
}

/** Where a started idea stands, in a few words: building (with its newest attempt), printed, or on the shelf. */
export function startedStatus(item: ItemView): { stage: string; detail?: string; tone?: "good" | "bad" } {
  if (item.stage === "shelved") return { stage: "On the shelf" };
  const last = item.attempts.at(-1);
  if (item.stage === "done") {
    return { stage: "Printed", detail: last?.outcome === "success" ? "Worked" : undefined, tone: "good" };
  }
  if (!last) return { stage: "Building", detail: "no attempts yet" };
  if (last.outcome === null) return { stage: "Building", detail: `attempt ${last.number} is printing` };
  const outcome = { success: "worked", partial: "partly", failed: "didn't work" }[last.outcome];
  return { stage: "Building", detail: `attempt ${last.number} ${outcome}` };
}

/**
 * The ideas that became builds, in a quiet section after the rest of the inbox: nothing is lost
 * to "Start building", and a started idea is one tap from its build. A handful, with a way on to Builds.
 */
export function StartedIdeas({ builds }: { builds: ItemView[] }) {
  const started = startedIdeas(builds);
  if (!started.length) return null;
  return (
    <section aria-labelledby="started-heading" className="mt-12">
      <SectionHeading id="started-heading" size="title" count={started.length} className="mb-3">
        Started
      </SectionHeading>
      <ul className="flex flex-col md:grid md:grid-cols-2 md:gap-x-8 xl:grid-cols-3" aria-label="Started ideas">
        {started.slice(0, MOST).map((item) => (
          <li key={item.id}>
            <Row item={item} />
          </li>
        ))}
      </ul>
      {started.length > MOST && (
        <Link
          to="/builds"
          className="text-small text-ink-soft hover:text-ink focus-ring mt-2 inline-flex items-center gap-1.5 rounded-md py-2 font-semibold"
        >
          See all in Builds <ArrowRightIcon size={14} weight="bold" aria-hidden />
        </Link>
      )}
    </section>
  );
}

function Row({ item }: { item: ItemView }) {
  const hero = heroPhoto(item);
  const name = itemName(item);
  const status = startedStatus(item);
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
          <span className={cn("font-semibold", status.tone === "good" && "text-basil-ink")}>{status.stage}</span>
          {status.detail && <span>{status.detail}</span>}
        </MetaList>
      </span>
    </Link>
  );
}
