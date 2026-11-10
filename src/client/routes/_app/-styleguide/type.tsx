import { Overline } from "@/components/ui/Overline";
import { Section as PageSection } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { cn } from "@/lib/cn";
import { Label, Panel, Section } from "./shared";

const typeScale: Array<[token: string, className: string, sample: string]> = [
  ["display", "font-display text-display", "Spaghetti"],
  ["headline", "font-display text-headline", "Nothing simmering yet"],
  ["title", "font-display text-title font-semibold", "Articulated dragon, attempt 4"],
  ["lead", "text-lead", "Stringing on the wings again; lowered the nozzle 5 °C."],
  ["body", "text-body", "PLA Basic at 0.2 mm, 15% gyroid, AMS slot 3. Came off the plate clean."],
  ["small", "text-small text-ink-soft", "2 attempts · 3 days ago"],
  ["caption", "text-caption font-semibold tracking-wider text-ink-faint uppercase", "Filament"],
];

export function TypeSection() {
  return (
    <Section
      id="type"
      title="Type"
      note={
        <>
          Fraunces (soft, display) for headings, Figtree for everything you read and tap. Sizes step up on desktop and
          stay generous on phones: body is 16 px there.
        </>
      }
    >
      <Panel className="flex flex-col gap-5">
        {typeScale.map(([token, className, sample]) => (
          <div key={token} className="flex flex-col gap-1 md:flex-row md:items-baseline md:gap-6">
            <span className="text-caption text-ink-faint w-24 shrink-0 font-semibold">text-{token}</span>
            <span className={cn("text-ink", className)}>{sample}</span>
          </div>
        ))}
        <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:gap-6">
          <span className="text-caption text-ink-faint w-24 shrink-0 font-semibold">tabular</span>
          <span className="tabular text-body text-ink">0.20 mm · 220 °C · 1,234 g · 03:41:07</span>
        </div>
        <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:gap-6">
          <span className="text-caption text-ink-faint w-24 shrink-0 font-semibold">Overline</span>
          <Overline count={3}>Attempts</Overline>
        </div>
        <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:gap-6">
          <span className="text-caption text-ink-faint w-24 shrink-0 font-semibold">SectionHeading</span>
          <div className="flex flex-col gap-2">
            <SectionHeading count={3}>Attempts</SectionHeading>
            <SectionHeading size="title" count={8}>
              PLA
            </SectionHeading>
          </div>
        </div>
      </Panel>
      <Label>Section: the heading, its count and aside, and one distance to what it holds</Label>
      <Panel className="flex flex-col gap-10">
        <PageSection
          id="specimen-headline"
          title="A page section"
          count={3}
          aside={<span className="text-small text-ink-faint">52 h of printing so far</span>}
        >
          <div className="bg-paper h-16 rounded-lg" />
        </PageSection>
        <PageSection id="specimen-title" title="A quieter group" size="title" count={7}>
          <div className="bg-paper h-16 rounded-lg" />
        </PageSection>
        <PageSection id="specimen-overline" title="A block on Today" size="overline">
          <div className="bg-paper h-16 rounded-lg" />
        </PageSection>
      </Panel>
    </Section>
  );
}
