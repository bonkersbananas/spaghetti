import { useEffect, useRef } from "react";
import { scrollBehavior } from "@/lib/motion";
import { TagPicker } from "./TagPicker";

/**
 * "What went wrong?" for a print finished from the capture sheet: the attempt sheet's tag picker, in a module of its
 * own so the capture sheet (in every screen's first load) only loads it when a print went wrong.
 */
export default function FailureTags(props: {
  outcome: "failed" | "partial";
  value: string[];
  onChange: (slugs: string[]) => void;
  suggested?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // It opens under the outcome row: bring all of it into view, so "Add your own" isn't left under the Finish bar.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
  }, []);
  return (
    <div ref={ref}>
      <TagPicker
        kind="failure"
        label="What went wrong?"
        hide={props.outcome === "failed" ? ["spaghetti"] : undefined}
        value={props.value}
        onChange={props.onChange}
        suggested={props.suggested}
        visible={5}
        className="mt-2"
      />
    </div>
  );
}
