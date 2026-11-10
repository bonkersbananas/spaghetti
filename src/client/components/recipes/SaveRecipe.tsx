import { RECIPE_NAME_MAX, RECIPE_NOTE_MAX, settingsMaterial, suggestedRecipeName } from "@shared/recipes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextArea, TextField } from "@/components/ui/Field";
import { RecipeIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { spoolsQuery } from "@/lib/pantry";
import { sessionQuery } from "@/lib/queries";
import { type RecipeSourceAttempt, saveRecipe } from "@/lib/recipes";

/** The name to offer: the finish of the spool it was printed on and the material, "Silk PLA". */
function useSuggestedName(source: RecipeSourceAttempt) {
  const { data: spools } = useQuery(spoolsQuery);
  const spoolId = source.settings.filaments?.find((filament) => filament.spoolId)?.spoolId;
  const finish = spools?.find((spool) => spool.id === spoolId)?.finish ?? null;
  return suggestedRecipeName(settingsMaterial(source.settings), finish);
}

/**
 * Name it, add a line if you like, save. The name is already filled in (selected, so typing replaces it), which
 * makes saving one tap on a phone. The settings are not asked for: they are the attempt's.
 */
export function SaveRecipeForm({ source, onSaved }: { source: RecipeSourceAttempt; onSaved?: () => void }) {
  const queryClient = useQueryClient();
  const { data: user } = useQuery(sessionQuery);
  const suggested = useSuggestedName(source);
  const [name, setName] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const shown = name ?? suggested;
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!user || !shown.trim() || saving) return;
    setSaving(true);
    const saved = await saveRecipe(queryClient, source, { name: shown.trim(), note: note.trim() }, user.id);
    setSaving(false);
    if (saved) onSaved?.();
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <TextField
        label="Name it"
        value={shown}
        maxLength={RECIPE_NAME_MAX}
        placeholder="Silk PLA, slow outer wall"
        autoComplete="off"
        enterKeyHint="done"
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setName(event.target.value)}
      />
      <TextArea
        label="A note (optional)"
        minRows={2}
        maxLength={RECIPE_NOTE_MAX}
        placeholder="Dry it first, slow the outer wall…"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <Button type="submit" variant="primary" icon={RecipeIcon} loading={saving} disabled={!shown.trim()} fullWidth>
        Save recipe
      </Button>
    </form>
  );
}

/** "Save as recipe" from a build's card or an attempt entry: the form in a sheet. */
export function SaveRecipeSheet({
  source,
  onOpenChange,
}: {
  /** The attempt to save; null closes the sheet. */
  source: RecipeSourceAttempt | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet
      open={!!source}
      onOpenChange={onOpenChange}
      desktop="dialog"
      title="Save as a recipe"
      description="Keep these settings to start the next print from."
    >
      {source && <SaveRecipeForm key={source.id} source={source} onSaved={() => onOpenChange(false)} />}
    </Sheet>
  );
}
