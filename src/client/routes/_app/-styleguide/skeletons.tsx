import { CardSkeleton, RowSkeleton } from "@/components/ui/Skeleton";
import { Panel, Section } from "./shared";

export function SkeletonSection() {
  return (
    <Section
      id="skeletons"
      title="Skeletons"
      note="Loading looks like the layout it will become. No full-page spinners."
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-5">
        <CardSkeleton />
        <CardSkeleton />
        <Panel className="col-span-2 py-2">
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </Panel>
      </div>
    </Section>
  );
}
