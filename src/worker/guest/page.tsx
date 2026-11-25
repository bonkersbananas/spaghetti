/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";
import { checkLinkUrl } from "../../shared/link-safety.ts";
import { findLinks, linkWords, shortUrl } from "../../shared/links.ts";
import { sameModel } from "../../shared/model-mark.ts";
import { noteSize } from "../../shared/notes.ts";
import { colorTone } from "../../shared/spools.ts";
import { GUEST_ICONS, type GuestIconName } from "./icons.ts";
import {
  type GuestAttempt,
  type GuestBuild,
  type GuestChange,
  type GuestFilament,
  type GuestFile,
  type GuestModel,
  type GuestPart,
  type GuestPhoto,
  type GuestSetting,
  type GuestView,
  guestDate,
} from "./view.ts";

/**
 * The page someone who isn't signed in sees at /s/<token> (decision 0075): one idea, build or twist, read-only,
 * photos first, with no app around it and no script at all. Rendered by the Worker with hono/jsx, which escapes every
 * text and attribute; links are made only from http(s) addresses (checkLinkUrl). Styles are src/guest/guest.css.
 * Its one script (src/guest/island.ts, decision 0077) only opens the 3D view of a plate when its picture is tapped.
 */

/** Where a guest fetches one of the page's photos: through the link's own token, never /api. */
export const photoUrl = (token: string, id: string, variant: "thumb" | "large") =>
  `/s/${token}/photos/${id}/${variant}`;

/** Where a guest fetches a file's plate picture and the plate's toolpaths: through the link's own token, never /api. */
export const fileUrl = (token: string, id: string, part: "thumb" | "toolpaths") => `/s/${token}/files/${id}/${part}`;

const OUT = { target: "_blank", rel: "noopener noreferrer nofollow ugc" } as const;

function Icon({ name, class: className }: { name: GuestIconName; class?: string }) {
  return (
    <svg class={`gp-icon ${className ?? ""}`} viewBox="0 0 256 256" aria-hidden="true" focusable="false">
      {GUEST_ICONS[name].map((d) => (
        <path d={d} />
      ))}
    </svg>
  );
}

/** What a link in a note says: the model's own title for the model's page, else the words of its address. */
function linkText(url: string, model?: GuestModel | null) {
  if (model?.title && sameModel(url, model.url)) return model.title;
  return linkWords(url)?.words ?? shortUrl(url);
}

/** Text with its http(s) links made links (anything else stays text), and its line breaks kept. */
function Linked({ text, model }: { text: string; model?: GuestModel | null }) {
  const parts: Child[] = [];
  let at = 0;
  for (const { url, start, end } of findLinks(text)) {
    const safe = checkLinkUrl(url);
    if (!safe || (safe.protocol !== "https:" && safe.protocol !== "http:")) continue;
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <a class="gp-link" href={safe.href} title={shortUrl(url)} {...OUT}>
        {linkText(url, model)}
      </a>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  // Line breaks inside a paragraph stay line breaks.
  const out: Child[] = [];
  for (const part of parts) {
    if (typeof part !== "string") {
      out.push(part);
      continue;
    }
    part.split("\n").forEach((line, index) => {
      if (index > 0) out.push(<br />);
      out.push(line);
    });
  }
  return <>{out}</>;
}

/** A note as paragraphs (a blank line between them). */
function Note({ text, model, class: className }: { text: string; model?: GuestModel | null; class?: string }) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (!paragraphs.length) return null;
  return (
    <div class={`gp-note ${className ?? ""}`}>
      {paragraphs.map((paragraph) => (
        <p>
          <Linked text={paragraph} model={model} />
        </p>
      ))}
    </div>
  );
}

const shape = (photo: GuestPhoto) =>
  photo.width / photo.height > 1.15 ? "landscape" : photo.width / photo.height < 0.87 ? "portrait" : "square";

/** One photo: its own colour while it loads, the thumbnail on a phone and the large one where it shows large. */
function Picture({
  token,
  photo,
  alt,
  sizes,
  eager,
  class: className,
}: {
  token: string;
  photo: GuestPhoto;
  alt: string;
  sizes: string;
  eager?: boolean;
  class?: string;
}) {
  return (
    <img
      class={`gp-img ${className ?? ""}`}
      src={photoUrl(token, photo.id, "thumb")}
      srcset={`${photoUrl(token, photo.id, "thumb")} 600w, ${photoUrl(token, photo.id, "large")} 2048w`}
      sizes={sizes}
      width={photo.width}
      height={photo.height}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      fetchpriority={eager ? "high" : undefined}
      style={photo.color ? `background-color:${photo.color}` : undefined}
    />
  );
}

