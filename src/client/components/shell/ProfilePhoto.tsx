import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { CameraIcon } from "@/components/ui/icons";
import { useFilePicker } from "@/components/ui/PhotoTiles";
import { changeMyPhoto } from "@/lib/profile-photo";
import { sessionQuery } from "@/lib/queries";
import { canEdit, useReadOnly } from "@/lib/read-only";
import { CropSheet } from "./CropSheet";

/**
 * "Add a photo" / "Change photo" with your avatar, in the account menu (a sheet on phones, a popover on desktop).
 * Picking hands the file to the menu, which closes itself and shows PhotoCrop outside it: a sheet nested in another
 * open sheet hid each other from assistive tech. Both are one module, loaded when the menu opens: the crop and
 * upload code never weigh on the first load.
 */
export function PhotoRow({ variant = "menu", onPick }: { variant?: "menu" | "row"; onPick: (file: File) => void }) {
  const { data: user } = useSuspenseQuery(sessionQuery);
  const readOnly = useReadOnly();
  const picker = useFilePicker({ onFiles: ([picked]) => picked && onPick(picked), testId: "profile-photo-input" });
  if (!user) return null;
  const choose = () => canEdit() && picker.open();
  return (
    <>
      {variant === "row" ? (
        // Phone: your own row in the account sheet, which opens the picker.
        <button
          type="button"
          disabled={readOnly}
          onClick={choose}
          className="pressable focus-ring flex w-full items-center gap-3 rounded-md py-2.5 text-left disabled:opacity-60"
        >
          <span className="relative inline-flex shrink-0">
            <Avatar person={user} size="md" decorative />
            <span
              aria-hidden
              className="bg-select text-on-select ring-lifted absolute -right-1 -bottom-1 inline-flex size-4.5 items-center justify-center rounded-full ring-2"
            >
              <CameraIcon size={11} weight="fill" />
            </span>
          </span>
          <span className="text-body text-ink flex-1 font-semibold">{user.name}</span>
          <span className="text-small text-ink-soft">{user.photoUrl ? "Change photo" : "Add a photo"}</span>
        </button>
      ) : (
        <div className="flex items-center gap-3 py-1">
          <Avatar person={user} size="md" decorative />
          <Button variant="quiet" size="sm" className="-ml-3 flex-1 justify-start" disabled={readOnly} onClick={choose}>
            {user.photoUrl ? "Change photo" : "Add a photo"}
          </Button>
        </div>
      )}
      {picker.input}
    </>
  );
}

/** Places the chosen photo in a circle and saves it (or takes the picture away); shown outside the account menu. */
export function PhotoCrop({
  file,
  onFile,
  onClose,
}: {
  file: File | null;
  onFile: (file: File) => void;
  onClose: () => void;
}) {
  const { data: user } = useSuspenseQuery(sessionQuery);
  const queryClient = useQueryClient();
  const picker = useFilePicker({ onFiles: ([picked]) => picked && onFile(picked), testId: "profile-photo-again" });
  return (
    <>
      {picker.input}
      <CropSheet
        file={file}
        onClose={onClose}
        onChooseAnother={picker.open}
        onSave={(picture) => changeMyPhoto(queryClient, picture)}
        onRemove={user?.photoUrl ? () => changeMyPhoto(queryClient, null) : undefined}
      />
    </>
  );
}
