import type { AttemptFile, Item, Person } from "./api.ts";
import {
  type AttemptSettings,
  OUTCOME_LABELS,
  plateName,
  shortPreset,
  type TagDefinition,
  tagLabel,
} from "./attempts.ts";
import { liveCoachItems } from "./coach.ts";
import type { Comment } from "./comments.ts";
import { allPartsPrinted, attemptPartsLabel, partProgress, progressLabel } from "./parts.ts";
import { slicingAhead } from "./slicing/model.ts";
import { fallbackWords, slicerOf } from "./slicing/slicers.ts";
import { printerName, problemSentence, sliceSummary, slicingDetail } from "./slicing/words.ts";
import { formatDuration } from "./time.ts";

/** A kept file in a line: a slicer file with what it said, a model with how Spaghetti sliced it (or why it didn't). */
function fileLine(file: AttemptFile): string {
  const estimate =
    file.prefill.estimatedMinutes !== undefined ? `est. ${formatDuration(file.prefill.estimatedMinutes)}` : "";
  if (file.kind === "model") {
    const slice = file.slice;
    // Who made it (decision 0055): Spaghetti's own slicer, or OrcaSlicer's engine (and why, where it stepped in).
    const who = !slice
      ? ""
      : slicerOf(slice) === "spaghetti"
        ? "sliced by Spaghetti's own slicer"
        : `sliced by Spaghetti with OrcaSlicer ${slice.settings.orca}${slice.fallback ? ` (${fallbackWords(slice.fallback)})` : ""}`;
    const how = !slice
      ? "not sliced yet"
      : slice.status === "failed"
        ? `couldn't be sliced: ${problemSentence(slice)}`
        : [
            `${who} for the ${printerName(slice.settings.machine)}${slice.settings.slicing ? `: ${slicingDetail(slice.settings.slicing, { slicer: false })}` : ""}`,
            ...(slice.settings.slicing ? [] : sliceSummary(slice.settings)),
            estimate,
            slice.cautions?.includes("floating") ? "parts of it float in the air (it needs supports)" : "",
          ]
            .filter(Boolean)
            .join(", ");
    // Settings people changed that it isn't sliced with yet (a change still slicing, or not sliced since).
    const ahead = slicingAhead(file);
    const next = ahead
      ? `; to be sliced next with ${slicingDetail(ahead)}`
      : !slice && file.slicing
        ? `; to be sliced with ${slicingDetail(file.slicing)}`
        : "";
    return `${file.name} (a model, ${how}${next})`;
  }
  const bits = [
    file.plateCount > 1 ? `plate ${file.plate} of ${file.plateCount}` : "",
    estimate,
    file.slicer ?? "",
    file.stored ? "" : "too big to keep, only what it said",
  ].filter(Boolean);
  return `${file.name}${bits.length ? ` (${bits.join(", ")})` : ""}`;
}

/** What the story needs to name people and agents. */
export interface StoryContext {
  people: ReadonlyMap<string, Pick<Person, "name">>;
  /** Agent id → name, for "via Claude for Alex". */
  agents: ReadonlyMap<string, string>;
  customFailureTags?: readonly TagDefinition[];
  customSuccessNotes?: readonly TagDefinition[];
  /** The thread between the two people, oldest first. */
  comments?: readonly Comment[];
}

const date = (time: number) => new Date(time).toISOString().slice(0, 16).replace("T", " ");
const minutes = (value: number) => {
  const h = Math.floor(value / 60);
  const m = Math.round(value % 60);
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
};

