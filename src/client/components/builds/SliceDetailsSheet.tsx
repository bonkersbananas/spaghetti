import type { ReactNode } from "react";
import { Sheet } from "@/components/ui/Sheet";

/** How a model was sliced, on a phone: a small sheet (loaded when first opened, ModelFile.tsx). */
export default function SliceDetailsSheet({
  open,
  onOpenChange,
  name,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Sliced by Spaghetti" description={name} desktop="dialog">
      {children}
    </Sheet>
  );
}
