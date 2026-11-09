import type { AttemptHit, ItemHit, Photo as PhotoData } from "@shared/api";
import { type TagKind, tagLabel } from "@shared/attempts";
import { highlight, type SearchTerm, snippetSegments } from "@shared/search";
import { inlineTime, relativeTime } from "@shared/time";
import { Link, type LinkProps } from "@tanstack/react-router";
import { forwardRef, type ReactNode } from "react";
import { OutcomeChip } from "@/components/builds/Outcome";
import { summarizeSettings } from "@/components/builds/settings";
import { Chip } from "@/components/ui/Chip";
import { Highlight } from "@/components/ui/Highlight";
import { BuildsIcon, CheckIcon, FinishIcon, type Icon, IdeasIcon, ShelveIcon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/Photo";
import { Swatch } from "@/components/ui/Swatch";
import { useTagOptions } from "@/lib/builds";
import { cn } from "@/lib/cn";
import { photoSrc } from "@/lib/previews";

/** Where a result leads. */
export function attemptLink(hit: AttemptHit): LinkProps {
  return { to: "/builds/$buildId", params: { buildId: hit.item.id }, search: { attempt: hit.attempt.id } };
}

export function itemLink(hit: ItemHit): LinkProps {
  return hit.item.stage === "idea"
    ? { to: "/ideas/$ideaId", params: { ideaId: hit.item.id } }
    : { to: "/builds/$buildId", params: { buildId: hit.item.id } };
}

interface RowProps {
  link: LinkProps;
  photo: PhotoData | null;
  fallbackIcon: Icon;
  selected: boolean;
  onPointerEnter?: () => void;
  onOpen?: () => void;
  children: ReactNode;
  label: string;
}

/** A result: its photo first, the words that matched beside it. */
const ResultRow = forwardRef<HTMLAnchorElement, RowProps>(function ResultRow(
  { link, photo, fallbackIcon: FallbackIcon, selected, onPointerEnter, onOpen, children, label },
  ref,
) {
  return (
    <Link
      ref={ref}
      {...link}
      aria-label={label}
      aria-current={selected || undefined}
      onPointerEnter={onPointerEnter}
      onClick={onOpen}
      className={cn(
        "pressable focus-ring flex items-start gap-3.5 rounded-lg p-2 md:gap-4",
        selected ? "bg-cream shadow-ring" : "hover:bg-ink/4",
      )}
    >
      {photo ? (
        <Photo
          src={photoSrc(photo.id, "thumb")}
          alt=""
          color={photo.color || undefined}
          className="size-20 shrink-0 rounded-md md:size-24"
        />
      ) : (
        <span className="bg-ink/5 text-ink-faint flex size-20 shrink-0 items-center justify-center rounded-md md:size-24">
          <FallbackIcon size={26} aria-hidden />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">{children}</span>
    </Link>
  );
});

interface AttemptResultProps {
  hit: AttemptHit;
  terms: readonly SearchTerm[];
  selected: boolean;
  onHover: () => void;
  onOpen: () => void;
}

/** An attempt found: how it went, the note, the tags and filaments that matched. */
export const AttemptResult = forwardRef<HTMLAnchorElement, AttemptResultProps>(function AttemptResult(
  { hit, terms, selected, onHover, onOpen },
  ref,
) {
  const failureOptions = useTagOptions("failure");
  const successOptions = useTagOptions("success");
  const { attempt, item } = hit;
  const title = item.title?.trim() || "Untitled build";
  const filaments = attempt.settings.filaments ?? [];
  const settings = summarizeSettings(attempt.settings).slice(0, 4);
  return (
    <ResultRow
      ref={ref}
      link={attemptLink(hit)}
      photo={hit.photo}
      fallbackIcon={BuildsIcon}
      selected={selected}
      onPointerEnter={onHover}
      onOpen={onOpen}
      label={`${title}, attempt ${hit.number}`}
    >
      <span className="flex items-center gap-2">
        <OutcomeChip outcome={attempt.outcome} />
        <span className="text-small text-ink-faint ml-auto shrink-0">{relativeTime(attempt.printedAt)}</span>
      </span>
      <span className="text-body text-ink min-w-0 truncate font-semibold">
        <Highlight text={title} terms={terms} />
        <span className="text-small text-ink-faint font-medium"> · attempt {hit.number}</span>
      </span>
      {attempt.note && <Highlight text={attempt.note} terms={terms} className="text-body text-ink-soft line-clamp-2" />}
      {(attempt.failureTags.length > 0 || attempt.successNotes.length > 0) && (
        <span className="flex flex-wrap gap-1.5">
          {attempt.failureTags.map((slug) => (
            <TagChip key={`f-${slug}`} kind="failure" label={tagLabel("failure", slug, failureOptions)} terms={terms} />
          ))}
          {attempt.successNotes.map((slug) => (
            <TagChip key={`s-${slug}`} kind="success" label={tagLabel("success", slug, successOptions)} terms={terms} />
          ))}
        </span>
      )}
      {(filaments.length > 0 || settings.length > 0) && (
        <span className="text-small text-ink-faint tabular flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {filaments.map((filament, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: filaments are their position.
            <span key={index} className="text-ink-soft inline-flex items-center gap-1.5 font-medium">
              <Swatch color={filament.colorHex} />
              <Highlight
                text={[filament.colorName, filament.brand, filament.type].filter(Boolean).join(" ") || "Filament"}
                terms={terms}
              />
              <span className="text-ink-ghost" aria-hidden>
                ·
              </span>
            </span>
          ))}
          {settings.map((part, index) => (
            <span key={part} className="whitespace-nowrap">
              {index > 0 && (
                <span className="text-ink-ghost" aria-hidden>
                  ·{" "}
                </span>
              )}
              <Highlight text={part} terms={terms} />
            </span>
          ))}
        </span>
      )}
    </ResultRow>
  );
});

