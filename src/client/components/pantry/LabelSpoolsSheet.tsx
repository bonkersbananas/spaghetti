import type { Spool } from "@shared/api";
import { labelSpoolLine } from "@shared/label-read";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { CheckIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { acceptLabelRead, dismissLabelRead } from "@/lib/label-read";
import { useIsDesktop } from "@/lib/use-media-query";

interface LabelSpoolsSheetProps {
  spool: Spool;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * A photo with two or three labels: lists the spools Claude found, one tap adds them all. The first fills the spool
 * the photo was taken for; each other becomes a spool of its own with a copy of the photo.
 */
export function LabelSpoolsSheet({ spool, open, onOpenChange }: LabelSpoolsSheetProps) {
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const found = spool.labelRead?.status === "multiple" ? spool.labelRead.spools : [];
  const count = found.length;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`${count} spools on this label`}
      description="Claude found these in the photo. Nothing is added until you say so."
      footer={
        <>
          <Button
            variant="quiet"
            size={isDesktop ? "md" : "lg"}
            onClick={() => {
              void dismissLabelRead(queryClient, spool.id);
              onOpenChange(false);
            }}
          >
            Not these
          </Button>
          <Button
            variant="primary"
            size={isDesktop ? "md" : "lg"}
            icon={CheckIcon}
            disabled={count === 0}
            className="max-md:flex-1"
            onClick={() => {
              void acceptLabelRead(queryClient, spool);
              onOpenChange(false);
            }}
          >
            Add {count} spools
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-1">
        {found.map((label, index) => {
          const line = labelSpoolLine(label);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, shown once.
            <li key={index} className="flex items-center gap-3.5 py-2">
              <SpoolDisc color={label.colorHex} size="md" />
              <div className="flex min-w-0 flex-col">
                <span className="text-body text-ink truncate font-semibold">{line.title}</span>
                {line.detail && <span className="text-small text-ink-faint truncate">{line.detail}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
