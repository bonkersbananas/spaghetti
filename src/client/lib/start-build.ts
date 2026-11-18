import type { QueryClient } from "@tanstack/react-query";
import { createBuild } from "./builds";
import { addItemFile } from "./item-files";
import { forgetFresh } from "./items";
import { outbox } from "./outbox";
import { sessionQuery } from "./queries";

/**
 * The ways "Start a build" begins one from something other than an idea: a model link (kept as the build's note, as
 * capture keeps it for an idea) or a model file (kept with the build once the server has it). Returns the new build's
 * id, or null when nobody is signed in.
 */
export function startBuildFrom(queryClient: QueryClient, what: { link: string } | { file: File }): string | null {
  const user = queryClient.getQueryData(sessionQuery.queryKey);
  if (!user) return null;
  if ("link" in what) return createBuild(user.id, { note: what.link });
  const id = createBuild(user.id);
  // It has no title or note until the file shows: leaving the page meanwhile must not count as leaving it blank.
  forgetFresh(id);
  // The file goes to a build the server has: wait for the outbox to send the record first.
  const send = () => void addItemFile(queryClient, id, what.file);
  if (!outbox.isPending(id)) send();
  else {
    const stop = outbox.subscribe(() => {
      if (outbox.isPending(id)) return;
      stop();
      send();
    });
  }
  return id;
}
