import { createFileRoute } from "@tanstack/react-router";
import { OpenNotebook } from "@/components/illustrations";
import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export const Route = createFileRoute("/_app/journal")({
  component: Journal,
});

function Journal() {
  return (
    <>
      <PageHeader title="Journal" subtitle="What worked, what failed, and what we learned." />
      <EmptyState className="py-10 md:py-20" illustration={<OpenNotebook />} title="A clean notebook">
        Every print lands here, the perfect ones and the spaghetti. Failures are worth writing down too.
      </EmptyState>
    </>
  );
}
