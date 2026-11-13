import { fileUrl, type Twist } from "@shared/api";
import { carryOver } from "@shared/attempts";
import { keepOwnFilaments } from "@shared/slicing/filaments.ts";
import { slicedName } from "@shared/slicing/files.ts";
import { applyFileSettings } from "@shared/threemf/prefill.ts";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { createBuild, logAttempt } from "./builds";
import { spoolsQuery } from "./pantry-queries";

/** Whether a twist's model is sliced and saved: the file "Print it" starts the first attempt from. */
export const slicedModelOf = (twist: Pick<Twist, "model">) => {
  const model = twist.model;
  return model && !("pending" in model) && model.kind === "model" && model.slice?.status === "sliced" ? model : null;
};

/**
 * "Print it" on a twist: a build named for it (as before) and, when the twist's model is sliced, a first attempt that is
 * printing, carrying the sliced .gcode.3mf as its slicer file, so the build page shows the same plate and 3D view.
 * The build is there at once (and the page opens on it); the attempt follows once the file has been read. A twist
 * without a sliced model starts the empty build it always did. Returns the build's id.
 */
export function printTwist(queryClient: QueryClient, twist: Twist, name: string, userId: string): string {
  const itemId = createBuild(userId, { title: name, twistId: twist.id });
  const model = slicedModelOf(twist);
  if (model) void attachModel(queryClient, itemId, model, userId);
  return itemId;
}

async function attachModel(
  queryClient: QueryClient,
  itemId: string,
  model: NonNullable<ReturnType<typeof slicedModelOf>>,
  userId: string,
) {
  try {
    const response = await fetch(fileUrl(model.id, "sliced"), { credentials: "same-origin" });
    if (!response.ok) throw new Error(String(response.status));
    const file = new File([await response.blob()], slicedName(model.name));
    // The readers are not in anyone's first load.
    const [slicerFiles, spools] = await Promise.all([
      import("./slicer-files"),
      queryClient.ensureQueryData(spoolsQuery),
    ]);
    const { readSlicerFile, linkSpools, queueSlicerFile } = slicerFiles;
    const draft = await readSlicerFile(file);
    if (!draft) throw new Error("unreadable");
    // What the model's slice said, as the attempt sheet lays it over a first attempt (no stand-in filament claimed).
    const own = carryOver(undefined);
    const settings = applyFileSettings(own, keepOwnFilaments(own, linkSpools(model.prefill, spools).settings));
    const attemptId = logAttempt(
      { id: itemId },
      {
        outcome: null,
        printedAt: Date.now(),
        note: "",
        failureTags: [],
        successNotes: [],
        settings,
        parts: [],
        photos: [],
      },
      userId,
    );
    queueSlicerFile(itemId, attemptId, draft, draft.plates[0]?.index ?? 1, model.prefill);
  } catch {
    toast.message(
      "The build is started without the file",
      "The sliced model couldn't be fetched. Add it from the attempt.",
    );
  }
}
