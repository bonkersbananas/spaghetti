import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { CaptureSheet } from "@/components/shell/CaptureSheet";
import { DropOverlay } from "@/components/shell/DropOverlay";
import { OfflineNotice } from "@/components/shell/OfflineNotice";
import { Sidebar } from "@/components/shell/Sidebar";
import { sections, workshop } from "@/components/shell/sections";
import { TabBar } from "@/components/shell/TabBar";
import { CaptureProvider, useCapture, useGlobalCapture } from "@/lib/capture";
import { useHotkeys } from "@/lib/hotkeys";
import { connectOutbox } from "@/lib/items";
import { useLiveUpdates } from "@/lib/live";
import { PaletteProvider, usePalette } from "@/lib/palette";
import { followUnresizedPhotos } from "@/lib/photo-resize";
import { sessionQuery } from "@/lib/queries";
import { focusSearch } from "@/lib/search";
import { useIsDesktop } from "@/lib/use-media-query";

// Desktop-only overlays, loaded once the app is idle rather than with the first screen.
const loadPalette = () => import("@/components/shell/CommandPalette");
const loadShortcuts = () => import("@/components/shell/ShortcutOverlay");
// The "Captured" sheet only exists after something was shared in: its code comes then, not with every first load.
const ShareSheet = lazy(() => import("@/components/shell/ShareSheet").then((m) => ({ default: m.ShareSheet })));
const CommandPalette = lazy(() => loadPalette().then((m) => ({ default: m.CommandPalette })));
const ShortcutOverlay = lazy(() => loadShortcuts().then((m) => ({ default: m.ShortcutOverlay })));

/** The signed-in app: sidebar on desktop, tab bar on phones. */
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery);
    if (!user) {
      throw redirect({ to: "/sign-in", search: { redirect: location.href } });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  return (
    <CaptureProvider>
      <PaletteProvider>
        <Shell />
      </PaletteProvider>
    </CaptureProvider>
  );
}

function Shell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setOpen, shared } = useCapture();
  const dragging = useGlobalCapture();
  // Sends captures still waiting from this visit or an earlier one.
  useEffect(() => connectOutbox(queryClient), [queryClient]);
  // Follows what the other person does, while the app is open.
  useLiveUpdates();
  // Photos that came from an agent are resized quietly, in idle time, by the first browser that sees them.
  useEffect(() => followUnresizedPhotos(queryClient), [queryClient]);
  const { setPaletteOpen, setHelpOpen } = usePalette();
  const isDesktop = useIsDesktop();
  useHotkeys({
    capture: () => setOpen(true),
    // There is no palette on phones.
    palette: isDesktop ? () => setPaletteOpen(true) : undefined,
    help: isDesktop ? () => setHelpOpen(true) : undefined,
    ...Object.fromEntries(
      [...sections, ...workshop].map((s) => [
        s.shortcut,
        () => {
          void navigate({ to: s.to });
          // "/" focuses the search box from anywhere, also when search is already open.
          if (s.to === "/search") focusSearch();
        },
      ]),
    ),
  });

  return (
    <div className="bg-paper min-h-dvh">
      <Sidebar />
      <main className="pt-safe md:pl-sidebar">
        <div className="max-w-wide pb-tabbar mx-auto w-full px-5 md:px-12 md:pb-16">
          <OfflineNotice />
          <Outlet />
        </div>
      </main>
      <TabBar />
      <CaptureSheet />
      {shared && (
        <Suspense fallback={null}>
          <ShareSheet />
        </Suspense>
      )}
      {isDesktop && <DesktopOverlays />}
      <DropOverlay visible={dragging} />
    </div>
  );
}

/**
 * The command palette and the shortcut list. Their code arrives while the
 * browser is idle after the first screen, so ⌘K still opens at once; each
 * mounts the first time it is asked for and stays (for its exit animation).
 */
function DesktopOverlays() {
  const { paletteOpen, helpOpen } = usePalette();
  const [palette, setPalette] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  if (paletteOpen && !palette) setPalette(true);
  if (helpOpen && !shortcuts) setShortcuts(true);
  useEffect(() => {
    const warm = () => {
      void loadPalette();
      void loadShortcuts();
    };
    if (!("requestIdleCallback" in window)) {
      const timer = setTimeout(warm, 1500);
      return () => clearTimeout(timer);
    }
    const id = requestIdleCallback(warm, { timeout: 4000 });
    return () => cancelIdleCallback(id);
  }, []);
  return (
    <Suspense fallback={null}>
      {palette && <CommandPalette />}
      {shortcuts && <ShortcutOverlay />}
    </Suspense>
  );
}
