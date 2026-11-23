import { WhichBuildLine } from "@/components/builds/PrintPlace";
import { AskLine, AskName } from "@/components/ui/AskLine";
import { Button } from "@/components/ui/Button";
import { MoveIntoIcon, PrinterIcon } from "@/components/ui/icons";
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
      note="A print the printer bridge files goes into the build it matches, with one quiet line saying why; when the app isn't sure, the print asks in one line (Is this Herb planter?) on its card and on the build page: Yes moves it, Another build opens the searchable sheet. Every answer can be undone."
    >
      <div className="grid gap-6 md:grid-cols-2">
        <Panel className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Label>The printer's question: the likely build, one tap to say yes</Label>
            <WhichBuildLine
              guesses={[{ id: "a", title: "Herb planter", onPick: nothing }]}
              why="Same file: planter-v2"
              names={["planter-v2"]}
              onMore={nothing}
            />
          </div>
          <div className="flex flex-col gap-3">
            <Label>Two as likely as each other: both named, one tap each</Label>
            <WhichBuildLine
              guesses={[
                { id: "a", title: "Herb planter", onPick: nothing },
                { id: "b", title: "Planters for the balcony", idea: true, onPick: nothing },
              ]}
              why="Both print planter-v2."
              names={["planter-v2"]}
              onMore={nothing}
            />
          </div>
          <div className="flex flex-col gap-3">
            <Label>An idea it would start</Label>
            <WhichBuildLine
              guesses={[{ id: "b", title: "Planters for the balcony", idea: true, onPick: nothing }]}
              why="Downloaded 4 min before it began"
              onMore={nothing}
            />
          </div>
          <div className="flex flex-col gap-3">
            <Label>Nothing fits: the sheet, or keep it as its own in one tap</Label>
            <WhichBuildLine printName="cable-clip-v3" onMore={nothing} onKeep={nothing} />
          </div>
          <div className="flex flex-col gap-3">
            <Label>While the guess loads: its room kept</Label>
            <WhichBuildLine loading onMore={nothing} />
          </div>
          <div className="flex flex-col gap-3">
            <Label>AskLine, the system's piece: any question one tap answers</Label>
            <AskLine
              icon={PrinterIcon}
              detail="Its file is named much like ring.3mf"
              actions={
                <Button variant="secondary" size="sm" onClick={nothing}>
                  Yes
                </Button>
              }
            >
              Is this <AskName>UÖBF glass markers</AskName>?
            </AskLine>
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
