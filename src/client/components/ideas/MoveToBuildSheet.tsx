import { OUTCOME_LABELS } from "@shared/attempts";
import { inlineTime } from "@shared/time";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { IconButton } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { BackIcon, SearchIcon } from "@/components/ui/icons";
import { Overline } from "@/components/ui/Overline";
import { PickRow } from "@/components/ui/PickRow";
import { Sheet } from "@/components/ui/Sheet";
import { findPrinting, newestPhoto } from "@/lib/builds";
import { type ItemView, useBuilds } from "@/lib/items";
import { moveIntoBuild } from "@/lib/move";
import { photoSrc } from "@/lib/previews";
import { itemName } from "@/lib/recent";
import { useIsDesktop } from "@/lib/use-media-query";

interface MoveToBuildSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  idea: ItemView;
  /** Called once the move is under way (the idea page leaves for Ideas). */
  onMoved?: () => void;
}

const photoOf = (build: ItemView) => {
  const photo = newestPhoto(build);
  return photo ? { src: photoSrc(photo.id, "thumb"), color: photo.color || undefined } : null;
};

/**
 * "Add to a build…": the builds with the one on the bed first and the rest by when they were last touched
 * (searchable on desktop), then, for a build with attempts, which print: the newest is the suggestion. A tap on
 * the last choice moves; there is no confirm step, the toast offers Undo.
 */
export function MoveToBuildSheet({ open, onOpenChange, idea, onMoved }: MoveToBuildSheetProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { items } = useBuilds();
  const [picked, setPicked] = useState<ItemView | null>(null);
  const [search, setSearch] = useState("");

  const builds = useMemo(() => {
    const onBed = findPrinting(items)?.item.id;
    const ready = items.filter((build) => !build.pending);
    return ready.sort(
      (a, b) =>
        Number(b.id === onBed) - Number(a.id === onBed) ||
        Number(b.stage === "building") - Number(a.stage === "building") ||
        b.updatedAt - a.updatedAt,
    );
  }, [items]);
  const onBed = findPrinting(items)?.item.id;
  const query = search.trim().toLowerCase();
  const shown = query
    ? builds.filter((build) =>
        `${itemName(build, "build")} ${build.forWhom ?? ""} ${build.note}`.toLowerCase().includes(query),
      )
    : builds;

  function reset(next: boolean) {
    onOpenChange(next);
    if (!next) {
      // After the closing animation, so the sheet doesn't flick back to the list as it leaves.
      window.setTimeout(() => {
        setPicked(null);
        setSearch("");
      }, 300);
    }
  }

  function moveTo(build: ItemView, attemptId: string | null) {
    const moved = moveIntoBuild(
      queryClient,
      idea,
      { item: build, attemptId },
      (buildId) => void navigate({ to: "/builds/$buildId", params: { buildId } }),
    );
    if (!moved) return;
    reset(false);
    onMoved?.();
  }

  function choose(build: ItemView) {
    const live = build.attempts.filter((attempt) => !attempt.pending);
    // A build with no print yet has nowhere else to put it.
    if (!live.length) moveTo(build, null);
    else setPicked(build);
  }

  const attempts = picked?.attempts.filter((attempt) => !attempt.pending).toReversed() ?? [];

  return (
    <Sheet
      open={open}
      onOpenChange={reset}
      title={picked ? itemName(picked, "build") : "Add to a build"}
      description={picked ? "Which print is it about?" : "Its photos and note move over. You can undo it."}
      headerActions={
        picked ? <IconButton icon={BackIcon} label="Back to builds" onClick={() => setPicked(null)} /> : undefined
      }
      tall={!picked}
    >
      {picked ? (
        <div className="flex flex-col">
          {attempts.map((attempt, index) => {
            const photo = picked.photos.find((p) => p.attemptId === attempt.id);
            return (
              <PickRow
                key={attempt.id}
                autoFocus={index === 0}
                photo={photo ? { src: photoSrc(photo.id, "thumb"), color: photo.color || undefined } : null}
                title={`Attempt ${attempt.number}`}
                meta={`${attempt.outcome ? OUTCOME_LABELS[attempt.outcome] : "Printing"} · ${inlineTime(attempt.printedAt)}`}
                mark={index === 0 ? "Latest" : undefined}
                onSelect={() => moveTo(picked, attempt.id)}
              />
            );
          })}
          <Overline className="mt-4 mb-1">Or</Overline>
          <PickRow
            photo={null}
            title="The build itself"
            meta="With its own photos, not a print's"
            onSelect={() => moveTo(picked, null)}
          />
        </div>
      ) : (
        <>
          {isDesktop && (
            <TextField
              aria-label="Search builds"
              placeholder="Search builds"
              icon={SearchIcon}
              size="sm"
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                const first = shown[0];
                if (event.key === "Enter" && first) {
                  event.preventDefault();
                  choose(first);
                }
              }}
              className="mb-3"
            />
          )}
          {shown.length ? (
            <div className="flex flex-col">
              {shown.map((build) => {
                const printing = build.id === onBed;
                const prints = build.attempts.length;
                return (
                  <PickRow
                    key={build.id}
                    photo={photoOf(build)}
                    title={itemName(build, "build")}
                    meta={
                      build.stage === "done"
                        ? "Done"
                        : build.stage === "shelved"
                          ? "Shelved"
                          : prints
                            ? `${prints} ${prints === 1 ? "attempt" : "attempts"}`
                            : "No attempts yet"
                    }
                    mark={printing ? "On the bed" : undefined}
                    onSelect={() => choose(build)}
                  />
                );
              })}
            </div>
          ) : (
            <p className="text-body text-ink-soft py-6">
              {builds.length ? "No build by that name." : "No builds yet. Start one from an idea, and it will be here."}
            </p>
          )}
        </>
      )}
    </Sheet>
  );
}
