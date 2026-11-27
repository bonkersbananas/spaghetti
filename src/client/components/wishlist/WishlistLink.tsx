import type { Person } from "@shared/api";
import { displayName } from "@shared/people";
import { Link } from "@tanstack/react-router";
import { WishIcon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/Photo";
import { cn } from "@/lib/cn";
import type { ItemView } from "@/lib/items";
import { photoSrc } from "@/lib/previews";
import { useWishlists, wishedIdeas } from "@/lib/wishlist";

/**
 * The way to the wishlists on a phone, where the tab bar has no room for them: a pill in the Ideas header, beside the
 * title, with your top picks' photos as up to three small overlapping squares (rounded, never round: a circle is a
 * person here) and the word. How long each list is ("yours 5, Sam's 4") is in its name for a screen reader.
 */
export function WishlistLink({
  me,
  ideas,
  people,
  className,
}: {
  me: string;
  ideas: ItemView[];
  people: Person[];
  className?: string;
}) {
  const { wishlists } = useWishlists();
  const mine = wishedIdeas(
    wishlists?.find((list) => list.personId === me),
    ideas,
  );
  const theirs = (wishlists ?? [])
    .filter((list) => list.personId !== me && !list.private)
    .map((list) => ({
      name: displayName(
        people.find((person) => person.id === list.personId),
        "",
      ).split(/\s+/)[0],
      count: wishedIdeas(list, ideas).length,
    }))
    .filter((list) => list.name && list.count > 0);
  const counts = [
    mine.length ? `yours ${mine.length}` : "pick yours",
    ...theirs.map((list) => `${list.name}'s ${list.count}`),
  ];
  return (
    <WishlistPill
      covers={mine.flatMap((item) => (item.photos[0] ? [item.photos[0]] : [])).slice(0, 3)}
      counts={counts.join(", ")}
      className={className}
    />
  );
}

/** The pill itself: the covers (or a semolina star while none has a photo), then "Wishlists". */
export function WishlistPill({
  covers,
  counts,
  to = "/wishlist",
  className,
}: {
  covers: { id: string; color?: string | null }[];
  /** Said after the word to a screen reader: "yours 5, Sam's 4". */
  counts?: string;
  to?: "/wishlist" | "/styleguide";
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "pressable focus-ring touch-target bg-cream shadow-soft hover:bg-lifted text-small text-ink relative flex h-9 items-center gap-2 rounded-full pr-3.5 pl-1.5 font-semibold",
        className,
      )}
    >
      {covers.length ? (
        <span className="flex shrink-0 pl-1.5" aria-hidden>
          {covers.map((photo) => (
            <span key={photo.id} className="ring-cream -ml-1.5 size-6 overflow-hidden rounded-xs ring-2">
              <Photo src={photoSrc(photo.id, "thumb")} alt="" color={photo.color || undefined} className="size-full" />
            </span>
          ))}
        </span>
      ) : (
        <span
          className="bg-semolina-soft text-semolina-ink flex size-6 shrink-0 items-center justify-center rounded-full"
          aria-hidden
        >
          <WishIcon size={14} weight="fill" />
        </span>
      )}
      Wishlists
      {counts && <span className="sr-only">, {counts}</span>}
    </Link>
  );
}
