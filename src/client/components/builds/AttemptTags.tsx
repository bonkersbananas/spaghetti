import { tagLabel } from "@shared/attempts";
import { Chip } from "@/components/ui/Chip";
import { CheckIcon } from "@/components/ui/icons";
import { useTagOptions } from "@/lib/builds";
import type { AttemptView } from "@/lib/items";

/** An attempt's failure tags (tomato) and success notes (basil) as chips; nothing when it has none. */
export function AttemptTags({ attempt }: { attempt: Pick<AttemptView, "failureTags" | "successNotes"> }) {
  const failureOptions = useTagOptions("failure");
  const successOptions = useTagOptions("success");
  if (attempt.failureTags.length === 0 && attempt.successNotes.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
      {attempt.failureTags.map((slug) => (
        <li key={`f-${slug}`}>
          <Chip tone="tomato">{tagLabel("failure", slug, failureOptions)}</Chip>
        </li>
      ))}
      {attempt.successNotes.map((slug) => (
        <li key={`s-${slug}`}>
          <Chip tone="basil" icon={CheckIcon}>
            {tagLabel("success", slug, successOptions)}
          </Chip>
        </li>
      ))}
    </ul>
  );
}
