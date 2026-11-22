import { WhichBuildQuestion } from "@/components/builds/PrintPlace";
import { BuildsIcon, IdeasIcon, MoveIntoIcon, PrinterIcon } from "@/components/ui/icons";
import { KeepNames, KeptName } from "@/components/ui/KeepNames";
import { WhyLine } from "@/components/ui/WhyLine";
import { Label, Panel, Section } from "./shared";

const nothing = () => undefined;

/** Which build a print belongs to (decision 0076): the printer's question, and the line that says why. */
export function PrintsSection() {
  return (
    <Section
      id="prints"
      title="Which build is this?"
      note="A print the printer bridge files goes into the build it matches, with one quiet line saying why; when the app isn't sure, the print asks, with its best guesses as rows a tap takes. Every answer can be undone."
    >
      <div className="grid gap-6 md:grid-cols-2">
        <Panel className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Label>The printer's question: what the guesses share, said once</Label>
            <WhichBuildQuestion
              shared="Both print planter-v2."
              names={["planter-v2"]}
              offers={[
                {
                  id: "a",
                  photo: null,
                  glyph: BuildsIcon,
                  title: "Herb planter",
                  line: "Started 2 days ago · 1 attempt",
                  onSelect: nothing,
                },
                {
                  id: "b",
                  photo: null,
                  glyph: IdeasIcon,
                  title: "Planters for the balcony",
                  line: "Saved 5 days ago",
                  idea: true,
                  onSelect: nothing,
                },
              ]}
              onMore={nothing}
              onKeep={nothing}
            />
          </div>
          <div className="flex flex-col gap-3">
            <Label>Different reasons: each row its own</Label>
            <WhichBuildQuestion
              name="paddle-steamer(2)"
              names={["paddle-steamer"]}
              offers={[
                {
                  id: "c",
                  photo: null,
                  glyph: BuildsIcon,
                  title: "Paddle steamer",
                  line: "Attempt 2 printed paddle-steamer",
                  onSelect: nothing,
                },
                {
                  id: "d",
                  photo: null,
                  glyph: IdeasIcon,
                  title: "Bath toys",
                  line: "Downloaded 4 min before it began",
                  idea: true,
                  onSelect: nothing,
                },
              ]}
              onMore={nothing}
              onKeep={nothing}
            />
          </div>
          <div className="flex flex-col gap-3">
            <Label>While the guesses load</Label>
            <WhichBuildQuestion loading offers={[]} onMore={nothing} onKeep={nothing} />
          </div>
        </Panel>
        <Panel className="flex flex-col gap-3">
          <Label>Why line: why it is here, and one way to change it</Label>
          <WhyLine icon={PrinterIcon} action={{ label: "Not this build?", onClick: nothing }}>
            <KeepNames
              text="Filed here: it printed UOBF-fit-test-ring, this build's file, opened in Bambu Studio just before it began."
              names={["UOBF-fit-test-ring"]}
            />
          </WhyLine>
          <WhyLine icon={PrinterIcon} action={{ label: "Move it", onClick: nothing }}>
            Nothing matched <KeptName>cable-clip-v3</KeptName>, so it has its own build.
          </WhyLine>
          <WhyLine icon={MoveIntoIcon}>
            Moved here from <KeptName>UOBF-fit-test-ring(2)</KeptName> by you, 2 min ago
          </WhyLine>
        </Panel>
      </div>
    </Section>
  );
}
