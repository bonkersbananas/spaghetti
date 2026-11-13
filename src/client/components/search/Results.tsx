import type { AttemptHit, ItemHit, Photo as PhotoData } from "@shared/api";
import { type TagKind, tagLabel } from "@shared/attempts";
import { displayName } from "@shared/people";
import { highlight, type SearchTerm, snippetSegments } from "@shared/search";
import { inlineTime, relativeTime } from "@shared/time";
import { useQuery } from "@tanstack/react-query";
import type { LinkProps } from "@tanstack/react-router";
import { forwardRef, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { OutcomeChip } from "@/components/builds/Outcome";
import { SettingsLine } from "@/components/builds/SettingsLine";
import { summarizeSettings } from "@/components/builds/settings";
import { Chip } from "@/components/ui/Chip";
import { Highlight } from "@/components/ui/Highlight";
import {
  BuildsIcon,
  CheckIcon,
  CommentIcon,
  FinishIcon,
  type Icon,
  IdeasIcon,
  ShelveIcon,
} from "@/components/ui/icons";
import { PhotoRow } from "@/components/ui/PhotoRow";
import { useTagOptions } from "@/lib/builds";
import { cn } from "@/lib/cn";
import { heroClick } from "@/lib/hero";
import { photoSrc } from "@/lib/previews";
import { peopleQuery, sessionQuery } from "@/lib/queries";
import { useIsDesktop } from "@/lib/use-media-query";

/** Where a result leads. */
export function attemptLink(hit: AttemptHit): LinkProps {
  return { to: "/builds/$buildId", params: { buildId: hit.item.id }, search: { attempt: hit.attempt.id } };
}

export function itemLink(hit: ItemHit): LinkProps {
  // Found by a comment: open the page at the thread, with that comment lit for a moment (?thread=1&comment=…).
  const search = hit.comment ? ({ thread: 1, comment: hit.comment.id } as never) : undefined;
  return hit.item.stage === "idea"
    ? { to: "/ideas/$ideaId", params: { ideaId: hit.item.id }, search }
    : { to: "/builds/$buildId", params: { buildId: hit.item.id }, search };
}

interface RowProps {
  link: LinkProps;
  photo: PhotoData | null;
  fallbackIcon: Icon;
  selected: boolean;
  onPointerEnter?: () => void;
  onOpen?: () => void;
  children: ReactNode;
}

/** A result: its photo first, the words that matched beside it. */
const ResultRow = forwardRef<HTMLAnchorElement, RowProps>(function ResultRow(
  { link, photo, fallbackIcon: FallbackIcon, selected, onPointerEnter, onOpen, children },
  ref,
) {
  return (
    <PhotoRow
      ref={ref}
      // Named by what it shows (outcome, title, the words that matched), as people see it.
      link={{
        ...link,
        onPointerEnter,
        viewTransition: true,
        onClick: (event) => {
          heroClick(event, photo?.id);
          onOpen?.();
        },
      }}
      photo={photo ? { src: photoSrc(photo.id, "thumb"), color: photo.color || undefined } : null}
      tile={<FallbackIcon size={26} aria-hidden />}
      tileClassName="bg-ink/5 text-ink-faint"
      size="lg"
      align="start"
      selected={selected}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">{children}</span>
    </PhotoRow>
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
  // The settings the words matched come first ("bed 70 °C" for "bed temp"), then the usual ones.
  const matches = (part: string) => highlight(part, terms).some((piece) => piece.match);
  const settings = summarizeSettings(attempt.settings)
    .sort((x, y) => Number(matches(y)) - Number(matches(x)))
    .slice(0, 4);
  return (
    <ResultRow
      ref={ref}
      link={attemptLink(hit)}
      photo={hit.photo}
      fallbackIcon={BuildsIcon}
      selected={selected}
      onPointerEnter={onHover}
      onOpen={onOpen}
    >
      <span className="flex items-center gap-2">
        <OutcomeChip outcome={attempt.outcome} />
        <span className="text-small text-ink-faint ml-auto shrink-0">{relativeTime(attempt.printedAt)}</span>
      </span>
      <span className="text-body text-ink line-clamp-2 min-w-0 font-semibold">
        <Highlight text={title} terms={terms} />
        <span className="text-small text-ink-faint font-medium">
          {" "}
          <span className="whitespace-nowrap">· attempt {hit.number}</span>
          {hit.partsLabel ? ` · ${hit.partsLabel}` : ""}
        </span>
      </span>
      {attempt.note && <Highlight text={attempt.note} terms={terms} className="text-body text-ink-soft line-clamp-2" />}
      {hit.coachIdea && (
        <span className="text-small text-ink-soft flex items-center gap-1.5">
          <IdeasIcon size={14} aria-hidden className="text-ink-faint shrink-0" />
          <span className="min-w-0 truncate">
            <span className="text-ink-faint">Claude suggested </span>
            <Highlight text={hit.coachIdea} terms={terms} />
          </span>
        </span>
      )}
      {(attempt.failureTags.length > 0 || attempt.successNotes.length > 0) && (
        <TagRow>
          {attempt.failureTags.map((slug) => (
            <TagChip key={`f-${slug}`} kind="failure" label={tagLabel("failure", slug, failureOptions)} terms={terms} />
          ))}
          {attempt.successNotes.map((slug) => (
            <TagChip key={`s-${slug}`} kind="success" label={tagLabel("success", slug, successOptions)} terms={terms} />
          ))}
        </TagRow>
      )}
      {(filaments.length > 0 || settings.length > 0) && (
        <SettingsLine
          filaments={filaments}
          parts={settings}
          name={(filament) =>
            [filament.colorName, filament.brand, filament.type].filter(Boolean).join(" ") || "Filament"
          }
          renderText={(text) => <Highlight text={text} terms={terms} />}
          className="text-small text-ink-faint"
          filamentClassName="text-ink-soft"
        />
      )}
    </ResultRow>
  );
});

/**
 * Tags on a phone stay on one row, as many as fit and then "+2", so a result keeps its height; on a laptop they wrap.
 * All chips are drawn in a row that doesn't wrap; the ones past the edge are hidden once measured.
 */
function TagRow({ children }: { children: ReactNode[] }) {
  const desktop = useIsDesktop();
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const list = children.flat().filter(Boolean);
  const [fit, setFit] = useState(list.length);
  // The row's width when chips are left out: just the ones shown, so the "+2" sits right after the last of them.
  const [shown, setShown] = useState<number>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured again when the number of tags changes.
  useLayoutEffect(() => {
    const measure = () => {
      const kids = Array.from(inner.current?.children ?? []) as HTMLElement[];
      const room = outer.current?.clientWidth ?? 0;
      const right = (i: number) => (kids[i]?.offsetLeft ?? 0) + (kids[i]?.offsetWidth ?? 0);
      let n = kids.length;
      // Everything fits, or leave room for the "+N" (about 2.5rem).
      if (right(n - 1) > room) for (n = kids.length; n > 1 && right(n - 1) > room - 40; n--);
      setFit(n);
      setShown(n < kids.length ? right(n - 1) : undefined);
    };
    measure();
    // Again when the row's width changes (turning the phone) or a chip's does (a font arriving).
    const watch = new ResizeObserver(measure);
    if (outer.current) watch.observe(outer.current);
    for (const kid of Array.from(inner.current?.children ?? [])) watch.observe(kid);
    return () => watch.disconnect();
  }, [list.length]);
  const hidden = desktop ? 0 : list.length - fit;
  return (
    <span ref={outer} className="flex items-center gap-1.5">
      <span
        ref={inner}
        style={desktop ? undefined : { maxWidth: shown }}
        className="relative flex min-w-0 gap-1.5 overflow-hidden md:flex-wrap"
      >
        {list.map((chip, i) => (
          <span
            key={(chip as { key?: string }).key ?? i}
            className={cn("shrink-0", !desktop && i >= fit && "invisible")}
          >
            {chip}
          </span>
        ))}
      </span>
      {hidden > 0 && <span className="text-small text-ink-faint shrink-0 font-medium">+{hidden}</span>}
    </span>
  );
}

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
  const { data: people } = useQuery(peopleQuery);
  const { data: me } = useQuery(sessionQuery);
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
    >
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Chip tone={look.tone} icon={look.icon}>
          {look.label}
        </Chip>
        {item.stage !== "idea" && hit.lastOutcome && <OutcomeChip outcome={hit.lastOutcome} />}
        <span className="text-small text-ink-faint ml-auto shrink-0">{meta}</span>
      </span>
      {title && <Highlight text={title} terms={terms} className="text-body text-ink truncate font-semibold" />}
      {hit.comment && snippet ? (
        // Found in the thread: who said it and when, then their words.
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-caption text-ink-faint flex items-center gap-1.5 font-medium">
            <CommentIcon size={14} aria-hidden />
            <span>
              {hit.comment.authorId === me?.id
                ? "You"
                : displayName(
                    people?.find((person) => person.id === hit.comment?.authorId),
                    "Someone",
                  )}{" "}
              · {relativeTime(hit.comment.createdAt)}
            </span>
          </span>
          <Highlight segments={snippet} className="text-body text-ink-soft line-clamp-2" />
        </span>
      ) : (
        item.note &&
        (snippet ? (
          <Highlight segments={snippet} className="text-body text-ink-soft line-clamp-2" />
        ) : (
          <Highlight text={item.note} terms={terms} className="text-body text-ink-soft line-clamp-2" />
        ))
      )}
    </ResultRow>
  );
});
