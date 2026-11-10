import * as Icons from "@/components/ui/icons";
import { Section } from "./shared";

export function IconSection() {
  const entries = Object.entries(Icons).filter(([name]) => name.endsWith("Icon")) as Array<[string, Icons.Icon]>;
  return (
    <Section
      id="icons"
      title="Icons"
      note={
        <>
          Phosphor, regular weight at 20 px; fill for active navigation. Import from{" "}
          <code className="bg-ink/6 text-small rounded-xs px-1">components/ui/icons</code> only.
        </>
      }
    >
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
        {entries.map(([name, Icon]) => (
          <div key={name} className="bg-cream shadow-soft flex flex-col items-center gap-2 rounded-md px-2 py-4">
            <Icon size={24} className="text-ink" />
            <span className="text-caption text-ink-faint w-full truncate text-center">{name.replace(/Icon$/, "")}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}
