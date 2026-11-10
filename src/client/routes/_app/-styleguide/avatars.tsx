import type { Person } from "@shared/api";
import { AgentAvatar, Avatar, AvatarStack, ViaText } from "@/components/ui/Avatar";
import { Panel, people, Section } from "./shared";

/** A stand-in portrait: a data URL, so the specimen needs no server. */
const SAMPLE_PHOTO = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#e9c58a"/><circle cx="32" cy="26" r="11" fill="#b4764a"/><path d="M10 64c2-16 12-22 22-22s20 6 22 22z" fill="#5d7f6b"/></svg>', // design-lint-ignore: a sample picture is data
)}`;

export function AvatarSection() {
  return (
    <Section
      id="avatars"
      title="Avatars"
      note="Initials on each person's color, beside what they wrote: first and last word's initial, at every size."
    >
      <Panel className="flex flex-wrap items-center gap-6">
        {(["xs", "sm", "md", "lg"] as const).map((size) => (
          <Avatar key={size} person={people[0] as Person} size={size} />
        ))}
        <AvatarStack people={people} size="md" />
        <div className="flex gap-2">
          {(["tomato", "basil", "semolina", "plum", "sea", "clay"] as const).map((color) => (
            <Avatar key={color} person={{ name: color, color }} size="sm" />
          ))}
        </div>
      </Panel>
      <Panel className="mt-4 flex flex-wrap items-center gap-6">
        {(["xs", "sm", "md", "lg"] as const).map((size) => (
          <Avatar key={size} person={{ ...(people[1] as Person), photoUrl: SAMPLE_PHOTO }} size={size} />
        ))}
        <Avatar person={{ ...(people[1] as Person), photoUrl: "/api/people/none/photo?v=missing" }} size="md" />
        <p className="text-small text-ink-faint">
          A profile picture covers the initials once it has loaded (fading in); the initials stay under it while it
          loads, if it fails (right) and offline.
        </p>
      </Panel>
      <Panel className="mt-4 flex flex-col gap-5">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          {(["xs", "sm", "md", "lg"] as const).map((size) => (
            <div key={size} className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-3">
                <Avatar person={{ name: "Carl Oscar", color: "tomato" }} size={size} />
                <Avatar person={people[0] as Person} size={size} via="Claude for Alex" />
              </div>
              <span className="text-caption text-ink-faint">{size}: Carl Oscar, then Alex via Claude</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {(["tomato", "basil", "semolina", "plum", "sea", "clay"] as const).map((color) => (
            <Avatar key={color} person={{ name: color, color }} size="sm" via="Claude" />
          ))}
          <p className="text-small text-ink-faint">
            Alex <ViaText name="Claude for Alex" />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <AgentAvatar name="Claude for Alex" owner={people[0] as Person} size="lg" />
          <AgentAvatar name="Printer bridge" owner={people[0] as Person} size="md" />
          <AgentAvatar name="Home assistant" owner={people[1] as Person} size="sm" />
          <p className="text-small text-ink-faint">
            An agent itself: a rounded square in its owner's color, its own letter.
          </p>
        </div>
      </Panel>
      <p className="text-small text-ink-faint mt-3 max-w-prose">
        Done through an agent: small, the owner's color with an agent glyph instead of the letter; larger, the initials
        with a badge cut out of the circle's corner (<code>via</code>). Where there is room, add “via Claude for Alex”
        in faint text. Never a loud badge.
      </p>
    </Section>
  );
}
