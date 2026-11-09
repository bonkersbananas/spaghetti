import type { Person } from "@shared/api";
import type { PersonColor } from "@shared/people";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/initials";

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
  className?: string;
}

/** A person's initials on their color. Shown beside what they wrote. */
export function Avatar({ person, size = "md", ringed = false, className }: AvatarProps) {
  return (
    <span
      role="img"
      aria-label={person.name}
      title={person.name}
      className={cn(
        "text-on-accent inline-flex shrink-0 items-center justify-center rounded-full font-bold tracking-wide select-none",
        colors[person.color],
        sizes[size],
        ringed && "ring-paper ring-2",
        className,
      )}
    >
      {size === "xs" ? initials(person.name).slice(0, 1) : initials(person.name)}
    </span>
  );
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
