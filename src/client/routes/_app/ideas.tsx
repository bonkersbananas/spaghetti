import { createFileRoute } from "@tanstack/react-router";
import { EmptyPot } from "@/components/illustrations";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PlusIcon } from "@/components/ui/icons";
import { useCapture } from "@/lib/capture";
import { useIsDesktop } from "@/lib/use-media-query";

export const Route = createFileRoute("/_app/ideas")({
  component: Ideas,
});

function Ideas() {
  const { setOpen } = useCapture();
  // On desktop the sidebar's "New idea" is the screen's one primary action.
  const isDesktop = useIsDesktop();
  return (
    <>
      <PageHeader title="Ideas" subtitle="The inbox. Every print starts as a half-thought." />
      <EmptyState
        className="py-10 md:py-20"
        illustration={<EmptyPot />}
        title="Nothing simmering yet"
        action={
          <Button
            variant={isDesktop ? "secondary" : "primary"}
            icon={PlusIcon}
            shortcut={["C"]}
            onClick={() => setOpen(true)}
          >
            Capture an idea
          </Button>
        }
      >
        Snap a photo of something that could be printed, or jot down a line. Titles can wait; tidy up later.
      </EmptyState>
    </>
  );
}
