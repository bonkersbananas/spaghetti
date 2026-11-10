import { EmptyPot, Mark, NoodleSearch, OpenNotebook, PantryJar, SpoolStrand } from "@/components/illustrations";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel, Section } from "./shared";

export function EmptySection() {
  return (
    <Section
      id="empty"
      title="Empty states"
      note="A small pasta joke in the title, plain words in the body, one next step. Illustrations: 160×120, ink outlines, one or two accents."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Panel className="py-10">
          <EmptyState illustration={<EmptyPot />} title="Nothing simmering yet">
            Ideas land here first.
          </EmptyState>
        </Panel>
        <Panel className="flex flex-wrap items-end justify-center gap-6 py-10">
          <SpoolStrand className="w-32" />
          <PantryJar className="w-32" />
          <OpenNotebook className="w-32" />
          <NoodleSearch className="w-32" />
          <Mark className="size-16" />
        </Panel>
      </div>
    </Section>
  );
}
