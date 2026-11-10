import { Link } from "@tanstack/react-router";
import { itemName } from "@/components/journal/JournalEntry";
import { Button } from "@/components/ui/Button";
import { IdeasIcon } from "@/components/ui/icons";
import { Overline } from "@/components/ui/Overline";
import { Photo } from "@/components/ui/Photo";
import { cn } from "@/lib/cn";
import type { ItemView } from "@/lib/items";
import { photoSrc } from "@/lib/previews";
import { splitQueue } from "@/lib/up-next";

/** How many Today shows; the inbox has the whole queue. */
const FIRST = 3;

/** The queue's first ideas, in queue order. */
export function upNextIdeas(ideas: ItemView[]): ItemView[] {
  return splitQueue(ideas.filter((idea) => !idea.pending)).queue;
}

function Row({ item }: { item: ItemView }) {
  const photo = item.photos[0];
  const name = itemName(item);
  return (
    <Link
      to="/ideas/$ideaId"
      params={{ ideaId: item.id }}
      className="pressable focus-ring hover:bg-ink/4 -mx-1.5 flex items-center gap-3.5 rounded-lg p-1.5"
    >
      <span className="relative size-12 shrink-0 overflow-hidden rounded-md" aria-hidden>
        {photo ? (
          <Photo src={photoSrc(photo.id, "thumb")} alt="" color={photo.color || undefined} className="size-full" />
        ) : (
          <span className="bg-ink/5 text-ink-faint flex size-full items-center justify-center">
            <IdeasIcon size={22} />
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn("text-body truncate", name.titled ? "text-ink font-semibold" : "text-ink-soft font-medium")}
        >
          {name.text}
        </span>
        {item.forWhom && <span className="text-small text-ink-faint truncate">for {item.forWhom}</span>}
      </span>
    </Link>
  );
}

/** What to print soon: the first three of the Up next queue. Nothing is drawn when the queue is empty. */
export function UpNext({ ideas }: { ideas: ItemView[] }) {
  const queue = upNextIdeas(ideas);
  if (queue.length === 0) return null;
  return (
    <section aria-labelledby="today-upnext" className="flex flex-col gap-3">
      <Overline as="h2" id="today-upnext">
        Up next
      </Overline>
      <div className="flex flex-col gap-1">
        {queue.slice(0, FIRST).map((item) => (
          <Row key={item.id} item={item} />
        ))}
      </div>
      {queue.length > FIRST && (
        <Link to="/ideas" className="focus-ring self-start rounded-sm">
          <Button variant="quiet" size="sm" tabIndex={-1} className="-ml-3">
            All {queue.length} in Ideas
          </Button>
        </Link>
      )}
    </section>
  );
}
