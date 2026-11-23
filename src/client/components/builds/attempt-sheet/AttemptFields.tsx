import type { Part } from "@shared/api";
import { type AttemptSettings, describeChanges, OUTCOMES, type Outcome } from "@shared/attempts";
import type { AttemptPart } from "@shared/parts";
import { printerHints } from "@shared/spools";
import { Fragment, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Caution, FromFileMark } from "@/components/ui/Caution";
import { Disclosure } from "@/components/ui/Disclosure";
import { TextArea } from "@/components/ui/Field";
import { SettingsIcon } from "@/components/ui/icons";
import type { AttemptView } from "@/lib/items";
import { keyboardProxy } from "@/lib/keyboard-proxy";
import { usePrinterSetup } from "@/lib/pantry-queries";
import { useIsDesktop } from "@/lib/use-media-query";
import { NotEnoughNote } from "../NotEnoughNote";
import { OutcomePicker } from "../Outcome";
import { SettingsEditor } from "../SettingsEditor";
import { summarizeSettings } from "../settings";
import { TagPicker } from "../TagPicker";
import { ChangeChips, chipMarks } from "./ChangeChips";
import { PlateParts } from "./PlateParts";

/** How long a phone's sheet takes to slide up (vaul's 500 ms, and a beat): a note focused before then would jump. */
const SHEET_SETTLE_MS = 600;

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
  /** Who suggested the failure tags (success notes are only ever Claude's). */
  suggestedFailureBy?: "printer" | "claude";
  /** The outcome Claude suggests from the photo: hinted on its button, not picked. */
  suggestedOutcome?: Outcome | null;
  /** Under the outcome buttons: "Looking at the photo…", or what Claude made of it. */
  outcomeHint?: ReactNode;
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

  const outcomeBlock = (
    <Fragment key="outcomeBlock">
      <fieldset disabled={props.readOnly === "all"} className="contents">
        <div className="flex flex-col gap-3">
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
          // The tags ask "What went wrong?" / "What worked?"; after a print that went wrong the note comes first and
          // asks in plain words.
          placeholder={
            withTags
              ? "What happened? In your own words."
              : outcome
                ? "One line is plenty."
                : "A line about this attempt"
          }
          maxLength={500}
          enterKeyHint="done"
          onFocus={(event) => {
            // The keyboard is coming up: keep the whole field right above the footer, not pushed under the header.
            const field = event.currentTarget;
            if (isDesktop) return;
            for (const ms of [0, 150, 400]) window.setTimeout(() => field.scrollIntoView({ block: "end" }), ms);
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
  const tagsBlock = (
    <Fragment key="tagsBlock">
      <fieldset disabled={props.readOnly === "all"} className="contents">
        {withTags && (
          <TagPicker
            kind="failure"
            label="What went wrong?"
            hide={outcome === "failed" ? ["spaghetti"] : undefined}
            value={props.failureTags}
            onChange={props.onFailureTags}
            suggested={props.suggestedFailureTag}
            suggestedBy={props.suggestedFailureBy}
            compact
          />
        )}
        {(outcome === "success" || outcome === "partial") && (
          <TagPicker
            kind="success"
            label="What worked?"
            value={props.successNotes}
            onChange={props.onSuccessNotes}
            suggested={props.suggestedSuccessNotes}
            suggestedBy="claude"
            compact={withTags}
          />
        )}
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
      {/* Nothing has come off the spool until the print is done: a heads-up only while it hasn't been. */}
      {!outcome && <NotEnoughNote settings={settings} />}
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
  // On a phone the sheet reads bottom-up: what is done standing at the printer (the note, the photos, and "How did it
  // go?" last) sits at the foot, under the thumb, and the rarely changed settings are above. Desktop reads top-down.
  // The sheet opens at its foot, where the thumb is: the part that reads bottom-up starts scrolled to its end, and
  // goes back there when what sits below the outcome grows (its hint) or the keyboard comes up for the note.
  const root = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  // Scrolls the sheet's body to its end and keeps it there while its height settles (the sheet's own opening, the
  // settings, a hint arriving): a watcher on the content's size for a moment, not one scroll on mount.
  const toEnd = (force: boolean) => {
    if (isDesktop || !root.current) return () => {};
    let body: HTMLElement | null = root.current.parentElement;
    while (body && getComputedStyle(body).overflowY !== "auto") body = body.parentElement;
    const scroller = body;
    if (!scroller) return () => {};
    const go = () => {
      if (force || !touched.current) scroller.scrollTo({ top: scroller.scrollHeight });
    };
    go();
    const watcher = new ResizeObserver(go);
    watcher.observe(root.current);
    watcher.observe(scroller);
    const stop = window.setTimeout(() => watcher.disconnect(), 900);
    return () => {
      window.clearTimeout(stop);
      watcher.disconnect();
    };
  };
  const opened = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: on opening, and when the outcome changes.
  useEffect(() => {
    const first = !opened.current;
    opened.current = true;
    return toEnd(!first);
  }, [outcome]);

  // Partly or Spaghetti picked: the person's own words come first, so the note takes the focus (on a laptop typing
  // goes straight in; on a phone the keyboard comes up with the note right above the answer). Picked in the sheet,
  // it is inside the tap, so iOS raises the keyboard; picked on a card, the card's tap holds the keyboard with a
  // stand-in (lib/keyboard-proxy.ts) and the note takes the focus from it once the sheet has slid up, so nothing jumps.
  const mountedAt = useRef(performance.now());
  const lastOutcome = useRef(outcome);
  // biome-ignore lint/correctness/useExhaustiveDependencies: when the outcome changes.
  useLayoutEffect(() => {
    const from = lastOutcome.current;
    lastOutcome.current = outcome;
    const note = noteRef.current;
    if (from === outcome || !withTags || props.readOnly === "all" || !note) return;
    const settling = isDesktop ? 0 : SHEET_SETTLE_MS - (performance.now() - mountedAt.current);
    if (settling <= 0) {
      note.focus({ preventScroll: !isDesktop });
      return;
    }
    const timer = window.setTimeout(() => {
      // A field or button tapped meanwhile keeps the focus; the stand-in, the sheet itself or the answer give it up.
      const held = document.activeElement;
      if (!held || held === document.body || held === keyboardProxy() || held.matches("[role=dialog], [role=radio]"))
        note.focus({ preventScroll: true });
    }, settling);
    return () => window.clearTimeout(timer);
  }, [outcome]);

  // After Partly or Spaghetti the note comes right after the answer, then the few tags; otherwise the photos and the
  // plate come first. (React moves the blocks around the note, so a focused note keeps its focus.)
  const blocks = isDesktop
    ? withTags
      ? [
          outcomeBlock,
          noteBlock,
          tagsBlock,
          plateBlock,
          photosBlock,
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
    : withTags
      ? [
          fileBlock,
          settingsBlock,
          notEnoughBlock,
          whenBlock,
          coachBlock,
          plateBlock,
          photosBlock,
          tagsBlock,
          noteBlock,
          outcomeBlock,
        ]
      : [
          fileBlock,
          settingsBlock,
          notEnoughBlock,
          whenBlock,
          coachBlock,
          noteBlock,
          plateBlock,
          photosBlock,
          tagsBlock,
          outcomeBlock,
        ];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: it only listens to keys that bubble up from the controls inside.
    <div
      ref={root}
      onPointerDownCapture={(event) => {
        if ((event.target as HTMLElement).closest("[role=radiogroup]") === null) touched.current = true;
      }}
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
