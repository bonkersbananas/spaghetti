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
 * The way to the wishlists on a phone, where the tab bar has no room for them: one quiet row at the top of
 * Ideas with your top picks' photos fanned out and how long each list is.
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
  const parts = [
    mine.length ? `Your top ${mine.length}` : "Pick your top ideas",
    ...theirs.map((list) => `${list.name} has ${list.count}`),
  ];
  return (
    <Link
      to="/wishlist"
      className={cn(
        "pressable focus-ring bg-cream shadow-soft flex items-center gap-3.5 rounded-lg py-2.5 pr-3 pl-2.5",
        className,
      )}
    >
      {covers.length ? (
        <span className="flex shrink-0 pl-2" aria-hidden>
          {covers.map((photo) => (
            <span key={photo.id} className="ring-cream -ml-2 size-10 overflow-hidden rounded-md ring-2">
              <Photo src={photoSrc(photo.id, "thumb")} alt="" color={photo.color || undefined} className="size-full" />
            </span>
          ))}
        </span>
      ) : (
        <span
          className="bg-semolina-soft text-semolina-ink flex size-10 shrink-0 items-center justify-center rounded-md"
          aria-hidden
        >
          <WishIcon size={20} weight="fill" />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body text-ink font-semibold">Wishlists</span>
        <span className="text-small text-ink-faint truncate">{parts.join(" · ")}</span>
      </span>
      <NextIcon size={18} className="text-ink-faint shrink-0" aria-hidden />
    </Link>
  );
}
