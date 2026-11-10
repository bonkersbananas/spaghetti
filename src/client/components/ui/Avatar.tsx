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
  xs: "size-5 text-caption",
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

const markSizes = { xs: "size-3", sm: "size-3.5", md: "size-5", lg: "size-6" } as const;
const markIcons = { xs: 8, sm: 9, md: 12, lg: 14 } as const;

/** A person's initials on their color. Shown beside what they wrote. With `via`, it was done through their agent. */
export function Avatar({ person, size = "md", ringed = false, decorative = false, via, className }: AvatarProps) {
  const label = via ? `${person.name}, via ${via}` : person.name;
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
      {size === "xs" ? initials(person.name).slice(0, 1) : initials(person.name)}
    </span>
  );
  if (!via) return face;
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {face}
      <span
        aria-hidden
        className={cn(
          "bg-paper text-ink-soft shadow-soft absolute -right-1 -bottom-1 inline-flex items-center justify-center rounded-full",
          markSizes[size],
        )}
      >
        <AgentIcon size={markIcons[size]} weight="fill" />
      </span>
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