/** A tag on a result; one the search matched is ringed, the way a picked tag is. */
function TagChip({ kind, label, terms }: { kind: TagKind; label: string; terms: readonly SearchTerm[] }) {
  const matched = highlight(label, terms).some((piece) => piece.match);
  return (
    <Chip
      tone={kind === "failure" ? "tomato" : "basil"}
      icon={kind === "success" ? CheckIcon : undefined}
      className={cn(
        matched && "ring-1 ring-inset",
        matched && (kind === "failure" ? "ring-tomato/50" : "ring-basil/50"),
      )}
    >
      {matched && <span className="sr-only">Matched: </span>}
      {label}
    </Chip>
  );
}

const stageLook = {
  idea: { icon: IdeasIcon, label: "Idea", tone: "neutral" },
  building: { icon: BuildsIcon, label: "On the bed", tone: "semolina" },
  done: { icon: FinishIcon, label: "Done", tone: "basil" },
  shelved: { icon: ShelveIcon, label: "Shelved", tone: "neutral" },
} as const;

interface ItemResultProps {
  hit: ItemHit;
  terms: readonly SearchTerm[];
  selected: boolean;
  onHover: () => void;
  onOpen: () => void;
}

/** A build or an idea found: its title and the part of its note that matched. */
export const ItemResult = forwardRef<HTMLAnchorElement, ItemResultProps>(function ItemResult(
  { hit, terms, selected, onHover, onOpen },
  ref,
) {
  const { item } = hit;
  const look = stageLook[item.stage];
  const title = item.title?.trim();
  const snippet = hit.snippet ? snippetSegments(hit.snippet) : null;
  const meta =
    item.stage === "idea"
      ? `Captured ${inlineTime(item.createdAt)}`
      : hit.attempts
        ? `${hit.attempts} ${hit.attempts === 1 ? "attempt" : "attempts"}`
        : `Started ${inlineTime(item.startedAt ?? item.createdAt)}`;
  return (
    <ResultRow
      ref={ref}
      link={itemLink(hit)}
      photo={hit.photo}
      fallbackIcon={look.icon}
      selected={selected}
      onPointerEnter={onHover}
      onOpen={onOpen}
      label={title || item.note.slice(0, 80) || look.label}
    >
      <span className="flex items-center gap-2">
        <Chip tone={look.tone} icon={look.icon}>
          {look.label}
        </Chip>
        {item.stage !== "idea" && hit.lastOutcome && <OutcomeChip outcome={hit.lastOutcome} />}
        <span className="text-small text-ink-faint ml-auto shrink-0">{meta}</span>
      </span>
      {title && <Highlight text={title} terms={terms} className="text-body text-ink truncate font-semibold" />}
      {item.note &&
        (snippet ? (
          <Highlight segments={snippet} className="text-body text-ink-soft line-clamp-2" />
        ) : (
          <Highlight text={item.note} terms={terms} className="text-body text-ink-soft line-clamp-2" />
        ))}
    </ResultRow>
  );
});
