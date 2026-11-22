import type { Person } from "@shared/api";
import { type PersonColor, withoutOwner } from "@shared/people";
import { useState } from "react";
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
  /**
   * A print from the printer that this person started (decision 0076): the small mark is the printer's glyph, and
   * the name reads "Marie, from the printer".
   */
  printer?: boolean;
  className?: string;
}

/**
 * The agent mark, per size: a small rounded square (an agent is never a circle) at the lower right, standing a little
 * past the circle, with the glyph inside; `cut` takes its place out of the face (the agent-cut utilities in tokens.css,
 * whose geometry matches these sizes).
 */
const marks = {
  xs: { glyph: 9, cut: "agent-cut-xs", className: "size-2.5 -right-0.5 -bottom-0.5" },
  sm: { glyph: 10, cut: "agent-cut-sm", className: "size-3 -right-0.5 -bottom-0.5" },
  md: { glyph: 12, cut: "agent-cut-md", className: "size-4 -right-0.75 -bottom-0.75" },
  lg: { glyph: 15, cut: "agent-cut-lg", className: "size-5 -right-1 -bottom-1" },
} as const;

/**
 * A person's initials on their color (or their picture). Shown beside what they did.
 *
 * With `via`, it was done through one of their agents ("Claude for Alex", "Share from iPhone"): it is still theirs,
 * so it is still their face, at every size; a small agent mark sits in its lower right corner, cut out of the
 * circle, and the name reads "Alex, via Claude for Alex".
 */
export function Avatar({
  person,
  size = "md",
  ringed = false,
  decorative = false,
  via,
  printer = false,
  className,
}: AvatarProps) {
  const marked = printer || !!via;
  const label = printer ? `${person.name}, from the printer` : via ? `${person.name}, via ${via}` : person.name;
  const face = (
    <span
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label, title: label })}
      className={cn(
        "text-on-accent relative inline-flex shrink-0 items-center justify-center rounded-full font-bold select-none",
        colors[person.color],
        sizes[size],
        ringed && "ring-paper ring-2",
        // Small, two letters fill the circle: nudged a pixel up and left, they keep clear of the mark's cutout.
        marked && marks[size].cut,
        marked && (size === "xs" || size === "sm") && "pr-0.5 pb-0.5",
        !marked && className,
      )}
    >
      {initials(person.name)}
      {person.photoUrl && <Picture key={person.photoUrl} url={person.photoUrl} />}
    </span>
  );
  if (!marked) return face;
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {face}
      <span
        aria-hidden
        className={cn(
          "bg-ink-faint text-paper rounded-mark absolute inline-flex items-center justify-center",
          marks[size].className,
        )}
      >
        {printer ? (
          <span className="printer-glyph" style={{ width: marks[size].glyph, height: marks[size].glyph }} />
        ) : (
          <AgentIcon size={marks[size].glyph} weight="fill" />
        )}
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
