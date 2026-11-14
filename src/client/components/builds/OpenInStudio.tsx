import { fileUrl } from "@shared/api";
import { type OpenChoice, openChoices } from "@shared/open-link";
import { useEffect } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { ExpandIcon, ModelIcon, OpenInAppIcon, SlicerFileIcon } from "@/components/ui/icons";
import { MenuGroup, MenuItem } from "@/components/ui/Menu";
import { Popover, PopoverClose } from "@/components/ui/Popover";
import { toast } from "@/components/ui/Toast";
import { useCanOpenInStudio, useOpenInStudio } from "@/lib/open-in-studio";

type OpenableFile = Parameters<typeof useOpenInStudio>[0];

/** What one choice opens, said once in the tooltip. */
const WHAT = (choice: OpenChoice) =>
  choice.part === "sliced"
    ? "Opens the sliced file in Bambu Studio, ready to print"
    : "Opens the file in Bambu Studio, to slice or tweak";

/**
 * "Open in Bambu Studio" for one kept file, on a computer only (decisions 0058 and 0059): one quiet button. With one
 * thing to open (an unsliced model, a slicer file) a tap opens it; a sliced model has two, its sliced file (ready to
 * print) and its original model (to slice or tweak), so the button opens a small menu of those two, the sliced file
 * first. A browser can't tell whether the app opened, so afterwards "Nothing opened? Download it instead" shows for
 * a few seconds. Nothing shows where Bambu Studio can't run or there is nothing it can open.
 */
export function OpenInStudio({
  file,
  size = "sm",
  icon = false,
  className,
}: {
  file: OpenableFile;
  size?: "sm" | "md";
  /** Only the icon, among a card's actions beside Download; the fallback is then a toast. */
  icon?: boolean;
  className?: string;
}) {
  const allowed = useCanOpenInStudio();
  const { choices, state, open } = useOpenInStudio(file);
  const asked = state.phase === "tried" || state.phase === "failed";
  const asking = state.phase === "asking";
  const download = (choice: OpenChoice) => fileUrl(file.id, choice.part);
  // On a card the icon stays put; the fallback comes as a quiet toast, with the plain download in it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per tap.
  useEffect(() => {
    if (!icon || !asked) return;
    const choice = state.choice;
    toast.action(state.phase === "failed" ? "Couldn't open it just now." : "Nothing opened?", {
      label: "Download it instead",
      onClick: () => {
        const link = document.createElement("a");
        link.href = download(choice);
        link.download = choice.download;
        document.body.append(link);
        link.click();
        link.remove();
      },
    });
  }, [state.phase]);
  const first = choices[0];
  if (!allowed || !first) return null;
  if (!icon && asked) {
    const failed = state.phase === "failed";
    return (
      <p role="status" className="text-small text-ink-soft py-2 text-pretty">
        {failed ? "Couldn't open it just now. " : "Opening in Bambu Studio… Nothing opened? "}
        <a
          href={download(state.choice)}
          download={state.choice.download}
          className="focus-ring text-ink hover:text-tomato rounded-xs font-semibold underline underline-offset-2"
        >
          Download it instead
        </a>
      </p>
    );
  }
  const several = choices.length > 1;
  const trigger = icon ? (
    <IconButton
      icon={OpenInAppIcon}
      size="sm"
      label="Open in Bambu Studio"
      title={several ? "Open in Bambu Studio: the sliced file or the original model" : WHAT(first)}
      aria-busy={asking || undefined}
      data-testid="open-in-studio"
      className={className}
      onClick={several ? undefined : () => void open(first)}
    />
  ) : (
    <Button
      variant="quiet"
      size={size}
      icon={OpenInAppIcon}
      loading={asking}
      title={several ? "Open the sliced file or the original model in Bambu Studio" : WHAT(first)}
      data-testid="open-in-studio"
      className={className}
      onClick={several ? undefined : () => void open(first)}
    >
      Open in Bambu Studio
      {several && <ExpandIcon size={14} className="-mr-1 shrink-0" aria-hidden />}
    </Button>
  );
  if (!several) return trigger;
  return (
    <Popover trigger={trigger} side="bottom" align="end" label="Open in Bambu Studio" className="w-64 p-2">
      <MenuGroup size="sm" className="mx-0">
        {choices.map((choice) => (
          <PopoverClose asChild key={choice.part}>
            <MenuItem
              icon={choice.part === "sliced" ? SlicerFileIcon : ModelIcon}
              hint={choice.hint}
              data-testid={`open-in-studio-${choice.part}`}
              onClick={() => void open(choice)}
            >
              {choice.label}
            </MenuItem>
          </PopoverClose>
        ))}
      </MenuGroup>
    </Popover>
  );
}

/** The one file of an idea or build that Bambu Studio can open, when it has exactly one: the page's way in. */
export function onlyOpenable<F extends OpenableFile>(files: readonly F[] | undefined): F | undefined {
  const openable = (files ?? []).filter((file) => openChoices(file).length > 0);
  return openable.length === 1 ? openable[0] : undefined;
}

/** The page-level "Open in Bambu Studio", beside the page's other quiet actions. */
export function OpenOnlyFile({ files }: { files: readonly OpenableFile[] | undefined }) {
  const file = onlyOpenable(files);
  return file ? <OpenInStudio file={file} size="md" /> : null;
}
