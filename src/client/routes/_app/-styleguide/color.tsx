import { cn } from "@/lib/cn";
import { Label, Section } from "./shared";

const swatchGroups: Array<{ label: string; swatches: Array<[token: string, className: string, note: string]> }> = [
  {
    label: "Surfaces",
    swatches: [
      ["paper", "bg-paper", "The page"],
      ["paper-deep", "bg-paper-deep", "Sidebar, recessed areas"],
      ["cream", "bg-cream", "Cards, the tab bar, fields"],
      ["lifted", "bg-lifted", "Sheets, dialogs, menus"],
      ["well", "bg-well", "Photo placeholders, skeletons"],
    ],
  },
  {
    label: "Ink",
    swatches: [
      ["ink", "bg-ink", "Text, headings"],
      ["ink-soft", "bg-ink-soft", "Body copy, labels"],
      ["ink-faint", "bg-ink-faint", "Meta, hints (AA on paper)"],
      ["ink-ghost", "bg-ink-ghost", "Placeholders, disabled"],
    ],
  },
  {
    label: "Over photos and inverse",
    swatches: [
      ["veil", "bg-veil", "Badges and buttons on photos"],
      ["veil-strong", "bg-veil-strong", "Upload badge, remove buttons"],
      ["select", "bg-select", "A selected chip"],
      ["toast", "bg-toast", "Toasts"],
      ["scrim", "bg-scrim", "Behind sheets"],
      ["hairline", "bg-hairline", "Between rows, rarely"],
    ],
  },
  {
    label: "Accents",
    swatches: [
      ["tomato", "bg-tomato", "The one action color"],
      ["tomato-soft", "bg-tomato-soft", "Danger, failed prints"],
      ["basil", "bg-basil", "Success, done"],
      ["basil-soft", "bg-basil-soft", "Success backgrounds"],
      ["semolina", "bg-semolina", "Highlights, in progress"],
      ["semolina-soft", "bg-semolina-soft", "Highlight backgrounds"],
    ],
  },
  {
    label: "People",
    swatches: [
      ["person-tomato", "bg-person-tomato", ""],
      ["person-basil", "bg-person-basil", ""],
      ["person-semolina", "bg-person-semolina", ""],
      ["person-plum", "bg-person-plum", ""],
      ["person-sea", "bg-person-sea", ""],
      ["person-clay", "bg-person-clay", ""],
    ],
  },
];

export function ColorSection() {
  return (
    <Section
      id="color"
      title="Color"
      note="Warm paper, ink, and accents used with restraint: one tomato action per screen, basil and semolina for state. Use only these tokens."
    >
      <div className="flex flex-col gap-8">
        {swatchGroups.map((group) => (
          <div key={group.label}>
            <Label>{group.label}</Label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {group.swatches.map(([token, className, note]) => (
                <div key={token} className="bg-cream shadow-soft rounded-md p-1.5">
                  <div className={cn("shadow-well h-16 rounded-sm", className)} />
                  <div className="px-1.5 pt-2 pb-1">
                    <p className="text-small text-ink font-semibold">{token}</p>
                    {note && <p className="text-caption text-ink-faint">{note}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
