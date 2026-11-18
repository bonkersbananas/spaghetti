import { modelMarkIn } from "@shared/model-mark";
import { relativeTime } from "@shared/time";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { coverPhoto } from "@/components/ui/Card";
import { TextField } from "@/components/ui/Field";
import { IdeasIcon, LinkIcon, PlusIcon, SearchIcon, SlicerFileIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { Overline } from "@/components/ui/Overline";
import { useFilePicker } from "@/components/ui/PhotoTiles";
import { PickRow } from "@/components/ui/PickRow";
import { Sheet } from "@/components/ui/Sheet";
import { startBuild } from "@/lib/builds";
import { type ItemView, useIdeas } from "@/lib/items";
import { coverOf } from "@/lib/previews";
import { itemName } from "@/lib/recent";
import { isSlicerFile, SLICER_ACCEPT, useSlicerDropTarget } from "@/lib/slicer-drop";
import { startBuildFrom } from "@/lib/start-build";
import { useIsDesktop } from "@/lib/use-media-query";

interface StartBuildSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Something new": a build from scratch, opened with its title ready to type. */
  onFromScratch: () => void;
}

const isLink = (text: string) => /^https?:\/\/\S+$/i.test(text.trim());

const hasModel = (idea: ItemView) => !!idea.files?.length || !!modelMarkIn(idea.note);

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

/**
 * "What are you printing?": where "Start a build" begins. An idea is picked (it becomes the build, as Start building
 * does), or a model link or file starts one that has it, or "Something new" opens a blank one. Type to filter, arrows
 * walk the rows, Enter takes the first. With no ideas it goes straight to the link and file.
 */
export function StartBuildSheet({ open, onOpenChange, onFromScratch }: StartBuildSheetProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { items: ideas } = useIdeas();
  const [search, setSearch] = useState("");
  const [step, setStep] = useState<"ideas" | "model">("ideas");
  const [link, setLink] = useState("");
  const list = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => groupIdeas(ideas, search), [ideas, search]);
  const first = groups.upNext[0] ?? groups.withModel[0] ?? groups.others[0];
  const noIdeas = ideas.length === 0;
  const showModel = step === "model" || noIdeas;

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      // After the closing animation, so the sheet doesn't flick back to its first step as it leaves.
      window.setTimeout(() => {
        setSearch("");
        setLink("");
        setStep("ideas");
      }, 300);
    }
  }

  const open_ = (buildId: string, isNew = false) =>
    void navigate({ to: "/builds/$buildId", params: { buildId }, search: isNew ? { new: true } : {} });

  function pick(idea: ItemView) {
    startBuild(queryClient, idea);
    close(false);
    open_(idea.id);
  }

  function withLink(url: string) {
    const id = startBuildFrom(queryClient, { link: url.trim() });
    if (!id) return;
    close(false);
    open_(id);
  }

  function withFile(file: File) {
    if (!isSlicerFile(file)) return;
    const id = startBuildFrom(queryClient, { file });
    if (!id) return;
    close(false);
    open_(id);
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

  function walk(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [...(list.current?.querySelectorAll<HTMLElement>("button") ?? [])];
    if (!rows.length) return;
    const at = rows.findIndex((row) => row === document.activeElement);
    const next = event.key === "ArrowDown" ? at + 1 : at - 1;
    // Up from the first row goes back to the search field.
    if (next < 0) return void (event.currentTarget.querySelector("input")?.focus(), event.preventDefault());
    event.preventDefault();
    rows[Math.min(rows.length - 1, next)]?.focus();
  }

  const row = (idea: ItemView, label?: string) => {
    const mark = modelMarkIn(idea.note);
    const picture = coverPhoto(coverOf(idea), "") ?? null;
    return (
      <PickRow
        key={idea.id}
        photo={picture}
        glyph={{ icon: IdeasIcon }}
        title={itemName(idea, "idea")}
        meta={
          <MetaList>
            {label ? <span>{label}</span> : null}
            {idea.files?.length ? <span>{idea.files[0]?.name}</span> : mark ? <span>{mark.name}</span> : null}
            {!label && !idea.files?.length && !mark ? <span>{relativeTime(idea.createdAt)}</span> : null}
          </MetaList>
        }
        onSelect={() => pick(idea)}
      />
    );
  };

  const section = (title: string, rows: ItemView[], label?: string) =>
    rows.length > 0 && (
      <div className="flex flex-col">
        <Overline className="mt-5 mb-1 first:mt-0" count={rows.length}>
          {title}
        </Overline>
        {rows.map((idea) => row(idea, label))}
      </div>
    );

  return (
    <Sheet
      open={open}
      onOpenChange={close}
      title="What are you printing?"
      description={
        showModel
          ? noIdeas
            ? "No ideas yet. Start from a model, or from nothing."
            : "A model link or an .stl or .3mf file."
          : "Pick an idea, and it becomes the build."
      }
      back={step === "model" && !noIdeas ? { label: "Back to ideas", onClick: () => setStep("ideas") } : undefined}
      tall={!showModel}
      footer={
        showModel ? undefined : (
          <div className="flex gap-2">
            <Button variant="secondary" icon={LinkIcon} onClick={() => setStep("model")} className="flex-1">
              Link or file
            </Button>
            <Button variant="secondary" icon={PlusIcon} onClick={scratch} className="flex-1">
              Something new
            </Button>
          </div>
        )
      }
    >
      {filePicker.input}
      {showModel ? (
        <div className="flex flex-col gap-4">
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
            <Button type="submit" variant="primary" disabled={!isLink(link)}>
              Start with this link
            </Button>
          </form>
          <Overline>Or</Overline>
          <Button variant="secondary" icon={SlicerFileIcon} onClick={filePicker.open}>
            {isDesktop ? "Choose or drop a file" : "Choose a file"}
          </Button>
          <Button variant="quiet" icon={PlusIcon} onClick={scratch}>
            Something new
          </Button>
        </div>
      ) : (
        // biome-ignore lint/a11y/noStaticElementInteractions: arrow keys walk the rows; the rows are buttons.
        <div onKeyDown={walk}>
          <TextField
            aria-label="Search ideas"
            placeholder="Search ideas"
            icon={SearchIcon}
            size="sm"
            autoFocus={isDesktop}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (isLink(search)) withLink(search);
              else if (first) pick(first);
            }}
            className="mb-3"
          />
          <div ref={list} className="flex flex-col">
            {isLink(search) && (
              <PickRow
                glyph={{ icon: LinkIcon }}
                title="Start a build with this link"
                meta={search.trim()}
                onSelect={() => withLink(search)}
              />
            )}
            {section("Up next", groups.upNext)}
            {section("With a model", groups.withModel)}
            {section(groups.upNext.length || groups.withModel.length ? "Other ideas" : "Ideas", groups.others)}
            {!first && !isLink(search) && <p className="text-body text-ink-soft py-6">No idea by that name.</p>}
          </div>
        </div>
      )}
    </Sheet>
  );
}
