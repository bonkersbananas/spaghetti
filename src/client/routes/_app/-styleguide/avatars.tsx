import type { Person } from "@shared/api";
import { Avatar, AvatarStack, ViaText } from "@/components/ui/Avatar";
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
      <Panel className="mt-4 flex flex-wrap items-center gap-6">
        {(["xs", "sm", "md", "lg"] as const).map((size) => (
          <Avatar key={size} person={people[0] as Person} size={size} via="Claude for Alex" />
        ))}
        <p className="text-small text-ink-faint">
          Alex <ViaText name="Claude for Alex" />
        </p>
      </Panel>
      <p className="text-small text-ink-faint mt-3 max-w-prose">
        Done through an agent: the owner's avatar with a small agent mark (<code>via</code>), and where there is room,
        “via Claude for Alex” in faint text. Never a badge.
      </p>
    </Section>
  );
}
