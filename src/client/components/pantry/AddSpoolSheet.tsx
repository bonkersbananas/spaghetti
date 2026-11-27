import type { Spool } from "@shared/api";
import { DEFAULT_NET_GRAMS } from "@shared/ledger";
import { isProduct, pickedProduct, productName, spoolFieldsOf, suggestedProducts } from "@shared/product-picks";
import { PRODUCTS } from "@shared/products";
import { colourNameOf } from "@shared/spool-lookup";
import { BRANDS, colorsName, FINISHES, finishLabel, linesFor, SPOOL_MATERIALS, spoolColors } from "@shared/spools";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ToggleChip } from "@/components/ui/Chip";
import { TextField } from "@/components/ui/Field";
import { ChipRow } from "@/components/ui/FilterChips";
import { CameraIcon, CheckIcon, ImageIcon, PlusIcon, SparkleIcon } from "@/components/ui/icons";
import { AddPhotoTile, PhotoThumb, useFilePicker } from "@/components/ui/PhotoTiles";
import { Sheet } from "@/components/ui/Sheet";
import { SpoolColourField, withColourCount } from "@/components/ui/SpoolColourField";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { cn } from "@/lib/cn";
import { labelReadsEnabled, useLabelReadsEnabled } from "@/lib/label-read";
import { addSpool, type SpoolDraft } from "@/lib/pantry";
import { sessionQuery } from "@/lib/queries";
import { useIsDesktop } from "@/lib/use-media-query";
import { useObjectUrl } from "@/lib/use-object-url";
import { WeightPicker } from "./WeightPicker";

interface AddSpoolSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Start from these values (a slicer file's filament that isn't in the pantry yet). */
  initial?: SpoolDraft;
  /** Called with the new spool, for whoever wants to load or link it. */
  onAdded?: (spool: Spool, saved: Promise<boolean>) => void;
  /** Says where the spool will go: "It goes into slot A2." */
  description?: string;
  /** Where the sheet is part of a flow (a spool going into a slot): after a label photo stay where you are instead of opening the spool's page. */
  stayPut?: boolean;
  /** The slot it goes into: the button then says "Add to A1". */
  slot?: string | null;
}

/** How many products show before "More". */
const FEW = 3;

const blank = (initial?: SpoolDraft): SpoolDraft => ({
  material: "PLA",
  brand: null,
  colorName: null,
  colorHex: null,
  colors: null,
  line: null,
  finish: null,
  netGrams: DEFAULT_NET_GRAMS,
  ...initial,
});

/**
 * A new spool in seconds, standing at the shelf: snap the label, pick a
 * material and a color, done. Brand and finish are a tap more.
 */
