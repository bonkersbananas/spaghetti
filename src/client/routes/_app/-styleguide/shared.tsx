import type { Person } from "@shared/api";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const people: Person[] = [
  { id: "a", username: "alex", name: "Alex Rivera", color: "tomato" },
  { id: "b", username: "sam", name: "Sam", color: "sea" },
];

export const SAMPLE_COLOR = "#f2c230"; // design-lint-ignore: a filament color is data

export function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-8">
      <h2 className="text-headline text-ink">{title}</h2>
      {note && <p className="max-w-content text-body text-ink-soft mt-1">{note}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <p className="text-caption text-ink-faint mb-3 font-semibold tracking-wider uppercase">{children}</p>;
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("bg-cream shadow-soft rounded-lg p-5 md:p-6", className)}>{children}</div>;
}
