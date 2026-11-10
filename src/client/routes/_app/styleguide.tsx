import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shell/PageHeader";
import { AppearanceSection } from "./-styleguide/appearance";
import { AvatarSection } from "./-styleguide/avatars";
import { BuildsSection } from "./-styleguide/builds";
import { ButtonSection } from "./-styleguide/buttons";
import { CardSection } from "./-styleguide/cards";
import { ChipSection } from "./-styleguide/chips";
import { ColorSection } from "./-styleguide/color";
import { ControlSection } from "./-styleguide/controls";
import { ElevationSection } from "./-styleguide/elevation";
import { EmptySection } from "./-styleguide/empty";
import { FieldSection } from "./-styleguide/fields";
import { IconSection } from "./-styleguide/icons";
import { JournalSection } from "./-styleguide/journal";
import { MotionSection } from "./-styleguide/motion";
import { NotificationSection } from "./-styleguide/notifications";
import { PaletteSection } from "./-styleguide/palette";
import { PantrySection } from "./-styleguide/pantry";
import { PhotoSection } from "./-styleguide/photos";
import { SearchSection } from "./-styleguide/search";
import { SheetSection } from "./-styleguide/sheets";
import { SkeletonSection } from "./-styleguide/skeletons";
import { SpaceSection } from "./-styleguide/space";
import { TodaySection } from "./-styleguide/today";
import { TypeSection } from "./-styleguide/type";

export const Route = createFileRoute("/_app/styleguide")({
  component: Styleguide,
});

/**
 * Every token and shared component, live. When you add to the design
 * system, add it here too: reviews and later sessions start from this page.
 */
const toc = [
  ["color", "Color"],
  ["appearance", "Dark & offline"],
  ["type", "Type"],
  ["space", "Space & radii"],
  ["elevation", "Elevation"],
  ["motion", "Motion"],
  ["icons", "Icons"],
  ["buttons", "Buttons"],
  ["fields", "Fields"],
  ["controls", "Controls"],
  ["chips", "Chips"],
  ["avatars", "Avatars"],
  ["cards", "Cards"],
  ["photos", "Photos"],
  ["builds", "Builds & attempts"],
  ["pantry", "Pantry & printer"],
  ["search", "Journal & search"],
  ["journal", "Journal entries"],
  ["today", "Today"],
  ["sheets", "Sheets & toasts"],
  ["notifications", "Notifications"],
  ["palette", "Palette & shortcuts"],
  ["empty", "Empty states"],
  ["skeletons", "Skeletons"],
] as const;

function Styleguide() {
  return (
    <>
      <PageHeader title="Styleguide" subtitle="The kitchen's tools: every token and component, live." />
      <div className="flex gap-12">
        <nav aria-label="Styleguide sections" className="sticky top-8 hidden h-fit w-40 shrink-0 flex-col lg:flex">
          {toc.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="focus-ring text-small text-ink-faint hover:text-ink rounded-xs px-2 py-1.5 font-medium"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-16 pb-10">
          <ColorSection />
          <AppearanceSection />
          <TypeSection />
          <SpaceSection />
          <ElevationSection />
          <MotionSection />
          <IconSection />
          <ButtonSection />
          <FieldSection />
          <ControlSection />
          <ChipSection />
          <AvatarSection />
          <CardSection />
          <PhotoSection />
          <BuildsSection />
          <PantrySection />
          <SearchSection />
          <JournalSection />
          <TodaySection />
          <PaletteSection />
          <SheetSection />
          <NotificationSection />
          <EmptySection />
          <SkeletonSection />
        </div>
      </div>
    </>
  );
}
