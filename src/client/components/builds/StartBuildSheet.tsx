import { isLink, linkWords } from "@shared/links";
import { modelMarkIn, modelMarkOf } from "@shared/model-mark";
import { relativeTime } from "@shared/time";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { ideaTile } from "@/components/ideas/pick-tile";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { LinkIcon, PlusIcon, SearchIcon, SlicerFileIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { MetaList } from "@/components/ui/MetaList";
import { Overline } from "@/components/ui/Overline";
import { AddPhotoTile, useFilePicker } from "@/components/ui/PhotoTiles";
import { PickRow } from "@/components/ui/PickRow";
import { PickTile } from "@/components/ui/RankRow";
import { Sheet } from "@/components/ui/Sheet";
import { startBuild } from "@/lib/builds";
import { type ItemView, useIdeas } from "@/lib/items";
import { itemName } from "@/lib/recent";
import { isSlicerFile, SLICER_ACCEPT, useSlicerDropTarget } from "@/lib/slicer-drop";
import { startBuildFrom } from "@/lib/start-build";
import { useIsDesktop } from "@/lib/use-media-query";

interface StartBuildSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "From scratch": a build with nothing in it, opened with its title ready to type. */
  onFromScratch: () => void;
}

/** Where the model is: its file's kind ("STL", "3MF") or the site its link is on ("MakerWorld"); null when it has none. */
function modelPlace(idea: ItemView): string | null {
  const file = idea.files?.[0];
  if (file) return file.name.split(".").at(-1)?.toUpperCase() || null;
  const mark = modelMarkIn(idea.note);
  if (!mark) return null;
  return mark.kind === "file" ? mark.name.replace(/^\./, "").toUpperCase() : mark.name;
}

const hasModel = (idea: ItemView) => modelPlace(idea) !== null;

/** The ideas as the sheet lists them: Up next in queue order, then those with a model, then the rest (newest first). */
function groupIdeas(ideas: ItemView[], search: string) {
  const query = search.trim().toLowerCase();
  const found = ideas.filter(
    (idea) => !query || `${itemName(idea, "idea")} ${idea.forWhom ?? ""} ${idea.note}`.toLowerCase().includes(query),
  );
  const upNext = found.filter((idea) => idea.upNext !== null).sort((a, b) => (a.upNext ?? 0) - (b.upNext ?? 0));
  const rest = found.filter((idea) => idea.upNext === null);
  return {
    upNext,
    withModel: rest.filter(hasModel),
    others: rest.filter((idea) => !hasModel(idea)),
  };
}

/** What a pasted link is, the app's way: "Benchy · MakerWorld". */
function recognised(link: string): string | null {
  if (!isLink(link)) return null;
  const words = linkWords(link.trim());
  const site = modelMarkOf(link.trim())?.name ?? words?.site;
  return [words?.words, site].filter(Boolean).join(" · ") || null;
}

/**
 * "What are you printing?": where "Start a build" begins. An idea is picked, photo first (it becomes the build, as
 * Start building does), or a model link or file starts one that has it, or "From scratch" opens a blank one. On a
 * desktop, type to filter, arrows move the ringed tile and Enter starts it. With no ideas it goes straight to the
 * link and file.
 */
