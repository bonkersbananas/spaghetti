import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { Fusilli } from "@/components/illustrations/Fusilli";
import { PageHeader } from "@/components/shell/PageHeader";
import { TwistCard } from "@/components/twists/TwistCard";
import { ActionBar } from "@/components/ui/ActionBar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PlusIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/Skeleton";
import { useListPicker } from "@/lib/list-picker";
import { useReadOnly } from "@/lib/read-only";
import { useTwists } from "@/lib/twists";
import { useIsDesktop } from "@/lib/use-media-query";

const NewTwistSheet = lazy(() =>
  import("@/components/twists/NewTwistSheet").then((m) => ({ default: m.NewTwistSheet })),
);

export const Route = createFileRoute("/_app/twists/")({
  component: Twists,
});

const grid = "grid grid-cols-1 gap-3 sm:grid-cols-2 md:gap-5 xl:grid-cols-3";

function Twists() {
  useListPicker();
  const { twists, isPending } = useTwists();
  const readOnly = useReadOnly();
  const isDesktop = useIsDesktop();
  const [adding, setAdding] = useState(false);
  const [asked, setAsked] = useState(false);
  const add = () => {
    setAsked(true);
    setAdding(true);
  };
  const empty = !isPending && !twists?.length;
  return (
    <>
      <PageHeader
        title="Twists"
        subtitle="Other people's models, the way we print them."
        actions={
          <Button variant="secondary" icon={PlusIcon} disabled={readOnly} onClick={add}>
            New twist
          </Button>
        }
      />
      {isPending ? (
        <div className={grid} aria-hidden>
          {[0, 1, 2].map((n) => (
            <Skeleton key={n} className="aspect-4/3 rounded-lg" />
          ))}
        </div>
      ) : empty ? (
        <EmptyState
          className="py-10 md:py-20"
          illustration={<Fusilli />}
          title="Nothing twisted yet"
          action={
            <Button variant={isDesktop ? "secondary" : "primary"} icon={PlusIcon} disabled={readOnly} onClick={add}>
              Make a twist
            </Button>
          }
        >
          When you print someone else's model with changes (scaled to fit, a looser fit, a name added), keep it here.
          Open an idea with a model and tap "Make a twist".
        </EmptyState>
      ) : (
        <ul data-picks className={grid} aria-label="Twists">
          {twists?.map((twist) => (
            <li key={twist.id} className="flex">
              <TwistCard twist={twist} className="flex-1" />
            </li>
          ))}
        </ul>
      )}
      {!empty && !isPending && !isDesktop && (
        <ActionBar>
          <Button
            size="lg"
            variant="secondary"
            icon={PlusIcon}
            className="min-w-0 flex-1"
            disabled={readOnly}
            onClick={add}
          >
            New twist
          </Button>
        </ActionBar>
      )}
      {asked && (
        <Suspense fallback={null}>
          <NewTwistSheet open={adding} onOpenChange={setAdding} />
        </Suspense>
      )}
    </>
  );
}