export function AddSpoolSheet({
  open,
  onOpenChange,
  initial,
  onAdded,
  description,
  stayPut,
  slot,
}: AddSpoolSheetProps) {
  const queryClient = useQueryClient();
  const { data: user } = useSuspenseQuery(sessionQuery);
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const labelReads = useLabelReadsEnabled();
  const id = useId();
  const [draft, setDraft] = useState<SpoolDraft>(() => blank(initial));
  // A color name typed by hand is kept; one we guessed follows the color.
  const [namedByHand, setNamedByHand] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const photoUrl = useObjectUrl(photo);
  // The product chip last tapped: while the spool still is that product, its chip is the lit one (the plain "PLA
  // Basic" stays lit with Jade white picked, though "PLA Basic · Jade white" is the same spool).
  const [tapped, setTapped] = useState<string | null>(null);
  const [otherMaterial, setOtherMaterial] = useState(false);
  // The product row shows a few; "More" lays out the rest of that material's.
  const [allProducts, setAllProducts] = useState(false);
  // What the person has set themselves: a label read may fill the rest, and the starting material and weight.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());

  // Moves on at each open, close and save: a photo still waiting for the features knows the sheet it came from is gone.
  const turn = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when it opens.
  useEffect(() => {
    turn.current++;
    if (!open) return;
    setTapped(null);
    setAllProducts(false);
    setDraft(blank(initial));
    setNamedByHand(!!initial?.colorName);
    setTouched(
      new Set(
        Object.entries(initial ?? {})
          .filter(([, value]) => value != null)
          .map(([key]) => key),
      ),
    );
    setOtherMaterial(!!initial?.material && !(SPOOL_MATERIALS as readonly string[]).includes(initial.material));
  }, [open]);

  const pickPhoto = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    // With Claude's key, a photo here is the label to read: the spool is saved with it at once. One picked before the
    // features answered waits for them, then saves with the sheet as it is by then.
    if (labelReads) save(file);
    else {
      // Unless, by then, the sheet closed or saved (the counter moves on both): the photo is then dropped.
      const at = turn.current;
      void labelReadsEnabled(queryClient).then((read) => {
        if (turn.current !== at) return;
        if (read) saveRef.current(file);
        else setPhoto(file);
      });
    }
  };
  const camera = useFilePicker({ camera: true, onFiles: pickPhoto, testId: "spool-camera-input" });
  const library = useFilePicker({ onFiles: pickPhoto, testId: "spool-photo-input" });

  const change = (next: Partial<SpoolDraft>) => {
    setTouched((current) => new Set([...current, ...Object.keys(next)]));
    setDraft((current) => ({ ...current, ...next }));
  };
  // A colour name typed by hand stays; a guessed one follows the colours ("Black/Purple" for two).
  const setColours = (next: { colorHex: string | null; colors: string[] | null }) => {
    const colors = spoolColors(next);
    const guess = colors.length > 1 ? colorsName(colors) : colors[0] ? colourNameOf(colors[0]) : undefined;
    change({ ...next, ...(namedByHand ? {} : { colorName: guess ?? null }) });
  };
  // Only this material's products, and a few of them: the colour and the fields are what the sheet is for.
  const products = suggestedProducts(otherMaterial ? "" : draft.material, initial?.colorName);
  const tappedProduct = PRODUCTS.find((entry) => entry.id === tapped);
  const litProduct = tappedProduct && isProduct(draft, tappedProduct) ? tappedProduct : pickedProduct(draft);
  // The lit product always shows, first.
  const lit = products.find((product) => product.id === litProduct?.id);
  const shown = allProducts ? products : [...(lit ? [lit] : []), ...products.filter((p) => p !== lit)].slice(0, FEW);
  // A known product fills in what its label says; the colours stay as picked, spread over as many as it has.
  const pickProduct = (id: string) => {
    const product = PRODUCTS.find((entry) => entry.id === id);
    if (!product) return;
    if (litProduct?.id === id) {
      setTapped(null);
      change({ brand: null, line: null, finish: null, nozzleTempMin: null, nozzleTempMax: null });
      return;
    }
    setTapped(id);
    setOtherMaterial(!(SPOOL_MATERIALS as readonly string[]).includes(product.material));
    change(spoolFieldsOf(product));
    // A product sold in one colour brings it: the colour picked is the colour saved.
    if (product.colour) {
      setNamedByHand(false);
      return;
    }
    const count = product.colours ?? 1;
    if (count !== Math.max(1, spoolColors(draft).length) && (count > 1 || draft.colors)) {
      setColours(withColourCount({ colorHex: draft.colorHex ?? null, colors: draft.colors ?? null }, count));
    }
  };

  function save(label?: File) {
    if (!user || (!label && !draft.material.trim())) return;
    turn.current++;
    const read = label
      ? {
          placeholders: (["material", "netGrams"] as const).filter(
            (field) => !touched.has(field) || (field === "material" && !draft.material.trim()),
          ),
        }
      : undefined;
    const { spool, saved } = addSpool(
      queryClient,
      draft,
      user.id,
      label ?? photo ?? undefined,
      read &&
        ((uploaded, spoolId) => {
          // Claude's part loads only when a label is read.
          void import("@/lib/label-read").then((m) =>
            m.readUploaded(queryClient, spoolId, uploaded, read.placeholders),
          );
        }),
    );
    setPhoto(null);
    onOpenChange(false);
    onAdded?.(spool, saved);
    // On its own page the fields fill in, like the label jumping into the form.
    if (label && !stayPut) void navigate({ to: "/pantry/$spoolId", params: { spoolId: spool.id } });
  }
  const saveRef = useRef(save);
  saveRef.current = save;

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
          onClick={() => save()}
          className="max-md:flex-1"
        >
          {slot ? `Add to ${slot === "Ext" ? "external" : slot}` : "Add to pantry"}
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
        <div className="flex flex-col gap-3">
          <div className="flex gap-2.5">
            {photo ? (
              photoUrl && <PhotoThumb src={photoUrl} alt="Spool label" onRemove={() => setPhoto(null)} />
            ) : (
              <>
                {!isDesktop && (
                  <AddPhotoTile
                    size="md"
                    icon={CameraIcon}
                    label={labelReads ? "Read the label" : "Snap the label"}
                    onClick={camera.open}
                  />
                )}
                <AddPhotoTile
                  size="md"
                  icon={isDesktop ? (labelReads ? SparkleIcon : PlusIcon) : ImageIcon}
                  label={isDesktop ? (labelReads ? "Read the label" : "Add a photo") : "Library"}
                  onClick={library.open}
                />
              </>
            )}
          </div>
          {labelReads && !photo && (
            <p className="text-small text-ink-faint">
              Claude fills in what the label says. Anything you've set stays as you set it.
            </p>
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
          <SpoolColourField
            value={{ colorHex: draft.colorHex ?? null, colors: draft.colors ?? null }}
            onChange={setColours}
          />
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

        {products.length > 0 && (
          <fieldset className="flex flex-col">
            <legend className="text-small text-ink-soft mb-2 px-0.5 font-semibold">Start from a product</legend>
            <ChipRow label="Products" wrap={allProducts}>
              {shown.map((product) => (
                <ToggleChip
                  key={product.id}
                  selected={litProduct?.id === product.id}
                  onClick={() => pickProduct(product.id)}
                  lead={!!product.colour}
                  className="shrink-0"
                >
                  {product.colour && <SpoolDisc color={product.colour.hex} size="sm" />}
                  {productName(product)}
                </ToggleChip>
              ))}
              {!allProducts && products.length > FEW && (
                <ToggleChip onClick={() => setAllProducts(true)} className="shrink-0">
                  More
                </ToggleChip>
              )}
            </ChipRow>
          </fieldset>
        )}

        <div>
          <TextField
            size="sm"
            label="Brand"
            placeholder="Bambu Lab, Polymaker…"
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

        <div>
          <TextField
            size="sm"
            label="Product line"
            placeholder="PolyTerra, Panchroma… if it has one"
            list={`${id}-lines`}
            maxLength={40}
            value={draft.line ?? ""}
            onChange={(event) => change({ line: event.target.value || null })}
          />
          <datalist id={`${id}-lines`}>
            {linesFor(draft.brand).map((line) => (
              <option key={line} value={line} />
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

        <fieldset className="flex flex-col">
          <legend className="text-small text-ink-soft mb-2.5 px-0.5 font-semibold">How much filament</legend>
          <WeightPicker value={draft.netGrams ?? null} onChange={(netGrams) => change({ netGrams })} />
        </fieldset>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