/**
 * One place a photo shows on the page. Each place has its own large view and its own anchor to come back to, so a
 * photo shown twice (a build's cover is often an attempt's photo too) closes back to where it was opened.
 */
interface Shown {
  key: string;
  photo: GuestPhoto;
  alt: string;
}

/** A photo that opens large over the page (a CSS :target view, no script). */
function Zoomable({ shown, children }: { shown: Shown; children: Child }) {
  return (
    <a class="gp-zoom" href={`#photo-${shown.key}`} id={`from-${shown.key}`} aria-label={`${shown.alt}, larger`}>
      {children}
    </a>
  );
}

/**
 * Every place's large view, at the end of the page: the photo whole on a dark ground, as large as the screen allows.
 * The whole of it is the way back (a tap anywhere, or the cross), to the photo's own place on the page.
 */
function Lightboxes({ token, shown }: { token: string; shown: Shown[] }) {
  return (
    <>
      {shown.map(({ key, photo, alt }) => (
        <div class="gp-lightbox" id={`photo-${key}`} role="dialog" aria-label={alt}>
          <a class="gp-lightbox-back" href={`#from-${key}`} aria-label="Close">
            <img
              class="gp-lightbox-img"
              src={photoUrl(token, photo.id, "large")}
              width={photo.width}
              height={photo.height}
              alt=""
              loading="lazy"
              decoding="async"
            />
            <span class="gp-lightbox-close">
              <Icon name="close" />
            </span>
          </a>
        </div>
      ))}
    </>
  );
}

/** The photos the page leads with: a row to swipe on a phone, one large photo and a few beside it on a computer. */
function Gallery({ token, shown }: { token: string; shown: Shown[] }) {
  const [first, ...rest] = shown;
  if (!first) return null;
  const lead = first.photo;
  return (
    <section
      class={`gp-gallery gp-gallery--${shape(lead)} ${rest.length ? `gp-gallery--many gp-gallery--rest-${Math.min(rest.length, 3)}` : ""}`}
      aria-label="Photos"
    >
      <ul class="gp-strip">
        {shown.map((place, index) => (
          <li class="gp-slide">
            <Zoomable shown={place}>
              <Picture
                token={token}
                photo={place.photo}
                alt={place.alt}
                sizes={index === 0 ? "(min-width: 48rem) 42rem, 90vw" : "(min-width: 48rem) 14rem, 90vw"}
                eager={index === 0}
              />
            </Zoomable>
          </li>
        ))}
      </ul>
      {rest.length > 0 && <p class="gp-swipe">{shown.length} photos</p>}
    </section>
  );
}

/**
 * No photo: the note takes the photo's place, set as the app's note cards are (NoteFace: Fraunces on the note
 * surface under one faint rule, its size stepping down as the note grows), and grows with the note: nothing is cut.
 */
function NoteCard({ text, model }: { text: string; model: GuestModel | null }) {
  return (
    <section class="gp-gallery gp-notecard" aria-label="Note">
      <div class={`gp-noteface gp-noteface--${noteSize(text)}`}>
        <span class="gp-noteface-rule" aria-hidden="true" />
        <Note text={text} model={model} class="gp-note--face" />
      </div>
    </section>
  );
}

/** The model's page as the app's LinkCard shows it: the site's letter on a tile, "Model on …" and the title. */
function ModelCard({ model }: { model: GuestModel }) {
  const byline = [model.designer ? `by ${model.designer}` : "", model.license ?? ""].filter(Boolean).join(" · ");
  return (
    <a class="gp-model" href={model.url} {...OUT}>
      <span class="gp-model-mark" aria-hidden="true">
        {model.letter}
      </span>
      <span class="gp-model-words">
        <span class="gp-overline gp-overline--basil">Model on {model.place}</span>
        <span class="gp-model-title">{model.title ?? linkWords(model.url)?.words ?? shortUrl(model.url)}</span>
        {byline && <span class="gp-model-by">{byline}</span>}
      </span>
      <Icon name="out" class="gp-model-out" />
    </a>
  );
}

