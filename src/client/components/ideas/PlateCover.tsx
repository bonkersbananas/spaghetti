import { type AttemptFile, fileOriginalThumbUrl } from "@shared/api";
import { useState } from "react";
import { SlicerPreviewBadge } from "@/components/ui/Card";
import { Photo } from "@/components/ui/Photo";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
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
  file: Pick<AttemptFile, "id" | "slice">;
  alt: string;
  className?: string;
}) {
  // A model with colours of its own, matched to our filaments: the picture as it prints, or as the model has them.
  const original = fileOriginalThumbUrl(file);
  const [shown, setShown] = useState<"matched" | "original">("matched");
  return (
    <figure className={cn("relative", className)}>
      <Photo
        src={original && shown === "original" ? original : fileThumbSrc(file)}
        alt={alt}
        fit="contain"
        frame="deep"
        eager
        className="aspect-4/3 max-h-[72dvh] w-full p-6 md:rounded-xl md:p-10"
      />
      <span className="absolute top-3 left-3">
        <SlicerPreviewBadge />
      </span>
      {original && (
        <div className="mt-3 px-5 md:px-0">
          <SegmentedControl
            label="Colours shown"
            labelHidden
            options={[
              { value: "matched", label: "In our filaments" },
              { value: "original", label: "Model's colours" },
            ]}
            value={shown}
            onChange={setShown}
          />
        </div>
      )}
    </figure>
  );
}
