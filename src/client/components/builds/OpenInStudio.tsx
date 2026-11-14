import { fileUrl } from "@shared/api";
import { type OpenPart, openTarget } from "@shared/open-link";
import { useEffect } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { OpenInAppIcon } from "@/components/ui/icons";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { useCanOpenInStudio, useOpenInStudio } from "@/lib/open-in-studio";

type OpenableFile = Parameters<typeof useOpenInStudio>[0];

/** What it opens, said once in the button's tooltip: the sliced file is what you would print. */
const WHAT: Record<OpenPart, string> = {
  sliced: "Opens the sliced file in Bambu Studio, ready to print",
  file: "Opens the file in Bambu Studio",
};

/**
 * "Open in Bambu Studio" for one kept file, on a computer only (decision 0058): one quiet button. A sliced model
 * opens its sliced file; otherwise the file itself. A browser can't tell whether the app opened, so for a few
 * seconds the button gives way to "Nothing opened? Download it instead". Nothing shows where Bambu Studio can't run
 * or there is nothing it can open (an .stl that isn't sliced).
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
  const { target, state, open } = useOpenInStudio(file);
  const asked = state.phase === "tried" || state.phase === "failed";
  // On a card the icon stays put; the fallback comes as a quiet toast, with the plain download in it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per tap.
  useEffect(() => {
    if (!icon || !target || !asked) return;
    toast.action(state.phase === "failed" ? "Couldn't open it just now." : "Nothing opened?", {
      label: "Download it instead",
      onClick: () => {
        const link = document.createElement("a");
        link.href = fileUrl(file.id, target.part);
        link.download = target.name;
        document.body.append(link);
        link.click();
        link.remove();
      },
    });
  }, [state.phase]);
  if (!allowed || !target) return null;
  if (icon) {
    return (
      <IconButton
        icon={OpenInAppIcon}
        size="sm"
        label="Open in Bambu Studio"
        title={WHAT[target.part]}
        aria-busy={state.phase === "asking" || undefined}
        data-testid="open-in-studio"
        className={className}
        onClick={() => void open()}
      />
    );
  }
  if (state.phase === "tried" || state.phase === "failed") {
    const failed = state.phase === "failed";
    return (
      <p role="status" className="text-small text-ink-soft py-2 text-pretty">
        {failed ? "Couldn't open it just now. " : "Opening in Bambu Studio… Nothing opened? "}
        <a
          href={fileUrl(file.id, target.part)}
          download={target.name}
          className="focus-ring text-ink hover:text-tomato rounded-xs font-semibold underline underline-offset-2"
        >
          Download it instead
        </a>
      </p>
    );
  }
  return (
    <Button
      variant="quiet"
      size={size}
      icon={OpenInAppIcon}
      loading={state.phase === "asking"}
      title={WHAT[target.part]}
      data-testid="open-in-studio"
      className={className}
      onClick={() => void open()}
    >
      Open in Bambu Studio
    </Button>
  );
}

/** The one file of an idea or build that Bambu Studio can open, when it has exactly one: the page's way in. */
export function onlyOpenable<F extends OpenableFile>(files: readonly F[] | undefined): F | undefined {
  const openable = (files ?? []).filter((file) => openTarget(file));
  return openable.length === 1 ? openable[0] : undefined;
}

/** The page-level "Open in Bambu Studio", beside the page's other quiet actions. */
export function OpenOnlyFile({ files }: { files: readonly OpenableFile[] | undefined }) {
  const file = onlyOpenable(files);
  return file ? <OpenInStudio file={file} size="md" /> : null;
}
