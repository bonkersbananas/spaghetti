import { createFileRoute } from "@tanstack/react-router";
import { EmptyPot } from "@/components/illustrations";
import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export const Route = createFileRoute("/_app/shopping")({
  component: Shopping,
});

function Shopping() {
  // Fetch with useQuery (queries in lib/), show Skeletons while pending, and the EmptyState when there is nothing.
  return (
    <>
      <PageHeader title="Shopping" subtitle="One line on what this page is for." />
      <EmptyState illustration={<EmptyPot />} title="Nothing here yet">
        Say plainly what goes here and how it gets here.
      </EmptyState>
    </>
  );
}
