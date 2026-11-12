import { OUTCOME_LABELS, type Outcome } from "@shared/attempts";
import { relativeTime } from "@shared/time";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { outcomeIcons } from "@/components/builds/Outcome";
import { Chip } from "@/components/ui/Chip";
import { TextField } from "@/components/ui/Field";
import { BuildsIcon, PrintingIcon, SearchIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { Overline } from "@/components/ui/Overline";
import { PickRow } from "@/components/ui/PickRow";
import { Sheet } from "@/components/ui/Sheet";
import { findPrinting, newestPhoto } from "@/lib/builds";
import { cn } from "@/lib/cn";
import { type AttemptView, type ItemView, useBuilds } from "@/lib/items";
import { moveIntoBuild } from "@/lib/move";
import { fileThumbSrc, photoSrc } from "@/lib/previews";
import { usePrintProgress } from "@/lib/print-progress";
import { itemName } from "@/lib/recent";
import { useIsDesktop } from "@/lib/use-media-query";

interface MoveToBuildSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  idea: ItemView;
  /** Called once the move is under way (the idea page leaves for Ideas). */
  onMoved?: () => void;
}

const inks: Record<Outcome | "printing", string> = {
  success: "text-basil-ink",
  partial: "text-semolina-ink",
  failed: "text-tomato-ink",
  printing: "text-semolina-ink",
};
const tiles: Record<Outcome | "printing", string> = {
  success: "bg-basil-soft text-basil-ink",
  partial: "bg-semolina-soft text-semolina-ink",
  failed: "bg-tomato-soft text-tomato-ink",
  printing: "bg-semolina-soft text-semolina-ink",
};

/** The build's newest photo, else the slicer's picture of its latest plate. Null: the glyph tile stands in. */
function pictureOf(build: ItemView) {
  const photo = newestPhoto(build);
  if (photo) return { src: photoSrc(photo.id, "thumb"), color: photo.color || undefined };
  const plate = build.attempts.findLast((attempt) => attempt.file?.hasThumb)?.file;
  return plate ? { src: fileThumbSrc(plate.id), fit: "contain" as const } : null;
}

/** "30 min left", "Done by now" or "On the bed": the progress sentence kept short. */
function useLeft(attempt: AttemptView | undefined): string | null {
  const progress = usePrintProgress(attempt?.id, attempt?.printedAt ?? 0, attempt?.settings.estimatedMinutes);
  if (!attempt) return null;
  if (progress.state === "due") return "Done by now";
  if (progress.state === "unknown") return null;
  return (progress.label.split(" · ").at(-1) ?? progress.label).replace(/^[Aa]bout /, "");
}

function BuildMeta({ build, printing }: { build: ItemView; printing?: AttemptView }) {
  const left = useLeft(printing);
  const last = build.attempts.at(-1);
  const count = build.attempts.length;
  const pieces: ReactNode[] = [];
  if (printing) {
    pieces.push(
      <span key="bed" className="text-semolina-ink font-semibold">
        On the bed
      </span>,
    );
    if (left) pieces.push(<span key="left">{left}</span>);
  } else if (last?.outcome) {
    pieces.push(
      <span key="outcome" className={cn("font-semibold", inks[last.outcome])}>
        {OUTCOME_LABELS[last.outcome]}
      </span>,
    );
  }
  pieces.push(
    <span key="count">{count ? `${count} ${count === 1 ? "attempt" : "attempts"}` : "No attempts yet"}</span>,
  );
  return <MetaList>{pieces}</MetaList>;
}

function AttemptMeta({ attempt }: { attempt: AttemptView }) {
  const left = useLeft(attempt.outcome ? undefined : attempt);
  const tone = attempt.outcome ?? "printing";
  return (
    <MetaList>
      <span className={cn("font-semibold", inks[tone])}>
        {attempt.outcome ? OUTCOME_LABELS[attempt.outcome] : "Printing"}
      </span>
      <span>{left ?? relativeTime(attempt.printedAt)}</span>
    </MetaList>
  );
}

/**
 * "Add to a build…": the active builds with the one on the bed first and the rest by when they were last touched,
 * then Done and Shelved a step quieter (searchable on desktop). A build with attempts then asks which print: the
 * newest is the suggestion. A tap on the last choice moves; there is no confirm step, the toast offers Undo.
 */
