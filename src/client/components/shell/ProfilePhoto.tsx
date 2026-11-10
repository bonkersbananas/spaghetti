import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useFilePicker } from "@/components/ui/PhotoTiles";
import { changeMyPhoto } from "@/lib/profile-photo";
import { sessionQuery } from "@/lib/queries";
import { canEdit, useReadOnly } from "@/lib/read-only";
import { CropSheet } from "./CropSheet";

/**
 * "Add a photo" / "Change photo" with your avatar, in the account menu (a sheet on phones, a popover on desktop).
 * Picking opens the camera or library, then the crop sheet; saving is instant, with Undo in the toast.
 * Its own module, loaded when the menu opens: the crop and upload code never weigh on the first load.
 */
export default function ProfilePhoto() {
  const { data: user } = useSuspenseQuery(sessionQuery);
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();
  const [file, setFile] = useState<File | null>(null);
  const picker = useFilePicker({ onFiles: ([picked]) => picked && setFile(picked), testId: "profile-photo-input" });
  if (!user) return null;
  const choose = () => canEdit() && picker.open();
  return (
    <>
      <div className="flex items-center gap-3 py-1">
        <Avatar person={user} size="lg" decorative />
        <div className="min-w-0 flex-1">
          <Button variant="quiet" size="sm" className="-ml-3" disabled={readOnly} onClick={choose}>
            {user.photoUrl ? "Change photo" : "Add a photo"}
          </Button>
          <p className="text-small text-ink-faint px-0 leading-snug">
            {user.photoUrl ? "Shown beside what you write." : "Instead of your initials."}
          </p>
        </div>
        {user.photoUrl && (
          <Button variant="quiet" size="sm" disabled={readOnly} onClick={() => changeMyPhoto(queryClient, null)}>
            Remove
          </Button>
        )}
      </div>
      {picker.input}
      <CropSheet
        file={file}
        onClose={() => setFile(null)}
        onChooseAnother={() => {
          setFile(null);
          picker.open();
        }}
        onSave={(picture) => changeMyPhoto(queryClient, picture)}
      />
    </>
  );
}
