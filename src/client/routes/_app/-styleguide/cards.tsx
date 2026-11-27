import dragonPhoto from "@/assets/samples/dragon.svg";
import planterPhoto from "@/assets/samples/planter.svg";
import vasePhoto from "@/assets/samples/vase.svg";
import { Card, PhotoDots } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { ClaudeLine } from "@/components/ui/ClaudeLine";
import * as Icons from "@/components/ui/icons";
import { LinkCard } from "@/components/ui/LinkCard";
import { MiniCard } from "@/components/ui/MiniCard";
import { NameSourceLine } from "@/components/ui/NameSourceLine";
import { PrintTile, printTileGrid } from "@/components/ui/PrintTile";
import { Reflow } from "@/components/ui/Reflow";

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
          photo={{ src: planterPhoto, alt: "A planter on the print bed" }}
          naming={
            <ClaudeLine working className="min-h-6">
              Naming…
            </ClaudeLine>
          }
          meta="Just now"
          person={people[0]}
          aspect="portrait"
        />
        <Card
          note="Hook for the AMS spool holder, the stock one rattles. Check the clearance to the wall first."
          sub="for the kitchen"
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
          photos={[
            { src: vasePhoto, alt: "A gold silk-PLA vase" },
            { src: planterPhoto, alt: "" },
            { src: dragonPhoto, alt: "" },
          ]}
          chips={<UploadBadge state="uploading" progress={0.64} />}
        />
      </div>
      <div className="mt-10">
        <Label>
          Several photos: a card swipes between them (arrows on hover with a mouse), and PhotoDots say which shows. Past
          five the row slides and the edge dots shrink.
        </Label>
        <div className="bg-paper-deep flex flex-wrap items-center gap-4 rounded-lg p-4">
          <PhotoDots count={2} index={0} />
          <PhotoDots count={3} index={1} />
          <PhotoDots count={5} index={4} />
          <PhotoDots count={9} index={0} />
          <PhotoDots count={9} index={4} />
          <PhotoDots count={9} index={8} />
        </div>
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
          One name for each idea (shared/item-name.ts): a title someone typed; else an untitled link idea's page title,
          said on its note face over the site; else the note's first words; else a photo with no words is the quiet
          "Untitled idea" (`standIn`), the same on its page, in search and in the palette
        </Label>
        <div className="grid grid-cols-2 items-start gap-3 md:grid-cols-4 md:gap-5">
          <Card
            note="makerworld.com/en/models/1234567-gridfinity-baseplate"
            linkName="Gridfinity baseplate, 4x4"
            meta="Its page's title"
            aspect="portrait"
          />
          <Card
            note="printables.com/model/734512-ams-roller-spool-holder"
            linkName="Roller spool holder for the AMS, with bearings, quick-swap hubs and a drawer for desiccant"
            meta="A long one wraps"
            aspect="portrait"
          />
          <Card note="Hook for the bike helmet" meta="Its note's first words" aspect="portrait" />
          <Card
            photo={{ src: dragonPhoto, alt: "Photo of an idea" }}
            title="Untitled idea"
            standIn
            meta="A photo, no words"
            aspect="portrait"
          />
        </div>
        <Label>
          On its page the title field stays empty with the name as its placeholder (a step smaller on a phone), one
          quiet line says where it came from (NameSourceLine), and the link card leaves out the title the heading
          already says
        </Label>
        <div className="max-w-content flex flex-col gap-3">
          <p className="font-display text-headline text-ink-faint max-md:text-title font-semibold">
            Gridfinity baseplate, 4x4
          </p>
          <NameSourceLine from="link" className="-mt-2" />
          <LinkCard
            url="https://makerworld.com/en/models/1234567-gridfinity-baseplate"
            model={{
              kind: "page",
              site: "makerworld",
              name: "MakerWorld",
              url: "https://makerworld.com/en/models/1234567-gridfinity-baseplate",
            }}
            titleShownAbove
          />
          <NameSourceLine from="note" />
        </div>
      </div>
      <div className="mt-10">
        <Label>
          Mini cards, for a row that scrolls sideways with snap (Up next, which stays small: decision 0065): the cover
          only, so a drag never fights a photo swipe, the title under it (a word too long for the line is hyphenated),
          room for a menu button in the corner, and a note-only idea's note filling the face
        </Label>
        <ul className="no-scrollbar relative flex snap-x snap-proximity gap-2.5 overflow-x-auto pb-1">
          {/* Mini cards fade in from a Reflow, as in the app: outside one they would stay at their first frame. */}
          <Reflow>
            <MiniCard
              link={{ to: "/styleguide" }}
              photo={{ src: dragonPhoto, alt: "A red articulated dragon on the print bed" }}
              title="Articulated dragon"
            />
            <MiniCard
              link={{ to: "/styleguide" }}
              photo={{ src: vasePhoto, alt: "A gold silk-PLA vase" }}
              title="Spiral vase in silk PLA, maybe 0.6 nozzle"
            />
            <MiniCard
              link={{ to: "/styleguide" }}
              photo={{ src: planterPhoto, alt: "A green planter" }}
              title="Supercalifragilisticexpialidocious planter"
            />
            <MiniCard
              link={{ to: "/styleguide" }}
              note="Replacement knob for the oven, 6 mm D-shaft. Measure the old one before it breaks completely."
            />
            <MiniCard link={{ to: "/styleguide" }} note="ikea.com/se/en/p/skadis-pegboard-white-20320802" />
            <MiniCard link={{ to: "/styleguide" }} photo={{ src: planterPhoto, alt: "A green planter" }} />
          </Reflow>
        </ul>
        <Label>
          Mini cards with news, three across on a phone (`fill`): the title and one quiet line for what happened, as in
          "Since Thursday"
        </Label>
        <ul className="relative grid max-w-sm grid-cols-3 gap-3 md:flex md:max-w-none">
          <Reflow>
            <MiniCard
              fill
              link={{ to: "/styleguide" }}
              photo={{ src: dragonPhoto, alt: "A red articulated dragon on the print bed" }}
              title="Articulated dragon"
              sub="worked"
            />
            <MiniCard
              fill
              link={{ to: "/styleguide" }}
              photo={{ src: vasePhoto, alt: "A gold silk-PLA vase" }}
              title="Spiral vase"
              sub="spaghetti, printing again"
            />
            <MiniCard
              fill
              link={{ to: "/styleguide" }}
              note="Hook for the bike helmet"
              title="Helmet hook"
              sub="captured"
            />
          </Reflow>
        </ul>
      </div>
      <div className="mt-10">
        <Label>
          Print tiles, for finished prints (Done on Builds): the picture with its name and date under it, no card. The
          newest are `lead` tiles (4:3, the first on a phone, two from md, three from xl); the rest are squares, two
          across on a phone, three from md, six from xl. A print with only a note shows it as a card, and when that note
          is the title the caption is just the date; a long name takes two lines and ends in …
        </Label>
        <ul className={printTileGrid}>
          <PrintTile
            lead={0}
            link={{ to: "/styleguide" }}
            photo={{ src: dragonPhoto, alt: "A red articulated dragon on the print bed" }}
            title="Articulated dragon"
            meta="3 h ago"
          />
          <PrintTile
            lead={1}
            link={{ to: "/styleguide" }}
            photo={{ src: vasePhoto, alt: "A gold silk-PLA vase" }}
            title="Spiral vase in silk PLA, maybe 0.6 nozzle, with a very long name"
            meta="Yesterday"
          />
          <PrintTile
            lead={2}
            link={{ to: "/styleguide" }}
            photo={{ src: planterPhoto, alt: "A green planter" }}
            title="Planter"
            meta="Nov 12"
          />
          <PrintTile
            link={{ to: "/styleguide" }}
            photo={{ src: planterPhoto, alt: "A green planter" }}
            title="Drawer bins, 42 mm grid"
            meta="Sep 27"
          />
          <PrintTile link={{ to: "/styleguide" }} note="Hook for the bike helmet" meta="Oct 31" />
        </ul>
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
