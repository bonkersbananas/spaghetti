import { Link } from "@tanstack/react-router";
import { TrashIcon } from "@/components/ui/icons";

/** The quiet way to the things deleted lately, at the bottom of Ideas and Builds. */
export function RecentlyDeletedLink() {
  return (
    <p className="mt-14 flex justify-center">
      <Link
        to="/deleted"
        className="text-small text-ink-faint hover:text-ink-soft focus-ring inline-flex items-center gap-1.5 rounded-md px-2 py-2.5 font-semibold"
      >
        <TrashIcon size={14} aria-hidden /> Recently deleted
      </Link>
    </p>
  );
}
