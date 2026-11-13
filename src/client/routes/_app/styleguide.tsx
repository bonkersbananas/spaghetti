import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shell/PageHeader";
import { AppearanceSection } from "./-styleguide/appearance";
import { AvatarSection } from "./-styleguide/avatars";
import { BuildsSection } from "./-styleguide/builds";
import { ButtonSection } from "./-styleguide/buttons";
import { CardSection } from "./-styleguide/cards";
import { ChecklistSection } from "./-styleguide/checklist";
import { ChipSection } from "./-styleguide/chips";
import { ColorSection } from "./-styleguide/color";
import { CommandBlockSection } from "./-styleguide/command-block";
import { ControlSection } from "./-styleguide/controls";
import { ConversationSection } from "./-styleguide/conversation";
import { ElevationSection } from "./-styleguide/elevation";
import { EmptySection } from "./-styleguide/empty";
import { ErrorSection } from "./-styleguide/error";
import { FieldSection } from "./-styleguide/fields";
import { HubTileSection } from "./-styleguide/hub-tile";
import { IconSection } from "./-styleguide/icons";
import { JournalSection } from "./-styleguide/journal";
import { LayerSliderSection } from "./-styleguide/layer-slider";
import { LiveStatusSection } from "./-styleguide/live-status";
import { ModelMarkSection } from "./-styleguide/model-mark";
import { MotionSection } from "./-styleguide/motion";
import { NotificationSection } from "./-styleguide/notifications";
import { PaletteSection } from "./-styleguide/palette";
import { PantrySection } from "./-styleguide/pantry";
import { PhotoSection } from "./-styleguide/photos";
import { RecipesSection } from "./-styleguide/recipes";
import { ScoutSectionGuide } from "./-styleguide/scout";
import { SearchSection } from "./-styleguide/search";
import { SheetSection } from "./-styleguide/sheets";
import { SigningInSection } from "./-styleguide/signing-in";
import { SkeletonSection } from "./-styleguide/skeletons";
import { SlicingSection } from "./-styleguide/slicing";
import { SpaceSection } from "./-styleguide/space";
import { StepsSection } from "./-styleguide/steps";
import { TodaySection } from "./-styleguide/today";
import { TwistsSection } from "./-styleguide/twists";
import { TypeSection } from "./-styleguide/type";
import { WebhooksSection } from "./-styleguide/webhooks";
import { WishlistsSection } from "./-styleguide/wishlists";
import { YearSection } from "./-styleguide/year";

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
  ["checklist", "Checklist"],
  ["avatars", "Avatars"],
  ["conversation", "Conversation"],
  ["cards", "Cards"],
  ["photos", "Photos"],
  ["builds", "Builds & attempts"],
  ["pantry", "Pantry & printer"],
  ["slicing", "Slicing"],
  ["recipes", "Recipes"],
  ["twists", "Twists"],
  ["year", "Year so far"],
  ["search", "Journal & search"],
  ["journal", "Journal entries"],
  ["today", "Today"],
  ["wishlists", "Wishlists"],
  ["model-mark", "Ideas with a model"],
  ["scout", "Idea scout"],
  ["sheets", "Sheets & toasts"],
  ["notifications", "Notifications"],
  ["webhooks", "Webhooks"],
  ["palette", "Palette & shortcuts"],
  ["empty", "Empty states"],
  ["error", "Error screen"],
  ["skeletons", "Skeletons"],
  ["signing-in", "Signing in"],
  ["layer-slider", "Layer slider"],
  ["command-block", "Command block"],
  ["steps", "Steps"],
  ["live-status", "Live status"],
  ["hub-tile", "Hub tile"],
] as const;

function Styleguide() {
  return (
    <>
      <PageHeader title="Styleguide" subtitle="Every token and component, live." />
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
          <ChecklistSection />
          <AvatarSection />
          <ConversationSection />
          <CardSection />
          <PhotoSection />
          <BuildsSection />
          <PantrySection />
          <SlicingSection />
          <RecipesSection />
          <TwistsSection />
          <YearSection />
          <SearchSection />
          <JournalSection />
          <TodaySection />
          <WishlistsSection />
          <ModelMarkSection />
          <ScoutSectionGuide />
          <PaletteSection />
          <SheetSection />
          <NotificationSection />
          <WebhooksSection />
          <EmptySection />
          <ErrorSection />
          <SkeletonSection />
          <HubTileSection />
          <LayerSliderSection />
          <LiveStatusSection />
          <StepsSection />
          <CommandBlockSection />
          <SigningInSection />
        </div>
      </div>
    </>
  );
}