/** Everything an attempt was printed with, as short phrases: every field that is set. */
export function describeSettings(settings: AttemptSettings): string[] {
  const parts: string[] = [];
  for (const filament of settings.filaments ?? []) {
    const name = [filament.brand, filament.type].filter(Boolean).join(" ");
    const color = filament.colorName ?? filament.colorHex;
    const slot = filament.amsSlot ? `, slot ${filament.amsSlot}` : "";
    parts.push(`filament ${[name, color && `(${color})`].filter(Boolean).join(" ") || "unknown"}${slot}`);
  }
  if (settings.processPreset) parts.push(`profile ${shortPreset(settings.processPreset)}`);
  if (settings.layerHeight !== undefined) parts.push(`layer ${settings.layerHeight} mm`);
  if (settings.infillDensity !== undefined) parts.push(`${settings.infillDensity}% infill`);
  if (settings.wallLoops !== undefined) parts.push(`${settings.wallLoops} walls`);
  if (settings.bedType) parts.push(`plate ${plateName(settings.bedType)}`);
  if (settings.nozzleDiameter !== undefined)
    parts.push(`${settings.nozzleDiameter} mm ${settings.nozzle === "auxiliary" ? "auxiliary " : ""}nozzle`);
  if (settings.supportEnabled !== undefined)
    parts.push(settings.supportEnabled ? `${settings.supportType ?? ""} supports`.trim() : "no supports");
  if (settings.brim !== undefined) parts.push(settings.brim ? "brim" : "no brim");
  if (settings.nozzleTemperature !== undefined) parts.push(`nozzle ${settings.nozzleTemperature} °C`);
  if (settings.bedTemperature !== undefined) parts.push(`bed ${settings.bedTemperature} °C`);
  if (settings.chamberTemperature !== undefined) parts.push(`chamber ${settings.chamberTemperature} °C`);
  if (settings.filamentDried !== undefined)
    parts.push(settings.filamentDried ? "filament dried" : "filament not dried");
  return parts;
}

/** What happened rather than what was chosen. */
export function describeResults(settings: AttemptSettings): string[] {
  const parts: string[] = [];
  if (settings.estimatedMinutes !== undefined) parts.push(`estimated ${minutes(settings.estimatedMinutes)}`);
  if (settings.actualMinutes !== undefined) parts.push(`took ${minutes(settings.actualMinutes)}`);
  if (settings.weightGrams !== undefined) parts.push(`${settings.weightGrams} g of filament`);
  if (settings.failedAtPercent !== undefined) parts.push(`failed at ${settings.failedAtPercent}%`);
  if (settings.failedAtLayer !== undefined) parts.push(`failed at layer ${settings.failedAtLayer}`);
  return parts;
}

/**
 * A build's whole story as one markdown document: the idea, its notes, every
 * attempt in order (outcome, what changed from the one before, settings, notes,
 * tags) and what worked. Written to be read by a person or a model.
 */
