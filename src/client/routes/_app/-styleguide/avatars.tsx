import type { Person } from "@shared/api";
import { Avatar, AvatarStack } from "@/components/ui/Avatar";
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
    </Section>
  );
}