export function MoveToBuildSheet({ open, onOpenChange, idea, onMoved }: MoveToBuildSheetProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { items } = useBuilds();
  const [picked, setPicked] = useState<ItemView | null>(null);
  const [search, setSearch] = useState("");

  const onBed = findPrinting(items);
  const { active, finished } = useMemo(() => {
    const query = search.trim().toLowerCase();
    const ready = items
      .filter((build) => !build.pending)
      .filter(
        (build) =>
          !query || `${itemName(build, "build")} ${build.forWhom ?? ""} ${build.note}`.toLowerCase().includes(query),
      );
    const bedId = findPrinting(items)?.item.id;
    const byRecent = (a: ItemView, b: ItemView) => b.updatedAt - a.updatedAt;
    return {
      active: ready
        .filter((build) => build.stage === "building")
        .sort((a, b) => Number(b.id === bedId) - Number(a.id === bedId) || byRecent(a, b)),
      finished: ready.filter((build) => build.stage !== "building").sort(byRecent),
    };
  }, [items, search]);

  function close(next: boolean) {
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
    close(false);
    onMoved?.();
  }

  function choose(build: ItemView) {
    // A build with no print yet has nowhere else to put it.
    if (!build.attempts.some((attempt) => !attempt.pending)) moveTo(build, null);
    else setPicked(build);
  }

  const attempts = picked?.attempts.filter((attempt) => !attempt.pending).toReversed() ?? [];

  const row = (build: ItemView, quiet?: boolean) => {
    const printing = onBed?.item.id === build.id ? onBed.attempt : undefined;
    const picture = pictureOf(build);
    return (
      <PickRow
        key={build.id}
        quiet={quiet}
        photo={picture}
        glyph={{ icon: BuildsIcon }}
        title={itemName(build, "build")}
        meta={
          quiet ? (
            <MetaList>
              <span>{build.stage === "done" ? "Done" : "Shelved"}</span>
              <span>{relativeTime(build.finishedAt ?? build.updatedAt)}</span>
            </MetaList>
          ) : (
            <BuildMeta build={build} printing={printing} />
          )
        }
        onSelect={() => choose(build)}
      />
    );
  };

  return (
    <Sheet
      open={open}
      onOpenChange={close}
      title={picked ? itemName(picked, "build") : "Add to a build"}
      description={picked ? "Which print is it about?" : "Its photos and note move over. You can undo it."}
      back={picked ? { label: "Back to builds", onClick: () => setPicked(null) } : undefined}
      tall={!picked}
    >
      {picked ? (
        <div className="flex flex-col">
          {attempts.map((attempt, index) => {
            const photo = picked.photos.find((p) => p.attemptId === attempt.id);
            const tone = attempt.outcome ?? "printing";
            return (
              <PickRow
                key={attempt.id}
                autoFocus={index === 0}
                photo={
                  photo
                    ? { src: photoSrc(photo.id, "thumb"), color: photo.color || undefined }
                    : attempt.file?.hasThumb
                      ? { src: fileThumbSrc(attempt.file.id), fit: "contain" }
                      : null
                }
                glyph={{ icon: attempt.outcome ? outcomeIcons[attempt.outcome] : PrintingIcon, tone: tiles[tone] }}
                title={`Attempt ${attempt.number}`}
                mark={index === 0 ? <Chip>Latest</Chip> : undefined}
                meta={<AttemptMeta attempt={attempt} />}
                onSelect={() => moveTo(picked, attempt.id)}
              />
            );
          })}
          <Overline className="mt-4 mb-1">Or</Overline>
          <PickRow
            photo={pictureOf(picked)}
            glyph={{ icon: BuildsIcon }}
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
                const first = active[0] ?? finished[0];
                if (event.key === "Enter" && first) {
                  event.preventDefault();
                  choose(first);
                }
              }}
              className="mb-3"
            />
          )}
          {active.length + finished.length ? (
            <div className="flex flex-col">
              {active.map((build) => row(build))}
              {finished.length > 0 && (
                <>
                  <Overline className="mt-5 mb-1" count={finished.length}>
                    Done and shelved
                  </Overline>
                  {finished.map((build) => row(build, true))}
                </>
              )}
            </div>
          ) : (
            <p className="text-body text-ink-soft py-6">
              {items.length ? "No build by that name." : "No builds yet. Start one from an idea, and it will be here."}
            </p>
          )}
        </>
      )}
    </Sheet>
  );
}
