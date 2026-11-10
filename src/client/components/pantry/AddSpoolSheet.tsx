import type { Spool } from "@shared/api";
import { BRANDS, FINISHES, finishLabel, nearestColorName, QUICK_COLORS, SPOOL_MATERIALS } from "@shared/spools";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ToggleChip } from "@/components/ui/Chip";
import { TextField } from "@/components/ui/Field";
import { CameraIcon, CheckIcon, ImageIcon, PlusIcon } from "@/components/ui/icons";
import { AddPhotoTile, PhotoThumb, useFilePicker } from "@/components/ui/PhotoTiles";
import { Sheet } from "@/components/ui/Sheet";
import { SwatchPicker } from "@/components/ui/Swatch";
import { cn } from "@/lib/cn";
import { addSpool, type SpoolDraft } from "@/lib/pantry";
import { sessionQuery } from "@/lib/queries";
import { useIsDesktop } from "@/lib/use-media-query";
import { useObjectUrl } from "@/lib/use-object-url";

interface AddSpoolSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Start from these values (a slicer file's filament that isn't in the pantry yet). */
  initial?: SpoolDraft;
  /** Called with the new spool, for whoever wants to load or link it. */
  onAdded?: (spool: Spool, saved: Promise<boolean>) => void;
  /** Says where the spool will go: "It goes into slot A2." */
  description?: string;
}

const blank = (initial?: SpoolDraft): SpoolDraft => ({
  material: "PLA",
  brand: null,
  colorName: null,
  colorHex: null,
  finish: null,
  ...initial,
});

/**
 * A new spool in seconds, standing at the shelf: snap the label, pick a
 * material and a color, done. Brand and finish are a tap more.
 */
export function AddSpoolSheet({ open, onOpenChange, initial, onAdded, description }: AddSpoolSheetProps) {
  const queryClient = useQueryClient();
  const { data: user } = useSuspenseQuery(sessionQuery);
  const isDesktop = useIsDesktop();
  const id = useId();
  const [draft, setDraft] = useState<SpoolDraft>(() => blank(initial));
  // A color name typed by hand is kept; one we guessed follows the color.
  const [namedByHand, setNamedByHand] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const photoUrl = useObjectUrl(photo);
  const [otherMaterial, setOtherMaterial] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only when it opens.
  useEffect(() => {
    if (!open) return;
    setDraft(blank(initial));
    setNamedByHand(!!initial?.colorName);
    setOtherMaterial(!!initial?.material && !(SPOOL_MATERIALS as readonly string[]).includes(initial.material));
  }, [open]);

  const pickPhoto = (files: File[]) => {
    const file = files[0];
    if (file) setPhoto(file);
  };
  const camera = useFilePicker({ camera: true, onFiles: pickPhoto, testId: "spool-camera-input" });
  const library = useFilePicker({ onFiles: pickPhoto, testId: "spool-photo-input" });

  const change = (next: Partial<SpoolDraft>) => setDraft((current) => ({ ...current, ...next }));
  const setColor = (hex: string, name?: string) =>
    change({ colorHex: hex, ...(namedByHand ? {} : { colorName: name ?? nearestColorName(hex) ?? null }) });

  function save() {
    if (!user || !draft.material.trim()) return;
    const { spool, saved } = addSpool(queryClient, draft, user.id, photo ?? undefined);
    setPhoto(null);
    onOpenChange(false);
    onAdded?.(spool, saved);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="New spool"
      description={description ?? "Snap the label, pick a material and a color. That's it."}
      footer={
        <Button
          variant="primary"
          size={isDesktop ? "md" : "lg"}
          icon={CheckIcon}
          disabled={!draft.material.trim()}
          onClick={save}
          className="max-md:flex-1"
        >
          Add to pantry
        </Button>
      }
    >
      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        {camera.input}
        {library.input}
        <div className="flex gap-2.5">
          {photo ? (
            photoUrl && <PhotoThumb src={photoUrl} alt="Spool label" onRemove={() => setPhoto(null)} />
          ) : (
            <>
              {!isDesktop && <AddPhotoTile size="md" icon={CameraIcon} label="Snap the label" onClick={camera.open} />}
              <AddPhotoTile
                size="md"
                icon={isDesktop ? PlusIcon : ImageIcon}
                label={isDesktop ? "Add a photo" : "Library"}
                onClick={library.open}
              />
            </>
          )}
        </div>

        <fieldset className="flex flex-col gap-2.5">
          <legend className="text-small text-ink-soft mb-2.5 px-0.5 font-semibold">Material</legend>
          <div className="flex flex-wrap gap-2">
            {SPOOL_MATERIALS.map((material) => (
              <ToggleChip
                key={material}
                selected={!otherMaterial && draft.material === material}
                onClick={() => {
                  setOtherMaterial(false);
                  change({ material });
                }}
              >
                {material}
              </ToggleChip>
            ))}
            <ToggleChip
              selected={otherMaterial}
              onClick={() => {
                setOtherMaterial(true);
                change({ material: "" });
              }}
            >
              Other
            </ToggleChip>
          </div>
          {otherMaterial && (
            <TextField
              size="sm"
              aria-label="Other material"
              placeholder="PPA-CF, PCTG, ASA-Aero…"
              autoFocus
              maxLength={40}
              value={draft.material}
              onChange={(event) => change({ material: event.target.value })}
            />
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-small text-ink-soft mb-2.5 px-0.5 font-semibold">Color</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Common colors">
            {QUICK_COLORS.map((color) => {
              const selected = draft.colorHex === color.hex;
              return (
                // biome-ignore lint/a11y/useSemanticElements: a swatch, not a form radio.
                <button
                  key={color.hex}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={color.name}
                  title={color.name}
                  onClick={() => setColor(color.hex, color.name)}
                  className={cn(
                    "pressable focus-ring shadow-well ring-ink/15 size-10 rounded-full ring-1 ring-inset md:size-8",
                    selected && "ring-ink ring-offset-paper ring-2 ring-offset-2",
                  )}
                  style={{ backgroundColor: color.hex }} // design-lint-ignore: a filament's color is data
                />
              );
            })}
            <SwatchPicker
              value={draft.colorHex && !QUICK_COLORS.some((c) => c.hex === draft.colorHex) ? draft.colorHex : undefined}
              onChange={(hex) => setColor(hex)}
              label="Another color"
              className="size-10 rounded-full md:size-8"
            />
          </div>
          <TextField
            size="sm"
            aria-label="Color name"
            placeholder="Color name, as on the label"
            maxLength={60}
            value={draft.colorName ?? ""}
            onChange={(event) => {
              setNamedByHand(true);
              change({ colorName: event.target.value || null });
            }}
          />
        </fieldset>

        <div>
          <TextField
            size="sm"
            label="Brand"
            placeholder="Bambu, Polymaker…"
            list={`${id}-brands`}
            maxLength={60}
            value={draft.brand ?? ""}
            onChange={(event) => change({ brand: event.target.value || null })}
          />
          <datalist id={`${id}-brands`}>
            {BRANDS.map((brand) => (
              <option key={brand} value={brand} />
            ))}
          </datalist>
        </div>

        <fieldset className="flex flex-col">
          <legend className="text-small text-ink-soft mb-2.5 px-0.5 font-semibold">Finish</legend>
          <div className="flex flex-wrap gap-2">
            {FINISHES.map((finish) => (
              <ToggleChip
                key={finish}
                selected={draft.finish === finish}
                onClick={() => change({ finish: draft.finish === finish ? null : finish })}
              >
                {finishLabel(finish)}
              </ToggleChip>
            ))}
          </div>
        </fieldset>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
