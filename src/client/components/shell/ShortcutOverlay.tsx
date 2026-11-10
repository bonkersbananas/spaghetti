import { Sheet } from "@/components/ui/Sheet";
import { ShortcutList } from "@/components/ui/ShortcutList";
import { usePalette } from "@/lib/palette";
import { useIsDesktop } from "@/lib/use-media-query";

/** `?`: every shortcut, grouped by screen, read from the same registry the keys use. Desktop only. */
export function ShortcutOverlay() {
  const { helpOpen, setHelpOpen } = usePalette();
  const isDesktop = useIsDesktop();
  return (
    <Sheet
      open={helpOpen && isDesktop}
      onOpenChange={setHelpOpen}
      title="Keyboard shortcuts"
      description="Keys are ignored while you type in a field."
      wide
    >
      <ShortcutList className="pt-2" />
    </Sheet>
  );
}
