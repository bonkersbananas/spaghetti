import type { Person } from "@shared/api";
import { AgentAvatar, Avatar, AvatarStack, ViaText } from "@/components/ui/Avatar";
import { Panel, people, Section } from "./shared";

export function AvatarSection() {
  return (
    <Section id="avatars" title="Avatars" note="Initials on each person's color, beside what they wrote.">
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
      <Panel className="mt-4 flex flex-col gap-5">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          {(["xs", "sm", "md", "lg"] as const).map((size) => (
            <div key={size} className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-3">
                <Avatar person={people[0] as Person} size={size} />
                <Avatar person={people[0] as Person} size={size} via="Claude for Alex" />
              </div>
              <span className="text-caption text-ink-faint">{size}: Alex · via Claude</span>
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
