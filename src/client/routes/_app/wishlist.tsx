import type { Person } from "@shared/api";
import { displayName } from "@shared/people";
import type { Wishlist } from "@shared/wishlist";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { WishingBowl } from "@/components/illustrations";
import { PageHeader } from "@/components/shell/PageHeader";
import { ActionBar } from "@/components/ui/ActionBar";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { EyeSlashIcon, PlusIcon } from "@/components/ui/icons";
import { Section } from "@/components/ui/Section";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Skeleton } from "@/components/ui/Skeleton";
import { Toggle } from "@/components/ui/Toggle";
import { EditableWishList, WishListView } from "@/components/wishlist/WishList";
import { WishPicker } from "@/components/wishlist/WishPicker";
import { useIdeas } from "@/lib/items";
import { peopleQuery, sessionQuery } from "@/lib/queries";
import { useReadOnly } from "@/lib/read-only";
import { useIsDesktop, useIsWide } from "@/lib/use-media-query";
import { setWishlistPrivate, useWishlists, wishedIdeas } from "@/lib/wishlist";

export const Route = createFileRoute("/_app/wishlist")({
  component: WishlistPage,
});

const firstName = (person: Person | undefined) => displayName(person, "Someone").split(/\s+/)[0] ?? "Someone";
const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

function WishlistPage() {
  const { data: user } = useQuery(sessionQuery);
  const { data: people } = useQuery(peopleQuery);
  const { wishlists, isPending } = useWishlists();
  const { items: ideas, isPending: ideasPending } = useIdeas();
  const isWide = useIsWide();
  const [shown, setShown] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const me = user?.id ?? "";
  const byId = new Map(people?.map((person) => [person.id, person]));
  const others = (people ?? []).filter((person) => person.id !== me);
  // Yours first, then everyone else's, even before the lists arrive.
  const lists: Wishlist[] = [
    wishlists?.find((list) => list.personId === me) ?? { personId: me, private: false, entries: [] },
    ...others.map(
      (person) =>
        wishlists?.find((list) => list.personId === person.id) ?? { personId: person.id, private: false, entries: [] },
    ),
  ];
  const mine = lists[0] as Wishlist;
  const myIdeas = wishedIdeas(mine, ideas);
  const loading = isPending || ideasPending;
  const current = lists.find((list) => list.personId === shown) ?? mine;

  // On a phone the switch above names the list, so the column drops its own heading.
  const headless = !isWide && lists.length > 1;
  const column = (list: Wishlist) =>
    list.personId === me ? (
      <MyList
        key={list.personId}
        list={list}
        me={me}
        others={others}
        ideas={myIdeas}
        loading={loading}
        headless={headless}
        onPick={() => setPicking(true)}
      />
    ) : (
      <TheirList
        key={list.personId}
        list={list}
        person={byId.get(list.personId)}
        ideas={wishedIdeas(list, ideas)}
        loading={loading}
        headless={headless}
      />
    );

  return (
    <>
      <PageHeader
        title="Wishlists"
        subtitle={
          others.length
            ? "The ideas each of you would print first. Drag yours into order whenever you change your mind."
            : "The ideas you would print first. Drag them into order whenever you change your mind."
        }
      />
      {isWide || lists.length === 1 ? (
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-10 xl:gap-14">{lists.map(column)}</div>
      ) : (
        <div className="flex flex-col gap-6">
          <SegmentedControl
            label="Whose wishlist"
            labelHidden
            options={lists.slice(0, 4).map((list) => ({
              value: list.personId,
              label: list.personId === me ? "Yours" : possessive(firstName(byId.get(list.personId))),
            }))}
            value={current.personId}
            onChange={setShown}
          />
          {column(current)}
        </div>
      )}
      <WishPicker
        open={picking}
        onOpenChange={setPicking}
        me={me}
        ideas={ideas}
        picked={myIdeas.map((item) => item.id)}
      />
    </>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: 3 }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
        <Skeleton key={index} className="h-18 rounded-lg md:h-25" />
      ))}
    </div>
  );
}

function Heading({ person, children }: { person?: Person; children: string }) {
  return (
    <span className="mr-1.5 inline-flex items-center gap-3 align-middle">
      {person && <Avatar person={person} size="sm" decorative />}
      {children}
    </span>
  );
}

