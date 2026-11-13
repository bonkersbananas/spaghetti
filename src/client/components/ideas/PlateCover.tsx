import type { AttemptFile } from "@shared/api";
import { SlicerPreviewBadge } from "@/components/ui/Card";
import { Photo } from "@/components/ui/Photo";
import { cn } from "@/lib/cn";
import { fileThumbSrc } from "@/lib/previews";

/**
 * An idea with no photo yet but a model or slicer file: the newest plate picture is its cover, where the photos go
 * and at their 4:3, the whole model contained on the viewer's deep paper and labeled "Slicer preview", so nobody
 * takes the render for a print. The first real photo takes its place.
 */
export function PlateCover({
  file,
  alt,
  className,
}: {
  file: Pick<AttemptFile, "id">;
  alt: string;
  className?: string;
}) {
  return (
    <figure className={cn("relative", className)}>
      <Photo
        src={fileThumbSrc(file.id)}
        alt={alt}
        fit="contain"
        frame="deep"
        eager
        className="aspect-4/3 max-h-[72dvh] w-full p-6 md:rounded-xl md:p-10"
      />
      <span className="absolute top-3 left-3">
        <SlicerPreviewBadge />
      </span>
    </figure>
  );
}
