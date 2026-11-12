import { ScoutCard } from "@/components/ui/ScoutCard";
import { photoSrc } from "@/lib/previews";
import { useSamplePictures } from "./journal";
import { Label, Section } from "./shared";

const noop = () => {};

/** The idea scout's card in each of its states, and the row it sits in. */
export function ScoutSectionGuide() {
  const ready = useSamplePictures();
  const tugboat = ready ? photoSrc("sample-tugboat-photo", "large") : undefined;
  const dragon = ready ? photoSrc("sample-dragon-photo", "large") : undefined;
  return (
    <Section
      id="scout"
      title="Idea scout"
      note="ScoutCard: a model the scout found. The picture first and large with the site over it, the title (it opens the model's page), one sentence on why it fits, and two answers: Keep makes an idea, Not for us puts it away for good. Both come back with Undo, here on the week page and in the toast. On phones the cards sit in a swipeable row with the next one peeking; from md in three columns."
    >
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <Label>Suggested</Label>
          <div className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            <ScoutCard
              title="Drawer divider set"
              url="https://makerworld.com/en/models/1100001"
              siteName="MakerWorld"
              picture={tugboat}
              why="For the kitchen drawer you saved."
              onKeep={noop}
              onDismiss={noop}
            />
            <ScoutCard
              title="Planter with a saucer and a much longer name that has to wrap onto two lines"
              url="https://www.thingiverse.com/thing:6100002"
              siteName="Thingiverse"
              picture={dragon}
              why="Uses the PETG you have on the shelf."
              onKeep={noop}
              onDismiss={noop}
            />
            <ScoutCard
              title="Cable chain clips"
              url="https://makerworld.com/en/models/1100003"
              siteName="MakerWorld"
              why="A neat second try at the cable comb."
              onKeep={noop}
              onDismiss={noop}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label>Kept and put away</Label>
          <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
            <ScoutCard
              title="Drawer divider set"
              url="https://makerworld.com/en/models/1100001"
              siteName="MakerWorld"
              picture={tugboat}
              why="For the kitchen drawer you saved."
              state="kept"
              onUndo={noop}
            />
            <ScoutCard
              title="Planter with a saucer"
              url="https://www.thingiverse.com/thing:6100002"
              siteName="Thingiverse"
              picture={dragon}
              why="Uses the PETG you have on the shelf."
              state="dismissed"
              onUndo={noop}
            />
          </div>
        </div>
      </div>
    </Section>
  );
}
