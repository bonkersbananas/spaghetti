import { Section } from "@/components/ui/Section";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * The slicing defaults before their code arrives: the same heading as SlicingDefaults' over the shape of its folded
 * panel (a line of summary on desktop, two on a phone), so nothing moves when it lands.
 */
export function SlicingDefaultsSkeleton() {
  return (
    <Section id="printer-slicing-loading" title="Slicing" size="title">
      <Skeleton className="h-22 rounded-lg md:h-18" />
    </Section>
  );
}
