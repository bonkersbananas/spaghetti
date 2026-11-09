import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { NoodleSearch } from "@/components/illustrations";
import { PageHeader } from "@/components/shell/PageHeader";
import { ToggleChip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { TextField } from "@/components/ui/Field";
import { SearchIcon } from "@/components/ui/icons";
import { useIsDesktop } from "@/lib/use-media-query";

export const Route = createFileRoute("/_app/search")({
  component: Search,
});

const suggestions = ["PETG", "Supports", "Stringing", "Warping", "Silk PLA"];

function Search() {
  const isDesktop = useIsDesktop();
  const [query, setQuery] = useState("");
  return (
    <>
      <PageHeader title="Search" subtitle="Find what worked last time." />
      <div className="max-w-content flex flex-col gap-4">
        <TextField
          type="search"
          icon={SearchIcon}
          aria-label="Search"
          placeholder="Ideas, builds, notes, settings…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus={isDesktop}
        />
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <ToggleChip key={s} selected={query === s} onClick={() => setQuery(query === s ? "" : s)}>
              {s}
            </ToggleChip>
          ))}
        </div>
      </div>
      <EmptyState className="py-12 md:py-20" illustration={<NoodleSearch />} title="Nothing to untangle yet">
        Once there are ideas and prints, one search finds them all: titles, notes, filaments and settings.
      </EmptyState>
    </>
  );
}
