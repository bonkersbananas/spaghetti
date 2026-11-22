import type { AttemptFile } from "@shared/api";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { addItemFile } from "@/lib/item-files";
import { modelAccept } from "@/lib/model-pick";
import { scrollBehavior } from "@/lib/motion";
import { canEdit } from "@/lib/read-only";
import { takeModels } from "@/lib/take-models";

/**
 * Adding a model or slicer file to an item (an idea, or a build): the hidden picker (no accept filter on iOS, the type
 * is checked after the pick), the optimistic row with its Undo (lib/item-files), and bringing the new card into view
 * once it is there. `keepFile` takes a file from anywhere (a drop); `open` opens the picker.
 */
export function useItemFilePicker(item: { id: string; pending?: boolean }, files: readonly AttemptFile[]) {
  const queryClient = useQueryClient();
  const picker = useRef<HTMLInputElement>(null);
  const wantsNewFile = useRef<number | null>(null);
  const keepFile = (file: File) => {
    if (!canEdit(item.pending)) return;
    // The new card can come in below the fold: bring it into view once it is there. Only a longer list counts, and
    // only for a while: a file that can't be read adds nothing, and a later removal or sync must not scroll the page.
    wantsNewFile.current = files.length;
    window.setTimeout(() => {
      wantsNewFile.current = null;
    }, 10_000);
    void addItemFile(queryClient, item.id, file);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per added file.
  useEffect(() => {
    if (wantsNewFile.current === null || files.length <= wantsNewFile.current) return;
    wantsNewFile.current = null;
    let frames = 0;
    // The file list loads lazily: look for its last card for a few frames.
    const look = () => {
      const cards = document.querySelectorAll<HTMLElement>(`section[aria-labelledby="files-${item.id}"] > ul > li`);
      const last = cards[cards.length - 1];
      if (last) last.scrollIntoView({ block: "center", behavior: scrollBehavior() });
      else if (frames++ < 30) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  }, [files.length]);
  const input = (
    <input
      ref={picker}
      type="file"
      accept={modelAccept()}
      multiple
      hidden
      data-testid="idea-file-input"
      onChange={(event) => {
        void takeModels([...(event.target.files ?? [])], keepFile);
        event.target.value = "";
      }}
    />
  );
  return { input, open: () => picker.current?.click(), keepFile };
}
