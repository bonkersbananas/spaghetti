import type { Person } from "@shared/api";
import { type PersonColor, withoutOwner } from "@shared/people";
import { type CSSProperties, useState } from "react";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/initials";
import { AgentIcon } from "./icons";

const colors: Record<PersonColor, string> = {
  tomato: "bg-person-tomato",
  basil: "bg-person-basil",
  semolina: "bg-person-semolina",
  plum: "bg-person-plum",
  sea: "bg-person-sea",
  clay: "bg-person-clay",
};

const sizes = {
  // xs: two letters fit in 24 px at this size with normal tracking; one letter lost half of "Carl Oscar".
  // The others are letterspaced a little.
  xs: "size-6 text-micro",
  sm: "size-7 text-caption tracking-wide",
  md: "size-9 text-small tracking-wide",
  lg: "size-12 text-lead tracking-wide",
} as const;

interface AvatarProps {
  person: Pick<Person, "name" | "color"> & { photoUrl?: string | null };
  size?: keyof typeof sizes;
  /** Adds a paper-colored ring, for overlapping stacks. */
  ringed?: boolean;
  /** Next to the person's name already (a filter chip): hidden from screen readers, which would read the name twice. */
  decorative?: boolean;
  /** The agent this was done through ("Claude for Alex"): the person's avatar gets a small agent mark. */
  via?: string;
  className?: string;
}

/**
 * The agent mark, per size: a small rounded square (an agent is never a circle) at the lower right, standing out
 * past the edge by `out`, with the glyph inside. `face`, `mark`, `out` and `gap` are px, for the cutout below.
 */
const marks = {
  xs: { face: 24, mark: 10, out: 2, gap: 1.5, glyph: 9, className: "size-2.5 -right-0.5 -bottom-0.5" },
  sm: { face: 28, mark: 12, out: 2, gap: 1.5, glyph: 10, className: "size-3 -right-0.5 -bottom-0.5" },
  md: { face: 36, mark: 16, out: 3, gap: 2, glyph: 12, className: "size-4 -right-0.75 -bottom-0.75" },
  lg: { face: 48, mark: 20, out: 4, gap: 2, glyph: 15, className: "size-5 -right-1 -bottom-1" },
} as const;

/**
 * Where the mark sits, cut out of the face with a hair of space around it, so it reads on any surface (paper, cream,
 * a sheet, a photo) without a ring in the surface's color. A mask, so the face's own picture is never covered.
 */
const cutouts = Object.fromEntries(
  Object.entries(marks).map(([size, { face, mark, out, gap }]) => {
    const from = face + out - mark - gap;
    const to = face + out + gap + 1;
    const r = mark * 0.3 + gap;
    const hole = `M${from + r} ${from}H${to - r}A${r} ${r} 0 0 1 ${to} ${from + r}V${to - r}A${r} ${r} 0 0 1 ${to - r} ${to}H${from + r}A${r} ${r} 0 0 1 ${from} ${to - r}V${from + r}A${r} ${r} 0 0 1 ${from + r} ${from}Z`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${face} ${face}"><path fill-rule="evenodd" d="M0 0H${face}V${face}H0Z${hole}"/></svg>`;
    const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    return [size, { maskImage: url, WebkitMaskImage: url, maskSize: "100% 100%", WebkitMaskSize: "100% 100%" }];
  }),
) as Record<keyof typeof sizes, CSSProperties>;

/**
 * A person's initials on their color (or their picture). Shown beside what they did.
 *
 * With `via`, it was done through one of their agents ("Claude for Alex", "Share from iPhone"): it is still theirs,
 * so it is still their face, at every size; a small agent mark sits in its lower right corner, cut out of the
 * circle, and the name reads "Alex, via Claude for Alex".
 */
export function Avatar({ person, size = "md", ringed = false, decorative = false, via, className }: AvatarProps) {
  const label = via ? `${person.name}, via ${via}` : person.name;
  const face = (
    <span
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label, title: label })}
      style={via ? cutouts[size] : undefined}
      className={cn(
        "text-on-accent relative inline-flex shrink-0 items-center justify-center rounded-full font-bold select-none",
        colors[person.color],
        sizes[size],
        ringed && "ring-paper ring-2",
        // Small, two letters fill the circle: nudged a pixel up and left, they keep clear of the mark's cutout.
        via && (size === "xs" || size === "sm") && "pr-0.5 pb-0.5",
        !via && className,
      )}
    >
      {initials(person.name)}
      {person.photoUrl && <Picture key={person.photoUrl} url={person.photoUrl} />}
    </span>
  );
  if (!via) return face;
  const mark = marks[size];
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {face}
      <span
        aria-hidden
        className={cn(
          "bg-ink-faint text-paper rounded-mark absolute inline-flex items-center justify-center",
          mark.className,
        )}
      >
        <AgentIcon size={mark.glyph} weight="fill" />
      </span>
    </span>
  );
}

/**
 * The picture over the initials: the initials stay underneath while it loads, if it fails and offline, so nothing
 * shifts; it fades in once decoded. A hairline ring (inset) keeps a picture that matches the surface from melting into it.
 */
function Picture({ url }: { url: string }) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  if (state === "failed") return null;
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      ref={(img) => {
        if (img?.complete && img.naturalWidth > 0) setState("loaded");
      }}
      onLoad={() => setState("loaded")}
      onError={() => setState("failed")}
      className={cn(
        "ring-ink/10 absolute inset-0 size-full rounded-full object-cover ring-1 transition-opacity duration-300 ring-inset dark:ring-white/15 dark:brightness-90",
        state === "loaded" ? "opacity-100" : "opacity-0",
      )}
    />
  );
}

/**
 * An agent itself ("Claude for Alex"), as the subject of its own card: a rounded
 * square, not a circle, so it never passes for a person, in its owner's color,
 * with its own first letter so one agent can be told from another.
 */
export function AgentAvatar({
  name,
  owner,
  size = "lg",
  className,
}: {
  name: string;
  owner: Pick<Person, "color">;
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "text-on-accent font-display inline-flex shrink-0 items-center justify-center font-semibold select-none",
        colors[owner.color],
        sizes[size],
        size === "lg" ? "text-title rounded-md" : "rounded-sm",
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/**
 * "via Claude for Alex", quietly, in the place that says who did something. Renders nothing without an agent.
 * With `person`, the one already named or shown beside it, a name that ends with them is said once:
 * "Alex captured this via Claude", not "via Claude for Alex".
 */
export function ViaText({ name, person, className }: { name?: string; person?: string; className?: string }) {
  return name ? (
    <span className={cn("text-ink-faint whitespace-nowrap", className)}>via {withoutOwner(name, person)}</span>
  ) : null;
}

export function AvatarStack({ people, size = "sm" }: { people: Person[]; size?: keyof typeof sizes }) {
  return (
    <span className="inline-flex -space-x-1.5">
      {people.map((person) => (
        <Avatar key={person.id} person={person} size={size} ringed />
      ))}
    </span>
  );
}