/** A filament's colour; a light one gets a firmer rim so it never reads as an empty ring. None without a colour. */
function Swatch({ color }: { color: string | null }) {
  if (!color) return null;
  return (
    <span
      class={`gp-swatch ${colorTone(color) === "light" ? "gp-swatch--light" : ""}`}
      style={`background-color:${color}`}
      aria-hidden="true"
    />
  );
}

function Filaments({ filaments }: { filaments: GuestFilament[] }) {
  if (!filaments.length) return null;
  return (
    <ul class="gp-filaments" aria-label="Filament">
      {filaments.map((filament) => (
        <li>
          <Swatch color={filament.color} />
          {filament.name}
        </li>
      ))}
    </ul>
  );
}

/** The settings to print it with, straight on the card or page: the filaments over a grid of label and value. */
function Settings({ settings, filaments }: { settings: GuestSetting[]; filaments: GuestFilament[] }) {
  if (!settings.length && !filaments.length) return null;
  return (
    <div class="gp-settings">
      <Filaments filaments={filaments} />
      {settings.length > 0 && (
        <dl class="gp-dl">
          {settings.map((row) => (
            <div>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * Short pieces on one line, as the app's MetaList ("About 21 min · 3.3 g each · Sliced by Spaghetti"), that wraps
 * cleanly: each piece carries its dot in a gutter the row hangs into, so a dot never begins or ends a line.
 */
function Pieces({ pieces, class: className, inline }: { pieces: string[]; class: string; inline?: boolean }) {
  if (!pieces.length) return null;
  const row = (
    <span class="gp-pieces-row">
      {pieces.map((piece, index) => (
        <span class="gp-piece">
          {index > 0 && <span class="gp-sr">, </span>}
          {piece}
        </span>
      ))}
    </span>
  );
  // Inside a button (a card's lead), where only phrasing content may go.
  if (inline) return <span class={`gp-pieces ${className}`}>{row}</span>;
  return <p class={`gp-pieces ${className}`}>{row}</p>;
}

/**
 * What the 3D view is given to draw a plate (src/guest/viewer.tsx reads it): where the toolpaths are, through the
 * token, and what the app's own viewer is told about the file. JSON in a data attribute, escaped like any attribute.
 */
function viewData(token: string, file: GuestFile) {
  const view = file.view;
  if (!view) return undefined;
  return JSON.stringify({
    url: fileUrl(token, file.id, "toolpaths"),
    id: file.id,
    name: file.name,
    ...view,
  });
}

/**
 * A file's plate picture on the render ground, as the app's PlateThumb. Where the plate can be seen in 3D it carries a
 * quiet "3D" pill on its corner (the app's ThreeDButton); the card or row around it is what opens the view.
 */
function Plate({ token, file, compact }: { token: string; file: GuestFile; compact?: boolean }) {
  return (
    <span class={`gp-plate ${file.view ? "gp-plate--3d" : ""} ${compact ? "gp-plate--small" : ""}`}>
      {file.thumb ? (
        <img
          class="gp-plate-img"
          src={fileUrl(token, file.id, "thumb")}
          alt={file.view ? "" : `${file.name}, its plate`}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <Icon name="file" class="gp-plate-none" />
      )}
      {file.view && (
        <span class="gp-3d" aria-hidden="true">
          <Icon name="cube" />
          {!compact && "3D"}
        </span>
      )}
    </span>
  );
}

/**
 * What opens a plate's 3D view: a button holding the card's own first lines, named by what they say, whose tap area
 * covers the whole card or row (its ::after), so anywhere on it opens the view, as an app card opens.
 */
function Opens({ token, file, children }: { token: string; file: GuestFile; children: Child }) {
  return (
    <button type="button" class="gp-open" data-view3d={viewData(token, file)} aria-haspopup="dialog">
      {children}
      <span class="gp-sr">, in 3D</span>
    </button>
  );
}

/** A caution, as the app's: the circled mark and one short sentence in semolina, advice and never an alarm. */
function Cautions({ cautions }: { cautions: string[] }) {
  if (!cautions.length) return null;
  return (
    <>
      {cautions.map((caution) => (
        <p class="gp-caution">
          <Icon name="caution" />
          <span>{caution}</span>
        </p>
      ))}
    </>
  );
}

/**
 * A model or slicer file as the app's card shows it, read-only: the plate, what the print takes ("About 1 h 26 min ·
 * 13.2 g") over the file's name and its size, its cautions, what it is sliced with in the settings row's words, and
 * its filaments, each with its colour. The whole card opens the 3D view. No download, no "Open in Bambu Studio".
 */
function FileCard({ token, file }: { token: string; file: GuestFile }) {
  const heading =
    file.lead.length > 0 ? (
      <>
        <Pieces pieces={file.lead} class="gp-file-lead" inline />
        <span class="gp-sr">, </span>
        <span class="gp-file-name">{file.name}</span>
      </>
    ) : (
      <span class="gp-file-lead gp-file-lead--name">{file.name}</span>
    );
  return (
    <li class={`gp-file ${file.view ? "gp-file--3d" : ""}`}>
      <Plate token={token} file={file} />
      {/* One column beside the plate on a computer, as the app's FileCard; on a phone its lines run across the card. */}
      <div class="gp-file-text">
        <div class="gp-file-words">
          {file.view ? (
            <Opens token={token} file={file}>
              {heading}
            </Opens>
          ) : (
            <p class="gp-file-heading">{heading}</p>
          )}
          <Pieces pieces={file.meta} class="gp-file-meta" />
        </div>
        {(file.cautions.length > 0 || file.settings.length > 0 || file.filaments.length > 0) && (
          <div class="gp-file-more">
            <Cautions cautions={file.cautions} />
            <Pieces pieces={file.settings} class="gp-file-settings" />
            <Filaments filaments={file.filaments} />
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * The files kept with the thing: its models, each a card whose plate opens the 3D view. In the column of words, as the
 * app's idea page has them under the note: on a computer they scroll beside the photos, which stay in view.
 */
function Files({ token, files }: { token: string; files: GuestFile[] }) {
  if (!files.length) return null;
  const viewable = files.some((file) => file.view);
  return (
    <section class="gp-block gp-files" aria-labelledby="gp-files">
      <h2 class="gp-block-title" id="gp-files">
        {files.length === 1 ? "The model" : `The models`}
        {files.length > 1 && <span class="gp-count"> {files.length}</span>}
      </h2>
      {viewable && (
        // What a tap gives: the print in 3D. Not "layer by layer": it opens on the finished print (it builds itself up
        // only the first time on a device), and its play button is a quiet one in the corner.
        <p class="gp-files-hint">
          {files.length === 1 ? "Tap the model" : "Tap a model"} to see it in 3D, as it will print.
        </p>
      )}
      <ul class="gp-file-list">
        {files.map((file) => (
          <FileCard token={token} file={file} />
        ))}
      </ul>
    </section>
  );
}

/**
 * An attempt's file on its card, small as the app's story card has it: the plate and the file's name. Where it can be
 * seen in 3D, the whole row is the button, and says so: "See how it prints".
 */
function AttemptFile({ token, file }: { token: string; file: GuestFile }) {
  const name = <span class="gp-attempt-file-name">{file.name}</span>;
  return (
    <div class={`gp-attempt-file ${file.view ? "gp-attempt-file--3d" : ""}`}>
      <Plate token={token} file={file} compact />
      <div class="gp-file-words">
        {file.view ? (
          <Opens token={token} file={file}>
            {name}
            <span class="gp-sr">, </span>
            <span class="gp-attempt-file-cta">See how it prints</span>
          </Opens>
        ) : (
          <>
            <p class="gp-file-heading">{name}</p>
            <Pieces pieces={file.meta.filter((piece) => !/ each$/.test(piece))} class="gp-file-meta" />
          </>
        )}
        <Cautions cautions={file.cautions} />
      </div>
    </div>
  );
}

/** What a build is made of, and how far each part is: "Hull half · 1 of 2", a tick once it is done. */
function Parts({ parts }: { parts: GuestPart[] }) {
  if (!parts.length) return null;
  return (
    <section class="gp-block" aria-labelledby="gp-parts">
      <h2 class="gp-block-title" id="gp-parts">
        What it's made of
      </h2>
      <ul class="gp-parts">
        {parts.map((part) => (
          <li class={part.done ? "gp-part gp-part--done" : "gp-part"}>
            <span class="gp-part-name">{part.name}</span>
            <span class="gp-part-progress">
              {part.done && <Icon name="check" />}
              {part.progress}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const OUTCOME_ICON: Record<string, GuestIconName> = { success: "worked", partial: "partly", failed: "spaghetti" };

function OutcomeBadge({ attempt }: { attempt: GuestAttempt }) {
  const tone = attempt.outcome ?? (attempt.offBed ? "offbed" : "printing");
  return (
    <span class={`gp-outcome gp-outcome--${tone}`}>
      {attempt.outcome ? <Icon name={OUTCOME_ICON[attempt.outcome] as GuestIconName} /> : <span class="gp-dot" />}
      {attempt.outcomeLabel}
    </span>
  );
}

/** What changed since the attempt before, as the app's ChangeLine: the turning arrows, each change on semolina. */
function ChangeLine({ changes, number }: { changes: string[]; number: number }) {
  if (!changes.length) return null;
  return (
    <p class="gp-changeline">
      <Icon name="changed" class="gp-changeline-icon" />
      <span class="gp-sr">Changed since attempt {number - 1}: </span>
      <span>
        {changes.map((change, index) => (
          <>
            {index > 0 && <span aria-hidden="true"> · </span>}
            <span class="gp-mark">{change}</span>
          </>
        ))}
      </span>
    </p>
  );
}

/** What went wrong (tomato) and what went well (basil, with a tick), as the app's AttemptTags. */
function Tags({ wrong, well }: { wrong: string[]; well: string[] }) {
  if (!wrong.length && !well.length) return null;
  return (
    <ul class="gp-chips" aria-label="Tags">
      {wrong.map((tag) => (
        <li class="gp-chip gp-chip--tomato">{tag}</li>
      ))}
      {well.map((tag) => (
        <li class="gp-chip gp-chip--basil">
          <Icon name="check" />
          {tag}
        </li>
      ))}
    </ul>
  );
}

/** The words of an attempt: what changed, its note, its tags and its file. Settings are the build's, said once. */
function AttemptBody({ token, attempt }: { token: string; attempt: GuestAttempt }) {
  return (
    <div class="gp-attempt-body">
      <ChangeLine changes={attempt.changes} number={attempt.number} />
      <Note text={attempt.note} class="gp-note--attempt" />
      <Tags wrong={attempt.wentWrong} well={attempt.wentWell} />
      {attempt.file && <AttemptFile token={token} file={attempt.file} />}
    </div>
  );
}

const tone = (attempt: GuestAttempt) => attempt.outcome ?? (attempt.offBed ? "offbed" : "printing");

const metaOf = (attempt: GuestAttempt) =>
  [guestDate(attempt.printedAt), ...attempt.results, ...(attempt.printed ? [attempt.printed] : [])].join(" · ");

function AttemptPhotos({ token, shown }: { token: string; shown: Shown[] }) {
  if (!shown.length) return null;
  return (
    <ul class={`gp-attempt-photos ${shown.length % 2 ? "gp-attempt-photos--odd" : ""}`}>
      {shown.map((place) => (
        <li>
          <Zoomable shown={place}>
            <Picture token={token} photo={place.photo} alt={place.alt} sizes="(min-width: 48rem) 15rem, 70vw" />
          </Zoomable>
        </li>
      ))}
    </ul>
  );
}

/** An attempt as a card: the newest and the ones that worked, photos first. */
function Attempt({ token, attempt, shown }: { token: string; attempt: GuestAttempt; shown: Shown[] }) {
  return (
    <li class={`gp-attempt ${shown.length ? "gp-attempt--photos" : ""}`}>
      <div class="gp-attempt-head">
        <div class="gp-attempt-line">
          <OutcomeBadge attempt={attempt} />
          <h3 class="gp-attempt-title">Attempt {attempt.number}</h3>
        </div>
        <p class="gp-attempt-meta">{metaOf(attempt)}</p>
      </div>
      <AttemptPhotos token={token} shown={shown} />
      <AttemptBody token={token} attempt={attempt} />
    </li>
  );
}

/**
 * An attempt as a short row: a small picture, "Attempt 3", how it went and a line of what changed or was said. It opens
 * in place (a native details element, no script) to the whole attempt, so none is left out.
 */
function AttemptRow({ token, attempt, shown }: { token: string; attempt: GuestAttempt; shown: Shown[] }) {
  const first = shown[0];
  const line = attempt.changes.length ? attempt.changes.join(" · ") : attempt.note.replace(/\s+/g, " ");
  const open = shown.length > 0 || attempt.note || attempt.changes.length || attempt.file;
  const head = (
    <>
      {first ? (
        <Picture token={token} photo={first.photo} alt="" sizes="4rem" class="gp-row-img" />
      ) : (
        <span class={`gp-row-img gp-row-none gp-row-none--${tone(attempt)}`} aria-hidden="true" />
      )}
      <span class="gp-row-text">
        <span class="gp-row-line">
          <OutcomeBadge attempt={attempt} />
          <span class="gp-row-title">Attempt {attempt.number}</span>
        </span>
        <span class="gp-row-sub">{[guestDate(attempt.printedAt), ...attempt.results.slice(0, 1)].join(" · ")}</span>
        {line && <span class="gp-row-said">{line}</span>}
      </span>
    </>
  );
  if (!open) {
    return (
      <li class="gp-row">
        <div class="gp-row-head">{head}</div>
      </li>
    );
  }
  return (
    <li class="gp-row">
      <details>
        <summary class="gp-row-head">
          {head}
          <Icon name="chevron" class="gp-row-chevron" />
        </summary>
        <div class="gp-row-open">
          <AttemptPhotos token={token} shown={shown} />
          <AttemptBody token={token} attempt={attempt} />
        </div>
      </details>
    </li>
  );
}

/** How the build prints, once: the filaments and the settings on one wrapping line. */
function PrintedWith({ settings, filaments }: { settings: GuestSetting[]; filaments: GuestFilament[] }) {
  if (!settings.length && !filaments.length) return null;
  return (
    <section class="gp-printed" aria-label="How it prints">
      <p class="gp-overline">How it prints</p>
      <Filaments filaments={filaments} />
      <Pieces pieces={settings.map((row) => `${row.label} ${row.value}`)} class="gp-printed-line" />
    </section>
  );
}

function Trail({ build }: { build: GuestBuild }) {
  if (!build.attempts.length) return null;
  return (
    <ol class="gp-trail" aria-hidden="true">
      {build.attempts.map((attempt) => (
        <li class={`gp-trail-step gp-trail-step--${attempt.outcome ?? (attempt.offBed ? "offbed" : "printing")}`} />
      ))}
    </ol>
  );
}

function Changes({ changes }: { changes: GuestChange[] }) {
  if (!changes.length) return null;
  return (
    <section class="gp-block" aria-labelledby="gp-changes">
      <h2 class="gp-block-title" id="gp-changes">
        What we changed
      </h2>
      {/* As the app's TwistChanges reads: "Scale 84 % fits the 42 mm grid", the value on semolina, plain lines. */}
      <ul class="gp-changes">
        {changes.map((change) => (
          <li>
            <span class="gp-change-name">{change.name}</span>
            {change.value && (
              <>
                {" "}
                <span class="gp-mark">{change.value}</span>
              </>
            )}
            {change.note && <span class="gp-change-note"> {change.note}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

const OVERLINE: Record<GuestView["kind"], string> = { idea: "An idea", build: "A build", twist: "A twist on a model" };

/** The words beside (or under) the photos: what it is, its note, the model, for a build how it went, and its files. */
function Story({ view, token, noteShown }: { view: GuestView; token: string; noteShown: boolean }) {
  const dates =
    view.kind === "idea"
      ? `Noted ${guestDate(view.capturedAt)}`
      : view.kind === "build"
        ? [
            view.startedAt ? `Started ${guestDate(view.startedAt)}` : "",
            view.finishedAt
              ? `${view.stageLabel === "On the shelf" ? "shelved" : "done"} ${guestDate(view.finishedAt)}`
              : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : "";
  return (
    <div class="gp-story">
      <p class="gp-overline">
        {OVERLINE[view.kind]}
        {view.kind === "build" && <span class="gp-overline-stage"> · {view.stageLabel}</span>}
      </p>
      <h1 class="gp-title">{view.title}</h1>
      {dates && <p class="gp-dates">{dates}</p>}
      {!noteShown && <Note text={view.note} model={view.model} />}
      {view.model && <ModelCard model={view.model} />}
      {view.kind === "build" && (
        <section class="gp-summary" aria-label="How it went">
          <p class="gp-summary-words">{view.summary}</p>
          <Trail build={view} />
          {view.totals.length > 0 && <p class="gp-summary-totals">{view.totals.join(" · ")}</p>}
        </section>
      )}
      {view.kind === "build" && <PrintedWith settings={view.settings} filaments={view.printedWith} />}
      {view.kind === "build" && <Parts parts={view.parts} />}
      {view.kind === "twist" && <Changes changes={view.changes} />}
      {view.kind === "twist" && view.recipe && (
        <section class="gp-block" aria-labelledby="gp-recipe">
          <h2 class="gp-block-title" id="gp-recipe">
            How we print it
          </h2>
          {view.recipe.name && <p class="gp-recipe-name">{view.recipe.name}</p>}
          <Note text={view.recipe.note} class="gp-note--small" />
          <Settings settings={view.recipe.settings} filaments={view.recipe.filaments} />
        </section>
      )}
      <Files token={token} files={view.files} />
    </div>
  );
}

function MadeWith() {
  return (
    <footer class="gp-foot">
      <img class="gp-foot-mark" src="/favicon.svg" width={20} height={20} alt="" />
      <span>Made with Spaghetti</span>
    </footer>
  );
}

/** The whole body of a shared thing's page. */
export function GuestBody({ view, token }: { view: GuestView; token: string }) {
  const gallery: Shown[] = view.photos.map((photo, index) => ({
    key: `lead-${index}`,
    photo,
    alt: view.photos.length > 1 ? `${view.title}, photo ${index + 1} of ${view.photos.length}` : view.title,
  }));
  const ofAttempt = (attempt: GuestAttempt): Shown[] =>
    attempt.photos.map((photo, index) => ({
      key: `a${attempt.number}-${index}`,
      photo,
      alt: `${view.title}, attempt ${attempt.number}${attempt.photos.length > 1 ? `, photo ${index + 1}` : ""}`,
    }));
  const attempts =
    view.kind === "build" ? view.attempts.map((attempt) => ({ attempt, shown: ofAttempt(attempt) })) : [];
  // Up to three attempts are all cards; more, and only the newest and the ones that worked are, the rest short rows.
  const cards = new Set(
    attempts.length <= 3
      ? attempts.map(({ attempt }) => attempt.number)
      : attempts
          .filter(({ attempt }, index) => index === attempts.length - 1 || attempt.outcome === "success")
          .map(({ attempt }) => attempt.number),
  );
  // No photo but a note: the note leads, in the photo's place.
  const noteLeads = !gallery.length && Boolean(view.note);
  return (
    <>
      <main class={`gp-page gp-page--${view.kind} ${gallery.length || noteLeads ? "" : "gp-page--no-photos"}`} id="top">
        <article class="gp-article">
          {noteLeads ? <NoteCard text={view.note} model={view.model} /> : <Gallery token={token} shown={gallery} />}
          <Story view={view} token={token} noteShown={noteLeads} />
        </article>
        {attempts.length > 0 && (
          <section class="gp-attempts" aria-labelledby="gp-attempts">
            <h2 class="gp-section-title" id="gp-attempts">
              Attempt by attempt
            </h2>
            <ol class="gp-attempt-list">
              {attempts.map(({ attempt, shown }) =>
                cards.has(attempt.number) ? (
                  <Attempt token={token} attempt={attempt} shown={shown} />
                ) : (
                  <AttemptRow token={token} attempt={attempt} shown={shown} />
                ),
              )}
            </ol>
          </section>
        )}
        <MadeWith />
      </main>
      <Lightboxes token={token} shown={[...gallery, ...attempts.flatMap(({ shown }) => shown)]} />
    </>
  );
}

/** What an unknown, stopped or deleted link shows: one calm sentence, the same for all three. */
export function NotSharedBody() {
  return (
    <main class="gp-page gp-gone" id="top">
      <svg class="gp-gone-art" viewBox="0 0 160 120" aria-hidden="true">
        <ellipse cx="80" cy="108" rx="48" ry="5" class="gp-art-shade" />
        <circle cx="80" cy="62" r="44" class="gp-art-sun" />
        <path d="M32 66c-7 0-10 4-10 8s3 7 8 7" class="gp-art-line" />
        <path d="M128 66c7 0 10 4 10 8s-3 7-8 7" class="gp-art-line" />
        <path d="M36 62h88v24c0 9-7 16-16 16H52c-9 0-16-7-16-16V62Z" class="gp-art-pot" />
        <path d="M48 72v14" class="gp-art-shine" />
        <path d="M34 62c0-12 20-18 46-18s46 6 46 18Z" class="gp-art-lid" />
        <circle cx="80" cy="40" r="5" class="gp-art-knob" />
      </svg>
      <h1 class="gp-gone-title">This isn't shared anymore</h1>
      <p class="gp-gone-words">The link was put away, or what it showed is gone. Whoever sent it can share it again.</p>
      <MadeWith />
    </main>
  );
}