export function buildStory(item: Item, context: StoryContext): string {
  const who = (by: string, via: string | null) => {
    const person = context.people.get(by)?.name ?? "Someone";
    const agent = via ? context.agents.get(via) : undefined;
    return agent ? `${person} via ${agent}` : person;
  };
  const title = item.title?.trim() || "Untitled";
  const lines: string[] = [`# ${title}`, ""];
  const facts = [
    `${item.stage === "idea" ? "An idea" : `A build (${item.stage})`}`,
    `captured ${date(item.createdAt)} by ${who(item.createdBy, item.createdVia)}`,
  ];
  if (item.startedAt) facts.push(`building since ${date(item.startedAt)}`);
  if (item.finishedAt) facts.push(`${item.stage === "shelved" ? "shelved" : "finished"} ${date(item.finishedAt)}`);
  lines.push(`_${facts.join(" · ")}_`, `_id: ${item.id}_`, "");

  lines.push("## Notes", "", item.note.trim() || "_No notes._", "");
  const photos = item.photos.filter((photo) => !photo.attemptId).length;
  if (photos) lines.push(`${photos} ${photos === 1 ? "photo" : "photos"} of the idea.`, "");

  if (item.files?.length) {
    lines.push(
      `## Files (${item.files.length})`,
      "",
      "Files kept with the idea, to download in the app: slicer files, and models (.stl, .3mf) that Spaghetti slices.",
      "",
    );
    for (const file of item.files) lines.push(`- ${fileLine(file)}`);
    lines.push("");
  }

  if (item.parts.length) {
    const progress = partProgress(item.parts, item.attempts);
    lines.push("## Parts", "");
    for (const p of progress) {
      lines.push(`- ${p.part.name} ×${p.part.quantity}: ${progressLabel(p)} (part_id: ${p.part.id})`);
    }
    if (allPartsPrinted(progress)) lines.push("", "_Every part is printed._");
    lines.push("");
  }

  lines.push(`## Attempts (${item.attempts.length})`, "");
  if (!item.attempts.length) lines.push("_None yet._", "");
  item.attempts.forEach((attempt, index) => {
    const outcome = attempt.outcome ? OUTCOME_LABELS[attempt.outcome] : "Printing";
    const printed = attemptPartsLabel(attempt, item.parts);
    lines.push(
      `### Attempt ${index + 1}${printed ? ` · ${printed}` : ""}: ${outcome}`,
      "",
      `_${date(attempt.printedAt)} · ${who(attempt.createdBy, attempt.createdVia)} · id: ${attempt.id}_`,
      "",
    );
    if (attempt.note.trim()) lines.push(attempt.note.trim(), "");
    if (attempt.changes.length)
      lines.push(`Changed since attempt ${index}: ${attempt.changes.map((c) => c.text).join("; ")}.`, "");
    const settings = describeSettings(attempt.settings);
    if (settings.length) lines.push(`Settings: ${settings.join(", ")}.`, "");
    const results = describeResults(attempt.settings);
    if (results.length) lines.push(`Result: ${results.join(", ")}.`, "");
    if (attempt.failureTags.length)
      lines.push(
        `Went wrong: ${attempt.failureTags.map((slug) => tagLabel("failure", slug, context.customFailureTags)).join(", ")}.`,
        "",
      );
    if (attempt.successNotes.length)
      lines.push(
        `Went well: ${attempt.successNotes.map((slug) => tagLabel("success", slug, context.customSuccessNotes)).join(", ")}.`,
        "",
      );
    const ideas = liveCoachItems(attempt.coach);
    if (ideas.length)
      lines.push(
        `Claude suggests for the next try (only suggestions, nothing was changed): ${ideas.map((idea) => `${idea.title} (${idea.why.replace(/[.\s]+$/, "")})`).join("; ")}.`,
        "",
      );
    const attemptPhotos = item.photos.filter((photo) => photo.attemptId === attempt.id).length;
    if (attemptPhotos) lines.push(`${attemptPhotos} ${attemptPhotos === 1 ? "photo" : "photos"}.`, "");
    if (attempt.file) {
      lines.push(
        attempt.file.kind === "model"
          ? `Model: ${fileLine(attempt.file)}.`
          : `Slicer file: ${attempt.file.name} (plate ${attempt.file.plate} of ${attempt.file.plateCount}).`,
        "",
      );
    }
  });

  const worked = [...item.attempts]
    .map((attempt, index) => ({ attempt, number: index + 1 }))
    .reverse()
    .find(({ attempt }) => attempt.outcome === "success");
  lines.push("## What worked", "");
  if (worked) {
    const settings = describeSettings(worked.attempt.settings);
    lines.push(
      `The latest attempt that worked is attempt ${worked.number}${settings.length ? `: ${settings.join(", ")}` : ""}.`,
      worked.attempt.note.trim() ? `\n${worked.attempt.note.trim()}` : "",
    );
  } else {
    lines.push("_Nothing has worked yet._");
  }
  if (context.comments?.length) {
    lines.push("", "## Comments", "");
    for (const comment of context.comments) {
      const edited = comment.editedAt ? ", edited" : "";
      lines.push(
        `**${who(comment.authorId, comment.via)}** (${date(comment.createdAt)}${edited}): ${comment.body.trim()}`,
        "",
      );
    }
  }
  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}
