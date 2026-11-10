import { MonthBars } from "@/components/insights/MonthBars";
import { RateRows } from "@/components/insights/RateRows";
import { Panel, Section } from "./shared";

const months = [
  [0, 1, 0],
  [3, 0, 1],
  [6, 1, 2],
  [9, 2, 1],
  [12, 1, 3],
  [8, 0, 2],
  [4, 1, 0],
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
].map(([success = 0, partial = 0, failed = 0], month) => ({ month, success, partial, failed }));

export function YearSection() {
  return (
    <Section
      id="year"
      title="Year so far"
      note="The year in a few large figures and sentences. Two quiet components draw it: MonthBars (prints by month, stacked in the outcome colors, the busiest month named, no legend or axis) and RateRows (success rate per group as a basil bar with its figure in words). Both are labelled in words for screen readers and nothing on them is interactive; links around them lead into the journal."
    >
      <div className="grid min-w-0 gap-6 md:grid-cols-2">
        <Panel className="flex min-w-0 flex-col gap-3">
          <MonthBars months={months} through={6} />
        </Panel>
        <Panel className="flex min-w-0 flex-col gap-3">
          <RateRows
            rows={[
              { label: "PLA", total: 31, worked: 26, percent: 84 },
              { label: "PETG", total: 12, worked: 7, percent: 58 },
              { label: "TPU", total: 2, worked: 1, percent: 50 },
            ]}
          />
        </Panel>
      </div>
    </Section>
  );
}
