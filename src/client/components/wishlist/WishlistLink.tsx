import type { Person } from "@shared/api";
import { displayName } from "@shared/people";
import { Link } from "@tanstack/react-router";
import { NextIcon, WishIcon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/Photo";
import { cn } from "@/lib/cn";
import type { ItemView } from "@/lib/items";
import { photoSrc } from "@/lib/previews";
import { useWishlists, wishedIdeas } from "@/lib/wishlist";

/**
 * The way to the wishlists on a phone, where the tab bar has no room for them: one quiet line on Ideas, under Up
 * next, with your top picks' photos as three small overlapping squares (rounded, never round: a circle is a person
 * here) and how long each list is ("Wishlists · yours 5, Sam's 4").
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
  const covers = mine.flatMap((item) => (item.photos[0] ? [item.photos[0]] : [])).slice(0, 3);
  const counts = [
    mine.length ? `yours ${mine.length}` : "pick your top ideas",
    ...theirs.map((list) => `${list.name}'s ${list.count}`),
  ];
  return (
    <Link
      to="/wishlist"
      className={cn(
        "pressable focus-ring duration-fast hover:bg-ink/4 -mx-2 flex h-14 items-center gap-3 rounded-lg px-2 transition-colors",
        className,
      )}
    >
      {covers.length ? (
        <span className="flex shrink-0 pl-2" aria-hidden>
          {covers.map((photo) => (
            <span key={photo.id} className="ring-paper -ml-2 size-9 overflow-hidden rounded-sm ring-2">
              <Photo src={photoSrc(photo.id, "thumb")} alt="" color={photo.color || undefined} className="size-full" />
            </span>
          ))}
        </span>
      ) : (
        <span
          className="bg-semolina-soft text-semolina-ink flex size-9 shrink-0 items-center justify-center rounded-sm"
          aria-hidden
        >
          <WishIcon size={16} weight="fill" />
        </span>
      )}
      <span className="text-body min-w-0 flex-1 truncate">
        <span className="text-ink font-semibold">Wishlists</span>
        <span className="text-ink-faint"> · {counts.join(", ")}</span>
      </span>
      <NextIcon size={18} className="text-ink-faint shrink-0" aria-hidden />
    </Link>
  );
}
