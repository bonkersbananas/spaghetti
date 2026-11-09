import { createFileRoute } from "@tanstack/react-router";
import { SpoolStrand } from "@/components/illustrations";
import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export const Route = createFileRoute("/_app/builds")({
  component: Builds,
});

function Builds() {
  return (
    <>
      <PageHeader title="Builds" subtitle="From idea to finished print, attempt by attempt." />
      <EmptyState className="py-10 md:py-20" illustration={<SpoolStrand />} title="Nothing on the bed">
        When an idea is ready to print, it becomes a build. Every attempt, setting and photo gets tracked here.
      </EmptyState>
    </>
  );
}
