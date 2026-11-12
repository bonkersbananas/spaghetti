import type { Twist } from "@shared/api";
import { changeChip } from "@shared/twists";
import { Card } from "@/components/ui/Card";
import { photoSrc } from "@/lib/previews";

/** "Scale 84 % · Fit tolerance +0.2 mm": what we changed, in a quiet line. */
export const changesLine = (twist: Pick<Twist, "changes">) => twist.changes.map(changeChip).filter(Boolean).join(" · ");

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
  return (
    <Card
      headingLevel={2}
      title={twist.name}
      photo={
        photo ? { src: photoSrc(photo.id, "large"), alt: "", color: photo.color || undefined, id: photo.id } : undefined
      }
      sub={sourceLine(twist) || undefined}
      meta={changesLine(twist) || "No changes written down yet"}
      link={{ to: "/twists/$twistId", params: { twistId: twist.id } }}
      className={className}
    />
  );
}
