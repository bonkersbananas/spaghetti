import { modelMarkOf } from "@shared/model-mark";
import dragonPhoto from "@/assets/samples/dragon.svg";
import platePhoto from "@/assets/samples/plate.svg";
import vasePhoto from "@/assets/samples/vase.svg";
import { Card } from "@/components/ui/Card";
import { LinkCard } from "@/components/ui/LinkCard";
import { ModelMark } from "@/components/ui/ModelMark";
import { Label, Section } from "./shared";

const at = (url: string) => {
  const mark = modelMarkOf(url);
  if (!mark) throw new Error(url);
  return mark;
};
const MAKERWORLD = at("https://makerworld.com/en/models/487213-drawer-bins");
const PRINTABLES = at("https://www.printables.com/model/512340-bath-tugboat");
const FILE = at("https://files.example.org/bearing-cube.stl");

/** The mark that says an idea has a model, and the model's card on the idea page. */
export function ModelMarkSection() {
  return (
    <Section
      id="model-mark"
      title="Ideas with a model"
      note="ModelMark goes over the photo's bottom right corner (Card's mark slot): dark glass, cream text, basil only as the accent, so the photo is the same photo at night. It means a model page on a known site, or a link straight to a model file. A round sticker, tilted like a label on a recipe card."
    >
      <div className="flex flex-col gap-10">
        <div>
          <Label>
            The mark on a pale photo, a busy one, a note card and a file link; an idea without a model has none
          </Label>
          <div className="grid grid-cols-2 items-start gap-3 md:grid-cols-4 md:gap-5">
            <Card
              photo={{ src: platePhoto, alt: "A build plate" }}
              title="Drawer bins"
              meta="Just now"
              aspect="portrait"
              mark={<ModelMark mark={MAKERWORLD} />}
            />
            <Card
              photo={{ src: dragonPhoto, alt: "A red articulated dragon" }}
              title="Bath tugboat"
              meta="Yesterday"
              aspect="portrait"
              mark={<ModelMark mark={PRINTABLES} />}
            />
            <Card
              note="Calibration cube, but useful"
              meta="2 days ago"
              aspect="portrait"
              mark={<ModelMark mark={FILE} />}
            />
            <Card
              photo={{ src: vasePhoto, alt: "A gold silk-PLA vase" }}
              title="Spiral vase"
              meta="Needs designing"
              aspect="portrait"
            />
          </div>
        </div>
        <div>
          <Label>The model on an idea's page: a LinkCard with the draft's picture, and with the site's letter</Label>
          <div className="max-w-content grid grid-cols-1 gap-3">
            <LinkCard url={MAKERWORLD.url} model={MAKERWORLD} picture={{ src: dragonPhoto }} />
            <LinkCard url={MAKERWORLD.url} model={MAKERWORLD} />
            <LinkCard url={FILE.url} model={FILE} />
          </div>
        </div>
      </div>
    </Section>
  );
}
