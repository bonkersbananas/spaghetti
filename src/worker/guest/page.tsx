/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";
import { checkLinkUrl } from "../../shared/link-safety.ts";
import { findLinks, linkWords, shortUrl } from "../../shared/links.ts";
import { sameModel } from "../../shared/model-mark.ts";
import { colorTone } from "../../shared/spools.ts";
import { GUEST_ICONS, type GuestIconName } from "./icons.ts";
import {
  type GuestAttempt,
  type GuestBuild,
  type GuestChange,
  type GuestFilament,
  type GuestModel,
  type GuestPhoto,
  type GuestSetting,
  type GuestView,
  guestDate,
} from "./view.ts";

/**
 * The page someone who isn't signed in sees at /s/<token> (decision 0075): one idea, build or twist, read-only,
 * photos first, with no app around it and no script at all. Rendered by the Worker with hono/jsx, which escapes every
 * text and attribute; links are made only from http(s) addresses (checkLinkUrl). Styles are src/guest/guest.css.
 */

/** Where a guest fetches one of the page's photos: through the link's own token, never /api. */
export const photoUrl = (token: string, id: string, variant: "thumb" | "large") =>
  `/s/${token}/photos/${id}/${variant}`;

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

/** A photo that opens large over the page (a CSS :target view, no script); Back or the cross closes it. */
function Zoomable({
  photo,
  alt,
  anchors,
  children,
}: {
  photo: GuestPhoto;
  alt: string;
  /** The photos given a place to come back to so far (one per photo: the cover can also be an attempt's). */
  anchors: Set<string>;
  children: Child;
}) {
  const first = !anchors.has(photo.id);
  anchors.add(photo.id);
  return (
    <a
      class="gp-zoom"
      href={`#photo-${photo.id}`}
      id={first ? `from-${photo.id}` : undefined}
      aria-label={`${alt}, larger`}
    >
      {children}
    </a>
  );
}

/** Every photo's large view, once each, at the end of the page. */
function Lightboxes({ token, photos }: { token: string; photos: { photo: GuestPhoto; alt: string }[] }) {
  return (
    <>
      {photos.map(({ photo, alt }) => (
        <div class="gp-lightbox" id={`photo-${photo.id}`} role="dialog" aria-label={alt}>
          <a class="gp-lightbox-back" href={`#from-${photo.id}`} tabindex={-1}>
            <span class="gp-sr">Close</span>
          </a>
          <img
            class="gp-lightbox-img"
            src={photoUrl(token, photo.id, "large")}
            width={photo.width}
            height={photo.height}
            alt={alt}
            loading="lazy"
            decoding="async"
            style={photo.color ? `background-color:${photo.color}` : undefined}
          />
          <a class="gp-lightbox-close" href={`#from-${photo.id}`} aria-label="Close">
            <Icon name="close" />
          </a>
        </div>
      ))}
    </>
  );
}

/** The photos the page leads with: a row to swipe on a phone, one large photo and a few beside it on a computer. */
function Gallery({
  token,
  photos,
  title,
  anchors,
}: {
  token: string;
  photos: GuestPhoto[];
  title: string;
  anchors: Set<string>;
}) {
  const [lead, ...rest] = photos;
  if (!lead) return null;
  const alt = (index: number) => (photos.length > 1 ? `${title}, photo ${index + 1} of ${photos.length}` : title);
  return (
    <section
      class={`gp-gallery gp-gallery--${shape(lead)} ${rest.length ? `gp-gallery--many gp-gallery--rest-${Math.min(rest.length, 3)}` : ""}`}
      aria-label="Photos"
    >
      <ul class="gp-strip">
        {photos.map((photo, index) => (
          <li class="gp-slide">
            <Zoomable photo={photo} alt={alt(index)} anchors={anchors}>
              <Picture
                token={token}
                photo={photo}
                alt={alt(index)}
                sizes={index === 0 ? "(min-width: 48rem) 42rem, 90vw" : "(min-width: 48rem) 14rem, 90vw"}
                eager={index === 0}
              />
            </Zoomable>
          </li>
        ))}
      </ul>
      {rest.length > 0 && <p class="gp-swipe">{photos.length} photos</p>}
    </section>
  );
}

