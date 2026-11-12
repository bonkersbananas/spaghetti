import dragonPhoto from "@/assets/samples/dragon.svg";
import planterPhoto from "@/assets/samples/planter.svg";
import vasePhoto from "@/assets/samples/vase.svg";
import { Card, PhotoCountBadge } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import * as Icons from "@/components/ui/icons";
import { LinkCard } from "@/components/ui/LinkCard";
import { toast } from "@/components/ui/Toast";
import { UploadBadge } from "@/components/ui/UploadBadge";
import { Label, people, Section } from "./shared";

export function CardSection() {
  return (
    <Section
      id="cards"
      title="Cards"
      note="Photo first: the print is the content, the text supports it. Titles are optional; the note stands in."
    >
      <div className="grid grid-cols-2 items-start gap-3 md:grid-cols-3 md:gap-5 xl:grid-cols-4">
        <Card
          photo={{ src: dragonPhoto, alt: "A red articulated dragon on the print bed" }}
          title="Articulated dragon"
          meta="4 attempts · 2 days ago"
          person={people[0]}
          chips={
            <Chip tone="basil" icon={Icons.CheckIcon} className="bg-basil-soft/95">
              Worked
            </Chip>
          }
          onClick={() => toast.message("Cards open their detail in a later phase")}
        />
        <Card
          note="Hook for the AMS spool holder, the stock one rattles. Check the clearance to the wall first."
          meta="Yesterday"
          person={people[1]}
          aspect="portrait"
        />
        <Card
          photo={{ src: planterPhoto, alt: "A green planter with a small plant" }}
          title="Planter with drainage"
          meta="Printing · attempt 2"
          person={people[1]}
          chips={
            <Chip tone="semolina" icon={Icons.ClockIcon} className="bg-semolina-soft/95">
              Printing
            </Chip>
          }
        />
        <Card
          photo={{ src: vasePhoto, alt: "A gold silk-PLA vase" }}
          note="Spiral vase in silk PLA, maybe 0.6 nozzle"
          meta="Just now"
          person={people[0]}
          aspect="portrait"
          badge={<PhotoCountBadge count={3} />}
          chips={<UploadBadge state="uploading" progress={0.64} />}
        />
      </div>
      <div className="mt-10">
        <Label>Note cards: the shorter the note, the larger it is set (NoteFace, by length)</Label>
        <div className="grid grid-cols-2 items-start gap-3 md:grid-cols-4 md:gap-5">
          <Card note="Hook for the bike helmet" meta="xl · up to 32 letters" aspect="portrait" />
          <Card
            note="Bag clips for the coffee, with a little spoon holder on the side."
            meta="lg · up to 72"
            aspect="portrait"
          />
          <Card
            note="Replacement knob for the oven, 6 mm D-shaft. Measure the old one before it breaks completely."
            meta="md · up to 130"
            aspect="portrait"
          />
          <Card
            note={
              "Drawer bins on a 42 mm grid for the screws, the spare nozzles and the hex keys. Two heights, so the tall drivers stand up.\n\nLabels in a second color, swapped at the layer they start on."
            }
            meta="sm · longer, fades at the end"
            aspect="portrait"
          />
        </div>
      </div>
      <div className="mt-10">
        <Label>
          Link cards, under a note: the page's title and site once known, the address until then (and for good when
          there is none)
        </Label>
        <div className="max-w-content grid grid-cols-1 gap-2">
          <LinkCard url="https://makerworld.com/en/models/drawer-bins" />
          <LinkCard url="https://www.example.com/a/model/without-a-title-yet" />
        </div>
      </div>
    </Section>
  );
}
