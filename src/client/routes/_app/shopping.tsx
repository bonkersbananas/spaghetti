import type { ShoppingItem } from "@shared/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Reorder, useDragControls } from "motion/react";
import { type FormEvent, lazy, type RefObject, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EmptyBasket } from "@/components/illustrations/EmptyBasket";
import { PageHeader } from "@/components/shell/PageHeader";
import { ShoppingRow, useShoppingName } from "@/components/shopping/ShoppingRow";
import { AskLine, AskName } from "@/components/ui/AskLine";
import { Button } from "@/components/ui/Button";
import { checklistSurface } from "@/components/ui/Checklist";
import { DragHandle } from "@/components/ui/DragHandle";
import { EmptyState } from "@/components/ui/EmptyState";
import { TextField } from "@/components/ui/Field";
import { PlusIcon, PriceIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { Section } from "@/components/ui/Section";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { tap } from "@/lib/haptics";
import { shortcutCaps, useHotkeys } from "@/lib/hotkeys";
import { useScreenActions } from "@/lib/palette";
import { peopleQuery, sessionQuery } from "@/lib/queries";
import { canEdit, useReadOnly } from "@/lib/read-only";
import {
  addToShopping,
  moveShopping,
  removeShopping,
  reorderShopping,
  replayTicks,
  setBought,
  untick,
  useShopping,
  useToMatch,
} from "@/lib/shopping";

// Opened with a tap: their own chunks.
const MatchPricesSheet = lazy(() =>
  import("@/components/shopping/MatchPricesSheet").then((m) => ({ default: m.MatchPricesSheet })),
);
const ShoppingSheet = lazy(() =>
  import("@/components/shopping/ShoppingSheet").then((m) => ({ default: m.ShoppingSheet })),
);

export const Route = createFileRoute("/_app/shopping")({
  component: Shopping,
});

/**
 * A ticked thing moves to the other list, and its row is made anew there: a keyboard that ticked it would be left on the
 * page's body. Once the row has landed, focus goes to its box again (unless it has gone somewhere on purpose).
 */
function keepFocusOnTick() {
  const box = document.activeElement;
  const label =
    box instanceof HTMLElement && box.getAttribute("role") === "checkbox" ? box.getAttribute("aria-label") : null;
  if (!label) return;
  let tries = 0;
  const timer = window.setInterval(() => {
    const active = document.activeElement;
    if ((active && active !== document.body && active.getAttribute("aria-label") !== label) || ++tries > 20)
      return window.clearInterval(timer);
    const next = [...document.querySelectorAll<HTMLElement>('[role="checkbox"]')].find(
      (element) => element.getAttribute("aria-label") === label,
    );
    if (!next || next === active) return;
    next.focus({ preventScroll: true });
    window.clearInterval(timer);
  }, 100);
}

/** Bought things shown before "Show all". */
const BOUGHT_SHOWN = 8;

function Shopping() {
  const queryClient = useQueryClient();
  const { data: me } = useQuery(sessionQuery);
  const { data: people } = useQuery(peopleQuery);
  const { toBuy, bought, isPending, data, isFetchedAfterMount } = useShopping();
  const readOnly = useReadOnly();
  const [openId, setOpenId] = useState<string | null>(null);
  const [allBought, setAllBought] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const byId = new Map(people?.map((person) => [person.id, person]));
  // Without the session yet the tick still counts: the server knows who it is, and its copy replaces this one.
  const tick = (item: ShoppingItem, next: boolean, name: string) => {
    keepFocusOnTick();
    void setBought(queryClient, item, next, me?.id ?? null);
    // Bought sits below the list on a phone and beside it on a laptop: the undo is in the toast, where the thumb is.
    const order = toBuy.map((thing) => thing.id);
    if (next && canEdit())
      toast.undo("Bought", {
        id: "shopping-tick",
        description: name,
        onUndo: () => void untick(queryClient, item.id, order, me?.id ?? null),
      });
  };
  const toMatch = useToMatch(toBuy);
  const [matching, setMatching] = useState(false);

  // A tick a closed page left waiting for its thing's add goes out now that the list is the server's.
  // Once per visit: later changes of the list are this page's own ticks, which are still on their way.
  const replayed = useRef(false);
  useEffect(() => {
    if (replayed.current || !isFetchedAfterMount || !data || !canEdit()) return;
    replayed.current = true;
    replayTicks(queryClient, data, me?.id ?? null);
  }, [isFetchedAfterMount, data, me?.id, queryClient]);

  const focusAdd = () => field.current?.focus();
  useHotkeys({ shoppingAdd: readOnly ? undefined : focusAdd });
  useScreenActions(
    "Shopping list",
    readOnly ? [] : [{ id: "shopping-add", label: "Add something to buy", icon: PlusIcon, run: focusAdd }],
  );

  const shownBought = allBought ? bought : bought.slice(0, BOUGHT_SHOWN);
  return (
    <>
      <PageHeader title="Shopping list" subtitle="What the printer needs next." />
      <div className="max-w-content xl:max-w-wide flex flex-col gap-12 md:gap-16 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:items-start xl:gap-x-14">
        <div className="flex flex-col gap-4 md:gap-5">
          <AddToList fieldRef={field} disabled={readOnly || !me} userId={me?.id} />
          {!readOnly && toMatch.length > 0 && <MatchOffer count={toMatch.length} onOpen={() => setMatching(true)} />}
          {isPending && !data ? (
            <Skeleton className="h-60 w-full rounded-lg" aria-hidden />
          ) : toBuy.length ? (
            <ToBuyList items={toBuy} readOnly={readOnly} onTick={tick} onOpen={setOpenId} />
          ) : bought.length ? (
            <p className="text-body text-ink-soft">Nothing left to buy. Add the next thing when you run low.</p>
          ) : (
            <EmptyState
              size="inline"
              illustration={<EmptyBasket />}
              title="The cupboard is full"
              action={
                <Button variant="secondary" icon={PlusIcon} disabled={readOnly || !me} onClick={focusAdd}>
                  Add the first thing
                </Button>
              }
            >
              When you run low on filament, glue or nozzles, add it here, or paste a shop's link and it names itself.
            </EmptyState>
          )}
        </div>
        {bought.length > 0 && (
          <Section
            id="shopping-bought"
            title="Bought"
            size="title"
            count={bought.length}
            aside={
              <Button variant="quiet" size="sm" disabled={readOnly} onClick={() => removeShopping(queryClient, bought)}>
                Clear
              </Button>
            }
          >
            <ul className={checklistSurface} aria-label="Bought">
              {shownBought.map((item, index) => (
                <li key={item.id}>
                  <ShoppingRow
                    item={item}
                    boughtBy={item.boughtBy ? byId.get(item.boughtBy) : undefined}
                    readOnly={readOnly}
                    pictureRoom={shownBought.some((thing) => thing.picture)}
                    last={index === shownBought.length - 1}
                    onTick={(next, name) => tick(item, next, name)}
                    onOpen={() => setOpenId(item.id)}
                  />
                </li>
              ))}
            </ul>
            {bought.length > BOUGHT_SHOWN && !allBought && (
              <Button variant="quiet" size="sm" className="self-start" onClick={() => setAllBought(true)}>
                Show all {bought.length}
              </Button>
            )}
          </Section>
        )}
      </div>
      <Suspense fallback={null}>
        {openId && <ShoppingSheet itemId={openId} onOpenChange={(open) => !open && setOpenId(null)} />}
        {matching && <MatchPricesSheet ids={toMatch.map((item) => item.id)} onClose={() => setMatching(false)} />}
      </Suspense>
    </>
  );
}

/**
 * The one field that adds: words, a shop's link, a Prisjakt link or all of them on one line. Enter adds it at the top
 * and the field stays, ready for the next.
 */
function AddToList({
  fieldRef,
  disabled,
  userId,
}: {
  fieldRef: RefObject<HTMLInputElement | null>;
  disabled: boolean;
  userId?: string;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!userId || !text.trim()) return;
    const sent = text;
    setText("");
    void addToShopping(queryClient, sent, userId).then((added) => {
      // Nothing typed is lost: a line that couldn't be added comes back.
      if (!added) setText((current) => current || sent);
    });
  }
  return (
    <form onSubmit={submit} className="relative flex items-center gap-2">
      <TextField
        ref={fieldRef}
        aria-label="Add something to buy"
        icon={PlusIcon}
        value={text}
        disabled={disabled}
        placeholder="Filament, glue… or paste a link"
        enterKeyHint="done"
        autoComplete="off"
        className="min-w-0 flex-1"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => setText(event.target.value)}
      />
      {/* On desktop, inside the field: the shortcut while it waits; once typing, Enter adds. */}
      <Kbd
        keys={focused || text ? ["↵"] : shortcutCaps("shoppingAdd")}
        className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2"
      />
      {text.trim() && (
        <Button type="submit" variant="secondary" className="md:hidden" disabled={disabled}>
          Add
        </Button>
      )}
    </form>
  );
}

