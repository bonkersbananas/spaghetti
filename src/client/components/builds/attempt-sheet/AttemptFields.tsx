import type { Part } from "@shared/api";
import { type AttemptSettings, describeChanges, OUTCOMES, type Outcome } from "@shared/attempts";
import { showsNotEnoughNote } from "@shared/not-enough-rule";
import type { AttemptPart } from "@shared/parts";
import { printerHints } from "@shared/spools";
import { Fragment, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Caution, FromFileMark } from "@/components/ui/Caution";
import { Disclosure } from "@/components/ui/Disclosure";
import { TextArea } from "@/components/ui/Field";
import { SettingsIcon } from "@/components/ui/icons";
import type { AttemptView } from "@/lib/items";
import { usePrinterSetup } from "@/lib/pantry-queries";
import { useIsDesktop } from "@/lib/use-media-query";
import { NotEnoughNote } from "../NotEnoughNote";
import { OutcomePicker } from "../Outcome";
import { SettingsEditor } from "../SettingsEditor";
import { summarizeSettings } from "../settings";
import { TagPicker } from "../TagPicker";
import { ChangeChips, chipMarks } from "./ChangeChips";
import { PlateParts } from "./PlateParts";

export interface FieldsProps {
  outcome: Outcome | null;
  onOutcome: (outcome: Outcome) => void;
  note: string;
  onNote: (note: string) => void;
  failureTags: string[];
  /** Failure tags the printer or Claude suggested; shown marked as suggestions while they are picked. */
  suggestedFailureTag?: string | readonly string[];
  /** Success notes Claude suggested, marked the same way. */
  suggestedSuccessNotes?: readonly string[];
  /** The one failure tag the printer suggested, when it is among them; the rest are Claude's. */
  printerFailureTag?: string;
  /** The outcome Claude suggests from the photo: hinted on its button, not picked. */
  suggestedOutcome?: Outcome | null;
  /** Under the outcome buttons: "Looking at the photo…", or what Claude made of it. */
  outcomeHint?: ReactNode;
  /** A question answered with the outcome, right above it (the printer's "Is this Herb planter?"). */
  ask?: ReactNode;
  onFailureTags: (tags: string[]) => void;
  successNotes: string[];
  onSuccessNotes: (tags: string[]) => void;
  settings: AttemptSettings;
  onSettings: (settings: AttemptSettings) => void;
  /** The attempt before, for "same as attempt 3" and what changed. */
  previous?: AttemptView;
  /** Started from something else (a recipe): what changed is told against this instead of the attempt before. */
  baseline?: { label: string; settings: AttemptSettings };
  when: ReactNode;
  photos: ReactNode;
  /** Shown above the outcome while printing. */
  outcomeLabel: string;
  /** Enter in the note, on desktop: log the attempt. */
  onEnter?: () => void;
  /**
   * A saved attempt, seen without a connection: "all" shows what was written and changes nothing;
   * "finish" (a print still printing) lets the outcome, note and tags be filled in, to be sent later.
   */
  readOnly?: "all" | "finish";
  /** Claude's ideas for the next try, after the photo, the note and the tags: for a new attempt. */
  coach?: ReactNode;
  /**
   * "What worked last time" and "Start from a recipe", for a new attempt: they sit inside the settings row, above the
   * editor, so the row is one line until someone wants them.
   */
  suggestion?: ReactNode;
  /** The closed settings row says what `suggestion` offers, in one line ("Worked on Hook: Textured PEI, 250 °C"). */
  suggestionOffer?: string;
  /** A new attempt: what carried over shows as chips to change one thing in place. */
  changeChips?: boolean;
  /** The slicer file: its card, a plate to pick, or the well to add one. */
  file?: ReactNode;
  /** What the slicer file said, to mark the values that came from it. */
  fromFile?: AttemptSettings;
  /** Shown under the outcome: how long it took next to the estimate. */
  estimate?: ReactNode;
  /** The build's parts and what the plate holds of them; nothing is shown for a build without parts. */
  plate?: { parts: readonly Part[]; value: readonly AttemptPart[]; onChange: (value: AttemptPart[]) => void };
}