function ModelCard({ model }: { model: GuestModel }) {
  const byline = [model.designer ? `by ${model.designer}` : "", model.license ?? ""].filter(Boolean).join(" · ");
  return (
    <a class="gp-model" href={model.url} {...OUT}>
      <span class="gp-model-mark" aria-hidden="true">
        <Icon name="model" />
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

const OUTCOME_ICON: Record<string, GuestIconName> = { success: "worked", partial: "partly", failed: "spaghetti" };

function OutcomeBadge({ attempt }: { attempt: GuestAttempt }) {
  const tone = attempt.outcome ?? "printing";
  return (
    <span class={`gp-outcome gp-outcome--${tone}`}>
      {attempt.outcome ? <Icon name={OUTCOME_ICON[attempt.outcome] as GuestIconName} /> : <span class="gp-dot" />}
      {attempt.outcomeLabel}
    </span>
  );
}

function Chips({ label, items, tone }: { label: string; items: string[]; tone?: "tomato" | "basil" }) {
  if (!items.length) return null;
  return (
    <div class="gp-chips-row">
      <span class="gp-chips-label">{label}</span>
      <ul class="gp-chips">
        {items.map((item) => (
          <li class={`gp-chip ${tone ? `gp-chip--${tone}` : ""}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Attempt({
  token,
  attempt,
  title,
  anchors,
}: {
  token: string;
  attempt: GuestAttempt;
  title: string;
  anchors: Set<string>;
}) {
  const alt = (index: number) =>
    `${title}, attempt ${attempt.number}${attempt.photos.length > 1 ? `, photo ${index + 1}` : ""}`;
  return (
    <li class={`gp-attempt ${attempt.photos.length ? "gp-attempt--photos" : ""}`}>
      <div class="gp-attempt-head">
        <OutcomeBadge attempt={attempt} />
        <h3 class="gp-attempt-title">Attempt {attempt.number}</h3>
        <span class="gp-attempt-date">{guestDate(attempt.printedAt)}</span>
      </div>
      {attempt.photos.length > 0 && (
        <ul class={`gp-attempt-photos ${attempt.photos.length % 2 ? "gp-attempt-photos--odd" : ""}`}>
          {attempt.photos.map((photo, index) => (
            <li>
              <Zoomable photo={photo} alt={alt(index)} anchors={anchors}>
                <Picture token={token} photo={photo} alt={alt(index)} sizes="(min-width: 48rem) 15rem, 70vw" />
              </Zoomable>
            </li>
          ))}
        </ul>
      )}
      <div class="gp-attempt-body">
        <Note text={attempt.note} class="gp-note--attempt" />
        {attempt.results.length > 0 && <p class="gp-results">{attempt.results.join(" · ")}</p>}
        <Chips label="Changed" items={attempt.changes} />
        <Chips label="Went wrong" items={attempt.wentWrong} tone="tomato" />
        <Chips label="Went well" items={attempt.wentWell} tone="basil" />
        <Settings settings={attempt.settings} filaments={attempt.settings.length ? attempt.filaments : []} />
      </div>
    </li>
  );
}

function Trail({ build }: { build: GuestBuild }) {
  if (!build.attempts.length) return null;
  return (
    <ol class="gp-trail" aria-hidden="true">
      {build.attempts.map((attempt) => (
        <li class={`gp-trail-step gp-trail-step--${attempt.outcome ?? "printing"}`} />
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
      <ul class="gp-changes">
        {changes.map((change) => (
          <li>
            <span class="gp-change-name">{change.name}</span>
            {change.value && <span class="gp-change-value">{change.value}</span>}
            {change.note && <span class="gp-change-note">{change.note}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

const OVERLINE: Record<GuestView["kind"], string> = { idea: "An idea", build: "A build", twist: "A twist on a model" };

/** The words beside (or under) the photos: what it is, its note, the model, and for a build how it went. */
function Story({ view }: { view: GuestView }) {
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
      <Note text={view.note} model={view.model} />
      {view.model && <ModelCard model={view.model} />}
      {view.kind === "build" && (
        <section class="gp-summary" aria-label="How it went">
          <Trail build={view} />
          <p class="gp-summary-words">{view.summary}</p>
          {view.totals.length > 0 && <p class="gp-summary-totals">{view.totals.join(" · ")}</p>}
        </section>
      )}
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
  const anchors = new Set<string>();
  const zoomed: { photo: GuestPhoto; alt: string }[] = view.photos.map((photo, index) => ({
    photo,
    alt: view.photos.length > 1 ? `${view.title}, photo ${index + 1} of ${view.photos.length}` : view.title,
  }));
  if (view.kind === "build") {
    for (const attempt of view.attempts)
      attempt.photos.forEach((photo, index) => {
        if (zoomed.some((seen) => seen.photo.id === photo.id)) return;
        zoomed.push({
          photo,
          alt: `${view.title}, attempt ${attempt.number}${attempt.photos.length > 1 ? `, photo ${index + 1}` : ""}`,
        });
      });
  }
  return (
    <>
      <main class={`gp-page gp-page--${view.kind} ${view.photos.length ? "" : "gp-page--no-photos"}`} id="top">
        <article class="gp-article">
          <Gallery token={token} photos={view.photos} title={view.title} anchors={anchors} />
          <Story view={view} />
        </article>
        {view.kind === "build" && view.attempts.length > 0 && (
          <section class="gp-attempts" aria-labelledby="gp-attempts">
            <h2 class="gp-section-title" id="gp-attempts">
              Attempt by attempt
            </h2>
            <ol class="gp-attempt-list">
              {view.attempts.map((attempt) => (
                <Attempt token={token} attempt={attempt} title={view.title} anchors={anchors} />
              ))}
            </ol>
          </section>
        )}
        <MadeWith />
      </main>
      <Lightboxes token={token} photos={zoomed} />
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
