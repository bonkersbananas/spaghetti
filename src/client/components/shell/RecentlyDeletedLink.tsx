import { Link } from "@tanstack/react-router";
import { TrashIcon } from "@/components/ui/icons";

/** The quiet way to the things deleted lately, at the bottom of Ideas and Builds. */
export function RecentlyDeletedLink() {
  return (
    <p className="mt-10 flex">
      <Link
        to="/deleted"
        className="text-small text-ink-faint hover:text-ink-soft focus-ring -ml-2 inline-flex items-center gap-1.5 rounded-md px-2 py-3 font-semibold"
      >
        <TrashIcon size={14} aria-hidden /> Recently deleted
      </Link>
    </p>
  );
}
