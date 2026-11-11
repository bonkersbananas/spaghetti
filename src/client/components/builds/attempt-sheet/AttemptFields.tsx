import type { Part } from "@shared/api";
import { type AttemptSettings, describeChanges, type Outcome } from "@shared/attempts";
import type { AttemptPart } from "@shared/parts";
import { printerHints } from "@shared/spools";
import { type ReactNode, useEffect, useState } from "react";
import { Caution, FromFileMark } from "@/components/ui/Caution";
import { Disclosure } from "@/components/ui/Disclosure";
import { TextArea } from "@/components/ui/Field";
import { SettingsIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import type { AttemptView } from "@/lib/items";
import { usePrinterSetup } from "@/lib/pantry";
import { useIsDesktop } from "@/lib/use-media-query";
import { NotEnoughNote } from "../NotEnoughNote";
import { OutcomePicker } from "../Outcome";
import { SettingsEditor } from "../SettingsEditor";
import { summarizeSettings } from "../settings";
import { TagPicker } from "../TagPicker";
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
  /** Claude's ideas for the next try, right under the outcome: for a new attempt. */
  coach?: ReactNode;
  /** Shown above the settings: "what worked last time", for a new attempt. */
  suggestion?: ReactNode;
  /** The slicer file: its card, a plate to pick, or the well to add one. */
  file?: ReactNode;
  /** What the slicer file said, to mark the values that came from it. */
  fromFile?: AttemptSettings;
  /** Changes when a file was read: the settings open to show what it filled in. */
  settingsKey?: number;
  /** Shown under the outcome: how long it took next to the estimate. */
  estimate?: ReactNode;
  /** The build's parts and what the plate holds of them; nothing is shown for a build without parts. */
  plate?: { parts: readonly Part[]; value: readonly AttemptPart[]; onChange: (value: AttemptPart[]) => void };
}

export function AttemptFields(props: FieldsProps) {
  const { outcome, previous, settings } = props;
  const isDesktop = useIsDesktop();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // A file was read: show what it filled in.
  useEffect(() => {
    if (props.settingsKey) setSettingsOpen(true);
  }, [props.settingsKey]);
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
  const settingsSummary: ReactNode = base ? (
    changes.length ? (
      `Changed from ${base.label}: ${changes.map((c) => c.text).join(", ")}`
    ) : (
      <MetaList>
        {[`Same as ${base.label}`, ...pieces.slice(0, 4)].map((piece) => (
          <span key={piece}>{piece}</span>
        ))}
      </MetaList>
    )
  ) : pieces.length ? (
    <MetaList>
      {pieces.map((piece) => (
        <span key={piece}>{piece}</span>
      ))}
    </MetaList>
  ) : (
    "Filament, plate, temperatures, times. All optional."
  );
  const summaryWithFile = props.fromFile ? (
    <span className="inline-flex min-w-0 items-start gap-1.5">
      <FromFileMark className="mt-0.5" />
      <span className="min-w-0">{settingsSummary}</span>
    </span>
  ) : (
    settingsSummary
  );

  return (
    <div className="flex flex-col gap-5" data-capture>
      <fieldset disabled={props.readOnly === "all"} className="contents">
        <div className="flex flex-col gap-3">
          <p className="text-small text-ink-soft px-0.5 font-semibold">{props.outcomeLabel}</p>
          <OutcomePicker value={outcome} onChange={props.onOutcome} suggested={props.suggestedOutcome} />
          {props.outcomeHint}
          {props.estimate}
        </div>
      </fieldset>
      {props.coach}
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
      <fieldset disabled={!!props.readOnly} className="contents">
        {props.when}
      </fieldset>
      {props.photos}
      <fieldset disabled={props.readOnly === "all"} className="contents">
        {/* One line of meaning, but it wraps and grows so the whole note stays in view while typing. */}
        <TextArea
          aria-label="Note"
          minRows={1}
          placeholder={
            outcome === "failed"
              ? "What went wrong? One line is plenty."
              : outcome === "success"
                ? "What made it work? One line is plenty."
                : "A line about this attempt"
          }
          maxLength={500}
          enterKeyHint="done"
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
        {(outcome === "failed" || outcome === "partial") && (
          <TagPicker
            kind="failure"
            label="What went wrong?"
            value={props.failureTags}
            onChange={props.onFailureTags}
            suggested={props.suggestedFailureTag}
            suggestedBy={props.suggestedFailureBy}
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
          />
        )}
      </fieldset>
      <fieldset disabled={!!props.readOnly} className="contents">
        {props.file}
      </fieldset>
      {/* Nothing has come off the spool until the print is done: a heads-up only while it hasn't been. */}
      {!outcome && <NotEnoughNote settings={settings} />}
      {props.suggestion}
      <div className="flex flex-col gap-2">
        <fieldset disabled={!!props.readOnly} className="contents">
          <Disclosure
            open={settingsOpen || !!props.readOnly}
            onOpenChange={setSettingsOpen}
            title="Settings"
            icon={SettingsIcon}
            summary={summaryWithFile}
          >
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
    </div>
  );
}