function MyList({
  list,
  me,
  others,
  ideas,
  loading,
  headless,
  onPick,
}: {
  list: Wishlist;
  me: string;
  others: Person[];
  ideas: ReturnType<typeof useIdeas>["items"];
  loading: boolean;
  headless: boolean;
  onPick: () => void;
}) {
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();
  const { data: user } = useQuery(sessionQuery);
  const other = others.length === 1 ? firstName(others[0]) : null;
  const shareLabel = other ? `Show it to ${other}` : "Show it to the others";
  const shareHint = list.private
    ? "Only you can see it now."
    : `${other ?? "Everyone who signs in"} can see it. Only you can change it.`;
  const isDesktop = useIsDesktop();
  // On a phone, picking more sits within thumb reach, on the tab bar; desktop keeps it beside the heading.
  const pick = ideas.length > 0 && isDesktop && (
    <Button variant="quiet" size="sm" icon={PlusIcon} onClick={onPick} disabled={readOnly} className="-mr-3">
      Pick ideas
    </Button>
  );
  return (
    <Column
      headless={headless}
      id="wishlist-mine"
      label="Yours"
      title={<Heading person={user ?? undefined}>Yours</Heading>}
      count={ideas.length || undefined}
      aside={pick}
    >
      {loading && !ideas.length ? (
        <ListSkeleton />
      ) : ideas.length ? (
        <EditableWishList me={me} ideas={ideas} label="Your wishlist" />
      ) : (
        <EmptyState
          className="py-6 md:py-10"
          illustration={<WishingBowl />}
          title="Nothing on your plate yet"
          action={
            // The sidebar's "New idea" is desktop's one primary action.
            <Button variant={isDesktop ? "secondary" : "primary"} icon={PlusIcon} onClick={onPick} disabled={readOnly}>
              Pick ideas
            </Button>
          }
        >
          Pick the ideas you'd print first, then drag them into order.
          {!list.private && other ? ` ${other} sees the list too.` : ""}
        </EmptyState>
      )}
      <Toggle
        label={shareLabel}
        hint={shareHint}
        checked={!list.private}
        disabled={readOnly || !me}
        onChange={(on) => setWishlistPrivate(queryClient, me, !on)}
        className="mt-2"
      />
      {!isDesktop && ideas.length > 0 && (
        <ActionBar>
          <Button variant="secondary" size="lg" icon={PlusIcon} fullWidth onClick={onPick} disabled={readOnly}>
            Pick ideas
          </Button>
        </ActionBar>
      )}
    </Column>
  );
}

function TheirList({
  list,
  person,
  ideas,
  loading,
  headless,
}: {
  list: Wishlist;
  person?: Person;
  ideas: ReturnType<typeof useIdeas>["items"];
  loading: boolean;
  headless: boolean;
}) {
  const name = firstName(person);
  return (
    <Column
      headless={headless}
      label={possessive(name)}
      id={`wishlist-${list.personId}`}
      title={<Heading person={person}>{possessive(name)}</Heading>}
      count={ideas.length || undefined}
    >
      {loading && !ideas.length ? (
        <ListSkeleton />
      ) : list.private ? (
        <Quiet>
          <EyeSlashIcon size={18} className="shrink-0" aria-hidden />
          {name} keeps this list private for now.
        </Quiet>
      ) : ideas.length ? (
        <WishListView ideas={ideas} label={`${possessive(name)} wishlist`} />
      ) : (
        <Quiet>{name} hasn't picked any yet. The picks will show here, top first.</Quiet>
      )}
    </Column>
  );
}

/** A list's section: under its heading on desktop; on a phone, where the switch names it, just its aside on top. */
function Column({
  headless,
  id,
  label,
  title,
  count,
  aside,
  children,
}: {
  headless: boolean;
  id: string;
  label: string;
  title: ReactNode;
  count?: number;
  aside?: ReactNode;
  children: ReactNode;
}) {
  if (!headless) {
    return (
      <Section id={id} title={title} count={count} aside={aside || undefined}>
        {children}
      </Section>
    );
  }
  return (
    <section aria-label={label} className="flex flex-col gap-4">
      {aside && <div className="-mt-2 flex justify-end">{aside}</div>}
      {children}
    </section>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-body text-ink-faint flex items-center gap-2.5 py-2">{children}</p>;
}
