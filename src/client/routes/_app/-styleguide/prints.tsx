import { WhichBuildQuestion } from "@/components/builds/PrintPlace";
import { BuildsIcon, IdeasIcon, MoveIntoIcon, PrinterIcon } from "@/components/ui/icons";
import { KeepNames } from "@/components/ui/KeepNames";
import { SuggestionRow } from "@/components/ui/SuggestionRow";
import { WhyLine } from "@/components/ui/WhyLine";
import { Label, Panel, Section } from "./shared";

const nothing = () => undefined;

/** Which build a print belongs to (decision 0076): the printer's question, the line that says why, and offers. */
export function PrintsSection() {
  return (
    <Section
      id="prints"
      title="Which build is this?"
      note="A print the printer bridge files goes into the build it matches, with one quiet line saying why; when the app isn't sure, the print asks, with its best guesses as offers a tap takes. Every answer can be undone."
    >
      <div className="grid gap-6 md:grid-cols-2">
        <Panel className="flex flex-col gap-3">
          <Label>The printer's question, on a print's card</Label>
          <WhichBuildQuestion
            name="paddle-steamer(2)"
            offers={[
              {
                id: "a",
                photo: null,
                glyph: BuildsIcon,
                title: "Paddle steamer",
                why: "Same file as attempt 2 (paddle-steamer.gcode.3mf).",
                onSelect: nothing,
              },
              {
                id: "b",
                photo: null,
                glyph: IdeasIcon,
                title: "Bath toys",
                why: "Downloaded 4 min before it began: paddle-steamer.gcode.3mf.",
                onSelect: nothing,
              },
            ]}
            onMore={nothing}
            onKeep={nothing}
          />
        </Panel>
        <Panel className="flex flex-col gap-5">
          <div>
            <Label>Why line: why it is here, and one way to change it</Label>
            <div className="flex flex-col gap-3">
              <WhyLine icon={PrinterIcon} action={{ label: "Not this build?", onClick: nothing }}>
                From the printer:{" "}
                <KeepNames text="same file as UOBF-fit-test-ring.3mf, opened in Bambu Studio just before it began." />
              </WhyLine>
              <WhyLine icon={PrinterIcon} action={{ label: "Put it in a build", onClick: nothing }}>
                From the printer: a build of its own, as nothing else fits <q>cable-clip-v3</q>.
              </WhyLine>
              <WhyLine icon={MoveIntoIcon}>
                Moved here from <span className="text-ink-soft font-medium">UOBF-fit-test-ring(2)</span> by you, 2 min
                ago
              </WhyLine>
            </div>
          </div>
          <div>
            <Label>Suggestion row: a guess a tap takes (file names stay whole)</Label>
            <SuggestionRow
              glyph={BuildsIcon}
              title="UÖBF glass markers"
              why="Same file as UOBF-fit-test-ring.3mf."
              onSelect={nothing}
            />
          </div>
        </Panel>
      </div>
    </Section>
  );
}
