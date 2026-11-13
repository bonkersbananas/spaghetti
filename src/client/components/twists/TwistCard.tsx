import type { Twist } from "@shared/api";
import { changeChip } from "@shared/twists";
import { Card } from "@/components/ui/Card";
import { fileThumbSrc, hasPreview, photoSrc } from "@/lib/previews";

/** "Scale 84 % · Fit tolerance +0.2 mm · 2 more": what we changed in one quiet line, the first two in full. */
export const changesLine = (twist: Pick<Twist, "changes">) => {
  const written = twist.changes.map(changeChip).filter(Boolean);
  const shown = written.slice(0, 2).join(" · ");
  return written.length > 2 ? `${shown} · ${written.length - 2} more` : shown;
};

/** "From MakerWorld", or what the model is called; a twist with no source says it is our own idea. */
export const sourceLine = (twist: Pick<Twist, "source">) =>
  [
    twist.source.place ? `From ${twist.source.place}` : null,
    twist.source.designer ? `by ${twist.source.designer}` : null,
  ]
    .filter(Boolean)
    .join(" ");

/** A twist as a notebook card: the picture first, its name, where it came from and what we changed. */
export function TwistCard({ twist, className }: { twist: Twist; className?: string }) {
  const photo = twist.source.photo;
  // No picture of the model's page: the plate picture of the model we keep is the cover, as on an idea card.
  const model = twist.model;
  const plate = !photo && model && (model.hasThumb || hasPreview(model.id)) ? model : undefined;
  return (
    <Card
      headingLevel={2}
      title={twist.name}
      photo={
        photo
          ? { src: photoSrc(photo.id, "large"), alt: "", color: photo.color || undefined, id: photo.id }
          : plate
            ? { src: fileThumbSrc(plate), alt: `Slicer preview: ${twist.name}`, fit: "contain" }
            : undefined
      }
      // Without a picture the card is an index card: the twist's own words, else what we changed, else its name.
      note={photo || plate ? undefined : twist.note.trim() || changesLine(twist) || twist.name}
      sub={sourceLine(twist) || undefined}
      meta={changesLine(twist) || "No changes written down yet"}
      link={{ to: "/twists/$twistId", params: { twistId: twist.id } }}
      className={className}
    />
  );
}
