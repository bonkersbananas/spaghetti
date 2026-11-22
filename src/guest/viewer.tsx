/**
 * The shared page's 3D view (decision 0077): the app's own PrintViewer, as the app shows a sliced plate, mounted in
 * the sheet src/guest/island.ts opens. Built apart from the app (scripts/vite-guest.ts): the app's own chunks stay as
 * they are, and a guest downloads this only on a tap. It reads the plate's toolpaths through the link's token
 * (/s/<token>/files/<id>/toolpaths), never /api, and offers no download: there is nothing here to save.
 */
import "./viewer.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PrintViewer from "@/components/viewer/PrintViewer";

/** What the page says about the plate (worker/guest/page.tsx `viewData`, from view.ts `GuestView3d`). */
interface ViewerData {
  url: string;
  id: string;
  plate: number;
  copies?: number;
  size?: [number, number, number];
  fallbackColors?: (string | null)[];
  originalColors?: (string | null)[];
  names?: (string | null)[];
}

const HEX = /^#[0-9a-f]{6}$/i;
const colours = (list: unknown) =>
  Array.isArray(list)
    ? list.map((value) => (typeof value === "string" && HEX.test(value) ? value : undefined))
    : undefined;
const words = (list: unknown) =>
  Array.isArray(list) ? list.map((value) => (typeof value === "string" ? value : undefined)) : undefined;

/** Only what a toolpaths address on this link looks like: the viewer fetches nothing else. */
const TOOLPATHS = /^\/s\/[A-Za-z0-9_-]+\/files\/[0-9a-f-]{36}\/toolpaths$/;

/** The viewer never asks the API anything for a print that isn't printing; its query client only has to exist. */
const queries = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });

/** Mounts the viewer in the sheet's stage; returns what takes it down again. */
export function mount(stage: HTMLElement, json: string): () => void {
  const data = JSON.parse(json) as Partial<ViewerData>;
  if (typeof data.url !== "string" || !TOOLPATHS.test(data.url) || typeof data.id !== "string") return () => {};
  const size =
    Array.isArray(data.size) && data.size.length === 3 && data.size.every((n) => typeof n === "number")
      ? data.size
      : undefined;
  const root = createRoot(stage);
  root.render(
    <StrictMode>
      <QueryClientProvider client={queries}>
        <PrintViewer
          url={data.url}
          fileId={data.id}
          plate={typeof data.plate === "number" ? data.plate : 1}
          {...(typeof data.copies === "number" ? { copies: data.copies } : {})}
          {...(size ? { size } : {})}
          fallbackColors={colours(data.fallbackColors)}
          originalColors={colours(data.originalColors)}
          names={words(data.names)}
        />
      </QueryClientProvider>
    </StrictMode>,
  );
  // Focus moves on to the viewer's stage (as the app's sheet gives it), so Space plays and the arrows step layers.
  requestAnimationFrame(() => stage.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true }));
  return () => root.unmount();
}
