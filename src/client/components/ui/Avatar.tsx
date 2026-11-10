import type { Person } from "@shared/api";
import type { PersonColor } from "@shared/people";
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
  // Two letters fit in 24 px at this size and tracking; one letter (the old xs) lost half of "Carl Oscar".
  xs: "size-6 text-micro tracking-normal",
  sm: "size-7 text-caption",
  md: "size-9 text-small",
  lg: "size-12 text-lead",
} as const;

interface AvatarProps {
  person: Pick<Person, "name" | "color">;
  size?: keyof typeof sizes;
  /** Adds a paper-colored ring, for overlapping stacks. */
  ringed?: boolean;
  /** Next to the person's name already (a filter chip): hidden from screen readers, which would read the name twice. */
  decorative?: boolean;
  /** The agent this was done through ("Claude for Alex"): the person's avatar gets a small agent mark. */
  via?: string;
  className?: string;
}

const glyphSizes = { xs: 12, sm: 16, md: 20, lg: 28 } as const;
const badgeSizes = { md: "size-4.5", lg: "size-5.5" } as const;
const badgeGlyphs = { md: 11, lg: 14 } as const;

/**
 * A person's initials on their color. Shown beside what they wrote.
 *
 * With `via`, it was done through that person's agent ("Claude for Alex"):
 * small (xs, sm) the circle keeps their color and shows an agent glyph in place
 * of the letter, so it reads as "Alex's agent" at a glance; larger (md, lg) the
 * initials stay and a badge sits outside the circle, cut out of the surface behind.
 */
export function Avatar({ person, size = "md", ringed = false, decorative = false, via, className }: AvatarProps) {
  const label = via ? `${person.name}, via ${via}` : person.name;
  const glyphInstead = !!via && (size === "xs" || size === "sm");
  const face = (
    <span
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label, title: label })}
      className={cn(
        "text-on-accent inline-flex shrink-0 items-center justify-center rounded-full font-bold tracking-wide select-none",
        colors[person.color],
        sizes[size],
        ringed && "ring-paper ring-2",
        !via && className,
      )}
    >
      {glyphInstead ? <AgentIcon size={glyphSizes[size]} weight="fill" aria-hidden /> : initials(person.name)}
    </span>
  );
  if (!via) return face;
  if (glyphInstead) return className ? <span className={cn("inline-flex shrink-0", className)}>{face}</span> : face;
  const badge = badgeSizes[size as "md" | "lg"];
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {face}
      <span
        aria-hidden
        className={cn(
          "bg-select text-on-select ring-cream absolute -right-1.5 -bottom-1.5 inline-flex items-center justify-center rounded-full ring-2",
          badge,
        )}
      >
        <AgentIcon size={badgeGlyphs[size as "md" | "lg"]} weight="fill" />
      </span>
    </span>
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

/** "via Claude for Alex", quietly, in the place that says who did something. Renders nothing without an agent. */
export function ViaText({ name, className }: { name?: string; className?: string }) {
  return name ? <span className={cn("text-ink-faint whitespace-nowrap", className)}>via {name}</span> : null;
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
