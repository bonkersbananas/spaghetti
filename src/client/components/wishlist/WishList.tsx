import { relativeTime } from "@shared/time";
import { moveBy } from "@shared/wishlist";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Reorder, useDragControls } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { itemName } from "@/components/journal/JournalEntry";
import { Button, IconButton } from "@/components/ui/Button";
import { BuildsIcon, PlayIcon } from "@/components/ui/icons";
import { DragHandle, RankRow } from "@/components/ui/RankRow";
import { startBuild } from "@/lib/builds";
import { tap } from "@/lib/haptics";
import type { ItemView } from "@/lib/items";
import { photoSrc } from "@/lib/previews";
import { canEdit, useReadOnly } from "@/lib/read-only";
import { useIsDesktop } from "@/lib/use-media-query";
import { removeFromWishlist, reorderWishlist } from "@/lib/wishlist";

const rowProps = (item: ItemView, rank: number) => {
  const cover = item.photos[0];
  const name = itemName(item);
  return {
    rank,
    title: name.text,
    photo: cover ? { src: photoSrc(cover.id, "thumb"), color: cover.color || undefined } : undefined,
    note: item.note.trim() || undefined,
    meta: [...(item.forWhom ? [`for ${item.forWhom}`] : []), relativeTime(item.createdAt)],
    link: { to: "/ideas/$ideaId", params: { ideaId: item.id } } as const,
  };
};

/** "Start building": a build from this idea, and its page. One tap from any list. */
function StartButton({ item, name }: { item: ItemView; name: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const readOnly = useReadOnly(item.pending);
  const start = () => {
    if (!canEdit(item.pending)) return;
    startBuild(queryClient, item);
    void navigate({ to: "/builds/$buildId", params: { buildId: item.id } });
  };
  return isDesktop ? (
    <Button
      variant="quiet"
      size="sm"
      icon={BuildsIcon}
      onClick={start}
      disabled={readOnly}
      aria-label={`Start building ${name}`}
    >
      Start building
    </Button>
  ) : (
    // A play arrow, not the cube: that glyph is the Builds tab right below. It is named for screen readers, and
    // the title gets the width the word "Build" took.
    <IconButton icon={PlayIcon} label={`Start building ${name}`} variant="quiet" onClick={start} disabled={readOnly} />
  );
}

/** Someone else's list: the same rows, to read and start from, not to rearrange. */
export function WishListView({ ideas, label }: { ideas: ItemView[]; label: string }) {
  return (
    <ol data-picks className="flex flex-col gap-2" aria-label={label}>
      {ideas.map((item, index) => {
        const props = rowProps(item, index + 1);
        return (
          <li key={item.id}>
            <RankRow {...props} actions={<StartButton item={item} name={props.title} />} />
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Your own list: drag a row by its handle (mouse or finger; the page doesn't scroll under it), or focus the
 * handle and use the arrow keys. The new order shows at once and is sent when the row is let go.
 */
export function EditableWishList({ me, ideas, label }: { me: string; ideas: ItemView[]; label: string }) {
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();
  const ids = ideas.map((item) => item.id);
  const key = ids.join();
  const [order, setOrder] = useState(ids);
  const [dragging, setDragging] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const [focusId, setFocusId] = useState<string | null>(null);

  // Follow the cache (an add, the other tab, the server's answer) unless a row is in the air.
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

  const byId = new Map(ideas.map((item) => [item.id, item]));
  const nameOf = (id: string) => (byId.get(id) ? itemName(byId.get(id) as ItemView).text : "It");

  function commit(next: string[], moved: string) {
    reorderWishlist(queryClient, me, next);
    const place = next.indexOf(moved) + 1;
    setSaid(`${nameOf(moved)}, now ${place} of ${next.length}.`);
  }

  function move(id: string, step: -1 | 1) {
    const next = moveBy(order, id, step);
    if (next.join() === order.join()) return;
    setOrder(next);
    setFocusId(id);
    commit(next, id);
  }

  return (
    <>
      <Reorder.Group
        as="ol"
        axis="y"
        values={order}
        onReorder={setOrder}
        data-picks
        className="flex flex-col gap-2"
        aria-label={label}
      >
        {order.map((id, index) => {
          const item = byId.get(id);
          if (!item) return null;
          return (
            <EditableRow
              key={id}
              item={item}
              rank={index + 1}
              lifted={dragging === id}
              readOnly={readOnly}
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
                commit(order, id);
              }}
              onMove={(step) => move(id, step)}
              onRemove={() => {
                // Focus goes to the next handle (or the one before), so the keyboard stays in the list.
                const at = order.indexOf(id);
                const neighbour = order[at + 1] ?? order[at - 1];
                if (neighbour) setFocusId(neighbour);
                removeFromWishlist(queryClient, me, item);
              }}
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

interface EditableRowProps {
  item: ItemView;
  rank: number;
  lifted: boolean;
  readOnly: boolean;
  handleRef: (node: HTMLButtonElement | null) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (step: -1 | 1) => void;
  onRemove: () => void;
}

function EditableRow({
  item,
  rank,
  lifted,
  readOnly,
  handleRef,
  onDragStart,
  onDragEnd,
  onMove,
  onRemove,
}: EditableRowProps) {
  const controls = useDragControls();
  const props = rowProps(item, rank);
  return (
    <Reorder.Item
      value={item.id}
      dragListener={false}
      dragControls={controls}
      drag={readOnly ? false : "y"}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      whileDrag={{ scale: 1.02 }}
      className={lifted ? "relative z-10 list-none" : "relative list-none"}
    >
      <RankRow
        {...props}
        lifted={lifted}
        actions={<StartButton item={item} name={props.title} />}
        handle={
          <DragHandle
            ref={handleRef}
            label={`Move ${props.title}, at ${rank}`}
            disabled={readOnly}
            onPointerDown={(event) => {
              event.preventDefault();
              controls.start(event);
            }}
            onMove={onMove}
            onRemove={onRemove}
          />
        }
      />
    </Reorder.Item>
  );
}