export function AttemptFields(props: FieldsProps) {
  const { outcome, previous, settings } = props;
  /** Logging a new attempt, not answering a print. */
  const isNew = !!props.changeChips;
  const isDesktop = useIsDesktop();
  const withTags = outcome === "failed" || outcome === "partial";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const setup = usePrinterSetup();
  const hints = printerHints(settings, setup);
  const base =
    props.baseline ?? (previous ? { label: `attempt ${previous.number}`, settings: previous.settings } : undefined);
  const changes = base ? describeChanges(base.settings, settings) : [];
  const summary = summarizeSettings(settings);
  const filamentNames = (settings.filaments ?? [])
    .map((f) => [f.brand, f.type].filter(Boolean).join(" "))
    .filter(Boolean);
  const pieces = [...filamentNames, ...summary];
  // With chips under the row (what the attempt before had), "same" needs no list of pieces.
  const withChips = !!base && !!props.changeChips && !props.readOnly;
  // The chips mark what they cover; the line says the rest (supports, brim, walls, a second filament…), cut past three.
  const marks = chipMarks(settings, base?.settings);
  const covered = (key: string) =>
    (/^filaments\.0(\.|$)/.test(key) && marks.filament) ||
    (key === "bedType" && marks.bedType) ||
    (key === "layerHeight" && marks.layerHeight) ||
    (key === "infillDensity" && marks.infillDensity) ||
    (key === "nozzleTemperature" && marks.nozzleTemperature) ||
    (key === "bedTemperature" && marks.bedTemperature);
  const unseen = changes.filter((change) => !covered(change.key));
  const said = (list: typeof changes) =>
    list.length > 3
      ? `${list
          .slice(0, 3)
          .map((c) => c.text)
          .join(", ")} and ${list.length - 3} more`
      : list.map((c) => c.text).join(", ");
  const settingsSummary: ReactNode = base ? (
    changes.length ? (
      `Changed from ${base.label}${withChips ? (unseen.length ? `: ${said(unseen)}` : "") : `: ${said(changes)}`}`
    ) : withChips ? (
      `Same as ${base.label}`
    ) : (
      // One line, cut with an ellipsis rather than wrapped: "0.20 mm" never sits alone on a second line.
      <span className="block truncate">{[`As ${base.label}`, ...pieces.slice(0, 3)].join(" · ")}</span>
    )
  ) : pieces.length ? (
    // One line, cut with an ellipsis (design.md): the closed row never grows with what the file said.
    <span className="block truncate">{pieces.join(" · ")}</span>
  ) : (
    "Filament, plate, temperatures, times. All optional."
  );
  const withOffer = props.suggestionOffer ? (
    <span className="flex min-w-0 flex-col gap-0.5">
      {settingsSummary}
      <span className="text-basil-ink truncate font-semibold">{props.suggestionOffer}</span>
    </span>
  ) : (
    settingsSummary
  );
  const summaryWithFile = props.fromFile ? (
    <span className="flex min-w-0 items-start gap-1.5">
      <FromFileMark className="mt-0.5" />
      <span className="min-w-0">{withOffer}</span>
    </span>
  ) : (
    withOffer
  );

  // The question and its answer: the label is the button's own words that brought the person here. On a phone it
  // never moves once the sheet is open: what an answer adds (the tags) comes under the tiles, not around them.
  const outcomeBlock = (
    <Fragment key="outcomeBlock">
      <fieldset disabled={props.readOnly === "all"} className="contents">
        <div className="flex flex-col gap-3">
          {props.ask}
          <p className="text-small text-ink-soft px-0.5 font-semibold">{props.outcomeLabel}</p>
          <OutcomePicker value={outcome} onChange={props.onOutcome} suggested={props.suggestedOutcome} />
          {props.outcomeHint}
          {props.estimate}
        </div>
      </fieldset>
    </Fragment>
  );
  const plateBlock = (
    <Fragment key="plateBlock">
      {props.plate && (
        <fieldset disabled={!!props.readOnly} className="contents">
          <PlateParts
            parts={props.plate.parts}
            value={props.plate.value}
            onChange={props.plate.onChange}
            outcome={outcome}
          />
        </fieldset>
      )}
    </Fragment>
  );
  const photosBlock = <Fragment key="photos">{props.photos}</Fragment>;
  const noteBlock = (
    <Fragment key="noteBlock">
      <fieldset disabled={props.readOnly === "all"} className="contents">
        {/* One line of meaning, but it wraps and grows so the whole note stays in view while typing. */}
        <TextArea
          ref={noteRef}
          aria-label="Note"
          className="scroll-mb-3"
          minRows={1}
          placeholder="A line about this attempt"
          maxLength={500}
          enterKeyHint="done"
          onFocus={(event) => {
            // The keyboard is coming up: keep the whole field in view above the footer.
            const field = event.currentTarget;
            if (isDesktop) return;
            // With the keyboard up the note goes to the foot of what is left, so what goes with it (the tags above)
            // stays in view; without one (yet) it moves only if it must, keeping the answer under it in view.
            const align = () => {
              const keyboard = (window.visualViewport?.height ?? window.innerHeight) < window.innerHeight - 120;
              field.scrollIntoView({ block: keyboard ? "end" : "nearest" });
            };
            for (const ms of [0, 150, 400]) window.setTimeout(align, ms);
          }}
          value={props.note}
          onChange={(event) => props.onNote(event.target.value.replace(/\n/g, " "))}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            // Enter logs the attempt on desktop (when it can be logged); on a phone it puts the keyboard away.
            event.preventDefault();
            if (isDesktop && props.onEnter) props.onEnter();
            else event.currentTarget.blur();
          }}
        />
      </fieldset>
    </Fragment>
  );
  const failurePicker = withTags && (
    <TagPicker
      key="failure"
      kind="failure"
      label="What went wrong?"
      hide={outcome === "failed" ? ["spaghetti"] : undefined}
      value={props.failureTags}
      onChange={props.onFailureTags}
      suggested={props.suggestedFailureTag}
      suggestedBy="claude"
      printerSuggested={props.printerFailureTag}
      compact
    />
  );
  const successPicker = (outcome === "success" || outcome === "partial") && (
    <TagPicker
      key="success"
      kind="success"
      label="What worked?"
      value={props.successNotes}
      onChange={props.onSuccessNotes}
      suggested={props.suggestedSuccessNotes}
      suggestedBy="claude"
      compact={withTags || !isDesktop}
    />
  );
  const tagsBlock = (
    <Fragment key="tagsBlock">
      <fieldset disabled={props.readOnly === "all"} className="contents">
        {[failurePicker, successPicker]}
      </fieldset>
    </Fragment>
  );
  const coachBlock = (
    <Fragment key="coachBlock">
      {/* Claude's ideas for the next try come after the photo, the note and the tags: those are what someone at the printer is doing. */}
      {props.coach}
    </Fragment>
  );
  const whenBlock = (
    <Fragment key="whenBlock">
      {/* Rarely changed, so it sits under the tags: a failed attempt's tags are in reach without a scroll. */}
      <fieldset disabled={!!props.readOnly} className="contents">
        {props.when}
      </fieldset>
    </Fragment>
  );
  const fileBlock = (
    <Fragment key="fileBlock">
      <fieldset disabled={!!props.readOnly} className="contents">
        {props.file}
      </fieldset>
    </Fragment>
  );
  const notEnoughBlock = (
    <Fragment key="notEnoughBlock">
      {/* Nothing has come off the spool until the print is done: a heads-up only while logging a new attempt that hasn't printed. */}
      {showsNotEnoughNote({ isNew: !!props.changeChips, outcome }) && <NotEnoughNote settings={settings} />}
    </Fragment>
  );
  const settingsBlock = (
    <Fragment key="settings">
      <div className="flex flex-col gap-2">
        <fieldset disabled={!!props.readOnly} className="contents">
          <Disclosure
            open={settingsOpen || !!props.readOnly}
            onOpenChange={setSettingsOpen}
            title="Settings"
            icon={SettingsIcon}
            summary={summaryWithFile}
            peek={
              withChips ? (
                <ChangeChips
                  settings={settings}
                  base={base?.settings}
                  onChange={props.onSettings}
                  onMore={() => setSettingsOpen(true)}
                />
              ) : undefined
            }
          >
            {props.suggestion && <div className="mb-3 flex flex-col gap-3">{props.suggestion}</div>}
            <SettingsEditor value={settings} onChange={props.onSettings} outcome={outcome} fromFile={props.fromFile} />
          </Disclosure>
        </fieldset>
        {/* Closed, the settings still say if something needs a look. */}
        {!settingsOpen && !props.readOnly && hints[0] && (
          <Caution className="px-1">
            {hints[0].text}
            {hints.length > 1 ? ` And ${hints.length - 1} more in the settings.` : ""}
          </Caution>
        )}
      </div>
    </Fragment>
  );
  // Every sheet opens at its top (PR 690) and stays where the person scrolls it: answering a print starts at its photos,
  // logging a new attempt at its file and settings, with Claude's ideas and the tiles under them.

  // Partly or Spaghetti picked on a laptop: the person's own words come first, so the note takes the focus and typing
  // goes straight in. Not on a phone: its keyboard would cover the tile just tapped and every tag, so the tags come
  // first and the note is one tap away.
  const lastOutcome = useRef(outcome);
  // biome-ignore lint/correctness/useExhaustiveDependencies: when the outcome changes.
  useLayoutEffect(() => {
    const from = lastOutcome.current;
    lastOutcome.current = outcome;
    const note = noteRef.current;
    if (from === outcome || !withTags || props.readOnly === "all" || !note || !isDesktop) return;
    // With the caret after what is already written, so new words add to it.
    note.focus();
    note.setSelectionRange(note.value.length, note.value.length);
  }, [outcome]);

  // Desktop: after Partly or Spaghetti the note comes right after the answer, then the photos the tags speak of, then
  // the few tags; otherwise the photos and the plate come first. A phone has one order whatever the answer.
  const blocks = isDesktop
    ? withTags
      ? [
          outcomeBlock,
          noteBlock,
          photosBlock,
          tagsBlock,
          plateBlock,
          coachBlock,
          whenBlock,
          fileBlock,
          notEnoughBlock,
          settingsBlock,
        ]
      : [
          outcomeBlock,
          plateBlock,
          photosBlock,
          noteBlock,
          tagsBlock,
          coachBlock,
          whenBlock,
          fileBlock,
          notEnoughBlock,
          settingsBlock,
        ]
    : isNew
      ? // Logging a new attempt: the file and the settings are the point, so they come first; the photos, the note and
        // the tiles at the foot, under the thumb, and what an answer adds (the tags) under the tiles.
        [
          fileBlock,
          settingsBlock,
          notEnoughBlock,
          whenBlock,
          coachBlock,
          plateBlock,
          photosBlock,
          noteBlock,
          outcomeBlock,
          tagsBlock,
        ]
      : // Answering a print: photos first, then the note, the tiles and the tags under them; the date, the file and the
        // settings are the tail, one scroll away. The same from the first frame, whatever is tapped.
        [
          plateBlock,
          photosBlock,
          noteBlock,
          outcomeBlock,
          tagsBlock,
          coachBlock,
          whenBlock,
          fileBlock,
          notEnoughBlock,
          settingsBlock,
        ];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: it only listens to keys that bubble up from the controls inside.
    <div
      className="flex flex-col gap-5 max-md:pb-2"
      data-capture
      onKeyDown={(event) => {
        // 1, 2, 3 answer "How did it go?" when focus isn't in a field (a note's digits are the note's).
        if (props.readOnly === "all" || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey)
          return;
        const target = event.target as HTMLElement;
        if (target.closest("input, textarea, select, [contenteditable]")) return;
        const index = Number(event.key) - 1;
        if (!OUTCOMES[index]) return;
        // Through the button itself, as a tap: the outcome's own moment plays and focus moves to the picked one.
        const button = event.currentTarget.querySelectorAll<HTMLElement>('[role="radiogroup"] [role="radio"]')[index];
        if (!button) return;
        event.preventDefault();
        button.focus();
        button.click();
      }}
    >
      {blocks}
    </div>
  );
}