export function StartBuildSheet({ open, onOpenChange, onFromScratch }: StartBuildSheetProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { items: ideas } = useIdeas();
  const [search, setSearch] = useState("");
  const [step, setStep] = useState<"ideas" | "model">("ideas");
  const [link, setLink] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => groupIdeas(ideas, search), [ideas, search]);
  const flat = useMemo(() => [...groups.upNext, ...groups.withModel, ...groups.others], [groups]);
  const active = isDesktop ? (flat.find((idea) => idea.id === activeId) ?? flat[0]) : undefined;
  const noIdeas = ideas.length === 0;
  const showModel = step === "model" || noIdeas;

  // Keep the ringed tile in view while the arrow keys move it (not when the pointer or fresh data does: the list stays where it was scrolled).
  const byKey = useRef(false);
  const activeKey = active?.id;
  useEffect(() => {
    if (!activeKey || !byKey.current) return;
    byKey.current = false;
    list.current?.querySelector(`[data-tile="${activeKey}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeKey]);

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      // After the closing animation, so the sheet doesn't flick back to its first step as it leaves.
      window.setTimeout(() => {
        setSearch("");
        setLink("");
        setActiveId(null);
        setStep("ideas");
      }, 300);
    }
  }

  const show = (buildId: string) => void navigate({ to: "/builds/$buildId", params: { buildId } });

  function pick(idea: ItemView) {
    startBuild(queryClient, idea);
    close(false);
    show(idea.id);
  }

  function withLink(url: string) {
    const id = startBuildFrom(queryClient, { link: url.trim() });
    if (!id) return;
    close(false);
    show(id);
  }

  function withFile(file: File) {
    if (!isSlicerFile(file)) return;
    const id = startBuildFrom(queryClient, { file });
    if (!id) return;
    close(false);
    show(id);
  }

  const filePicker = useFilePicker({
    accept: SLICER_ACCEPT,
    testId: "build-file-input",
    onFiles: (files) => files[0] && withFile(files[0]),
  });
  // A model dropped anywhere while the sheet is open starts the build.
  useSlicerDropTarget((file) => withFile(file), open);

  function scratch() {
    close(false);
    onFromScratch();
  }

  /** Arrows across the grid: left and right go tile by tile, up and down to the nearest tile in that direction. */
  function walk(event: KeyboardEvent<HTMLElement>) {
    const arrows = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"];
    if (!arrows.includes(event.key) || !active) return;
    // In the search field, left and right still move the caret.
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if (event.target instanceof HTMLInputElement && event.target.value) return;
    }
    event.preventDefault();
    byKey.current = true;
    const index = flat.indexOf(active);
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const next = flat[Math.min(flat.length - 1, Math.max(0, index + (event.key === "ArrowRight" ? 1 : -1)))];
      if (next) setActiveId(next.id);
      return;
    }
    const down = event.key === "ArrowDown";
    const tiles = [...(list.current?.querySelectorAll<HTMLElement>("[data-tile]") ?? [])];
    const here = list.current?.querySelector<HTMLElement>(`[data-tile="${active.id}"]`)?.getBoundingClientRect();
    if (!here) return;
    let best: { id: string; score: number } | undefined;
    for (const tile of tiles) {
      const box = tile.getBoundingClientRect();
      const gap = down ? box.top - here.bottom : here.top - box.bottom;
      if (gap < -4) continue;
      const score = gap * 1000 + Math.abs(box.left - here.left);
      if (!best || score < best.score) best = { id: tile.dataset.tile ?? "", score };
    }
    if (best) setActiveId(best.id);
  }

  const tile = (idea: ItemView) => {
    const place = modelPlace(idea);
    const face = ideaTile(idea);
    return (
      <li key={idea.id} data-tile={idea.id} className="min-w-0">
        <PickTile
          title={face.caption}
          cutTitle={face.cutCaption}
          label={face.label}
          photo={face.photo}
          note={face.note}
          meta={
            <MetaList>
              {[place, relativeTime(idea.createdAt)]
                .filter((piece) => piece !== null)
                .map((piece) => (
                  <span key={piece}>{piece}</span>
                ))}
            </MetaList>
          }
          active={active?.id === idea.id}
          onActive={() => setActiveId(idea.id)}
          onToggle={() => pick(idea)}
        />
      </li>
    );
  };

  const section = (title: string, rows: ItemView[]) =>
    rows.length > 0 && (
      <section className="mt-5 first:mt-0" aria-label={title}>
        <Overline className="mb-2.5" count={rows.length}>
          {title}
        </Overline>
        <ul className="grid grid-cols-3 gap-x-3 gap-y-4 md:grid-cols-5 md:gap-x-4 md:gap-y-5">{rows.map(tile)}</ul>
      </section>
    );

  const seen = recognised(link);

  return (
    <Sheet
      open={open}
      onOpenChange={close}
      title={step === "model" && !noIdeas ? "From a link or a file" : "What are you printing?"}
      description={
        noIdeas
          ? "No ideas yet. Start from a model, or from scratch."
          : step === "model"
            ? "A model's page, or an .stl or .3mf file."
            : "Pick an idea, and it becomes the build."
      }
      back={step === "model" && !noIdeas ? { label: "Back to ideas", onClick: () => setStep("ideas") } : undefined}
      wide
      tall={!showModel}
      footer={
        showModel ? undefined : (
          <div className="flex w-full items-center gap-3 md:justify-between">
            <span className="text-caption text-ink-faint hidden items-center gap-3 md:flex">
              <Kbd keys={["↑", "↓"]} />
              <span className="flex items-center gap-1.5">
                <Kbd keys={["↵"]} /> Start building
              </span>
              <Kbd keys={["Esc"]} />
            </span>
            <div className="grid flex-1 grid-cols-2 gap-2 md:flex md:flex-none md:gap-3">
              <Button variant="secondary" icon={LinkIcon} onClick={() => setStep("model")} className="w-full md:w-auto">
                Link or file
              </Button>
              <Button variant="secondary" icon={PlusIcon} onClick={scratch} className="w-full md:w-auto">
                From scratch
              </Button>
            </div>
          </div>
        )
      }
    >
      {filePicker.input}
      {showModel ? (
        <div className="flex flex-col gap-3">
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (isLink(link)) withLink(link);
            }}
          >
            <TextField
              aria-label="Model link"
              placeholder="Paste a model link"
              icon={LinkIcon}
              type="url"
              inputMode="url"
              autoFocus={isDesktop}
              value={link}
              onChange={(event) => setLink(event.target.value)}
            />
            {seen && (
              <p className="text-small text-ink-soft -mt-1 px-1" aria-live="polite">
                {seen}
              </p>
            )}
            <AddPhotoTile size="row" icon={SlicerFileIcon} label="Choose an .stl or .3mf" onClick={filePicker.open} />
            <Button type="submit" variant="primary" disabled={!isLink(link)}>
              Start with this link
            </Button>
          </form>
          {noIdeas && (
            <Button variant="quiet" icon={PlusIcon} onClick={scratch}>
              From scratch
            </Button>
          )}
        </div>
      ) : (
        // biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move the ringed tile; the tiles are buttons.
        <div onKeyDown={walk}>
          {isDesktop && (
            <TextField
              aria-label="Search ideas"
              placeholder="Search ideas"
              icon={SearchIcon}
              size="sm"
              autoFocus
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setActiveId(null);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (isLink(search)) withLink(search);
                else if (active) pick(active);
              }}
              className="mb-4"
            />
          )}
          <div ref={list}>
            {isLink(search) && (
              <PickRow
                glyph={{ icon: LinkIcon }}
                title="Start a build with this link"
                meta={recognised(search) ?? search.trim()}
                onSelect={() => withLink(search)}
                className="mb-4"
              />
            )}
            {section("Up next", groups.upNext)}
            {section("Has a model", groups.withModel)}
            {section("The rest", groups.others)}
            {flat.length === 0 && !isLink(search) && (
              <p className="text-body text-ink-soft py-6">No idea by that name.</p>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