/**
 * What's still to buy: drag a row by its handle (mouse or finger; the page doesn't scroll under it), or focus the
 * handle and use the arrow keys. The new order shows at once and is sent when the row is let go.
 */
function ToBuyList({
  items,
  readOnly,
  onTick,
  onOpen,
}: {
  items: ShoppingItem[];
  readOnly: boolean;
  onTick: (item: ShoppingItem, bought: boolean, name: string) => void;
  onOpen: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const ids = items.map((item) => item.id);
  const key = ids.join();
  const [order, setOrder] = useState(ids);
  const [dragging, setDragging] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const [focusId, setFocusId] = useState<string | null>(null);

  // Follow the cache (an add, the other person, the server's answer) unless a row is in the air.
  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for ids.
  useEffect(() => {
    if (!dragging) setOrder(ids);
  }, [key, dragging]);

  // A row moved with the keyboard keeps the focus on its handle, wherever React put the node.
  useLayoutEffect(() => {
    if (!focusId) return;
    const handle = handles.current.get(focusId);
    if (handle && document.activeElement !== handle) handle.focus({ preventScroll: false });
    setFocusId(null);
  }, [focusId]);

  const byId = new Map(items.map((item) => [item.id, item]));
  const pictureRoom = items.some((item) => item.picture);
  const sortable = !readOnly && items.length > 1;

  return (
    <>
      <Reorder.Group
        as="ul"
        axis="y"
        values={order}
        onReorder={setOrder}
        className={checklistSurface}
        aria-label="To buy"
      >
        {order.map((id, index) => {
          const item = byId.get(id);
          if (!item) return null;
          return (
            <ToBuyRow
              key={id}
              item={item}
              place={index + 1}
              last={index === order.length - 1}
              lifted={dragging === id}
              pictureRoom={pictureRoom}
              readOnly={readOnly}
              sortable={sortable}
              handleRef={(node) => {
                if (node) handles.current.set(id, node);
                else handles.current.delete(id);
              }}
              onDragStart={() => {
                setDragging(id);
                tap();
              }}
              onDragEnd={() => {
                setDragging(null);
                if (order.join() !== key) void reorderShopping(queryClient, order);
              }}
              onMove={(step, name) => {
                const at = order.indexOf(id) + step;
                if (at < 0 || at >= order.length) return;
                setFocusId(id);
                moveShopping(queryClient, items, id, step);
                setSaid(`${name}, now ${at + 1} of ${order.length}.`);
              }}
              onTick={(next, name) => onTick(item, next, name)}
              onOpen={() => onOpen(id)}
            />
          );
        })}
      </Reorder.Group>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
    </>
  );
}

interface ToBuyRowProps {
  item: ShoppingItem;
  place: number;
  last: boolean;
  lifted: boolean;
  pictureRoom: boolean;
  readOnly: boolean;
  sortable: boolean;
  handleRef: (node: HTMLButtonElement | null) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (step: -1 | 1, name: string) => void;
  onTick: (bought: boolean, name: string) => void;
  onOpen: () => void;
}

function ToBuyRow({
  item,
  place,
  last,
  lifted,
  pictureRoom,
  readOnly,
  sortable,
  handleRef,
  onDragStart,
  onDragEnd,
  onMove,
  onTick,
  onOpen,
}: ToBuyRowProps) {
  const controls = useDragControls();
  const name = useShoppingName(item);
  return (
    <Reorder.Item
      value={item.id}
      dragListener={false}
      dragControls={controls}
      drag={sortable ? "y" : false}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      whileDrag={{ scale: 1.02 }}
      className={cn("relative list-none", lifted && "z-10")}
    >
      <ShoppingRow
        item={item}
        readOnly={readOnly}
        lifted={lifted}
        pictureRoom={pictureRoom}
        last={last}
        onTick={onTick}
        onOpen={onOpen}
        handle={
          sortable ? (
            <DragHandle
              size="line"
              ref={handleRef}
              label={`Move ${name}, at ${place}`}
              onPointerDown={(event) => {
                event.preventDefault();
                controls.start(event);
              }}
              onMove={(step) => onMove(step, name)}
            />
          ) : undefined
        }
      />
    </Reorder.Item>
  );
}

/**
 * One offer for the whole list, at its top, in place of a chip on every row: Claude found Prisjakt pages for some
 * things, and one tap opens them all to check, each used only once someone says so.
 */
function MatchOffer({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <AskLine
      icon={PriceIcon}
      detail="Claude found their Prisjakt pages to check."
      actions={
        <Button variant="secondary" size="sm" onClick={onOpen}>
          Match prices
        </Button>
      }
    >
      <AskName>{count === 1 ? "One thing" : `${count} things`}</AskName> could show their prices
    </AskLine>
  );
}
