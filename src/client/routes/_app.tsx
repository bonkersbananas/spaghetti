import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { CaptureSheet } from "@/components/shell/CaptureSheet";
import { DropOverlay } from "@/components/shell/DropOverlay";
import { OfflineNotice } from "@/components/shell/OfflineNotice";
import { Sidebar } from "@/components/shell/Sidebar";
import { StatusBarCap } from "@/components/shell/StatusBarCap";
import { sections, workshop } from "@/components/shell/sections";
import { TabBar } from "@/components/shell/TabBar";
import { CaptureProvider, useCapture, useGlobalCapture } from "@/lib/capture";
import { useHotkeys } from "@/lib/hotkeys";
import { connectOutbox } from "@/lib/items";
import { useLiveUpdates } from "@/lib/live";
import { clearOfflineData } from "@/lib/offline";
import { outbox } from "@/lib/outbox";
import { PaletteProvider, usePalette } from "@/lib/palette";
import { usePasskeyOffer } from "@/lib/passkey-offer";
import { followUnresizedPhotos } from "@/lib/photo-resize";
import { useServiceWorkerMessages } from "@/lib/push";
import { rememberedUser, sessionQuery } from "@/lib/queries";
import { focusSearch } from "@/lib/search";
import { useIsDesktop } from "@/lib/use-media-query";
import { isSigningOut } from "@/lib/use-sign-out";
import { useWhenIdle } from "@/lib/when-idle";

// Desktop-only overlays, loaded once the app is idle rather than with the first screen.
const loadPalette = () => import("@/components/shell/CommandPalette");
const loadShortcuts = () => import("@/components/shell/ShortcutOverlay");
// The "Captured" sheet only exists after something was shared in: its code comes then, not with every first load.
const ShareSheet = lazy(() => import("@/components/shell/ShareSheet").then((m) => ({ default: m.ShareSheet })));
const PaletteShell = lazy(() => import("@/components/ui/Palette").then((m) => ({ default: m.PaletteShell })));
const CommandPalette = lazy(() => loadPalette().then((m) => ({ default: m.CommandPalette })));
const ShortcutOverlay = lazy(() => loadShortcuts().then((m) => ({ default: m.ShortcutOverlay })));

/** The signed-in app: sidebar on desktop, tab bar on phones. */
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    const { queryClient } = context;
    let user = queryClient.getQueryData(sessionQuery.queryKey);
    if (user === undefined) {
      // A resumed app opens as the person who was signed in at once, rather than after a round trip to the server;
      // the server confirms in the background (AppLayout signs out a session it no longer knows).
      const remembered = rememberedUser();
      if (remembered) {
        queryClient.setQueryData(sessionQuery.queryKey, remembered);
        void queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 }).catch(() => undefined);
        user = remembered;
      } else {
        user = await queryClient.ensureQueryData(sessionQuery);
      }
    }
    if (!user) {
      throw redirect({ to: "/sign-in", search: { redirect: location.href } });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  // The background check of a remembered session found it ended (or this person signed out in another tab).
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: user } = useQuery(sessionQuery);
  useEffect(() => {
    // Signing out navigates by itself; a session the server ended keeps the page for after signing in again, and
    // forgets what this device kept of it, as signing out does (signed out from another device, or it lapsed).
    if (user === null && !isSigningOut()) {
      void clearOfflineData();
      void navigate({ to: "/sign-in", search: { redirect: location.pathname + location.search } }).then(() =>
        queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" }),
      );
    }
  }, [user, navigate, queryClient]);
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
  // After a password sign-in on a device with no passkey: one quiet offer.
  usePasskeyOffer();
  // A tapped notification says where to go; an answer given offline lands in the outbox behind this page's back.
  useServiceWorkerMessages(
    (path) => void navigate({ href: path }),
    () => void outbox.pickUp(),
  );
  // Photos that came from an agent are resized quietly, in idle time, by the first browser that sees them.
  useEffect(() => followUnresizedPhotos(queryClient), [queryClient]);
  // The two pages every list opens: their code is fetched once the app is idle (the tab bar already warms the lists),
  // so the first tap on an idea or a build doesn't wait for it. The routes have no loaders, so nothing else loads.
  const router = useRouter();
  useWhenIdle(() => {
    // Every section's code too (it used to start with the first render and compete with it for the network). A tap
    // before then still gets a head start from the touch itself (the router preloads on intent).
    for (const { to } of [...sections, ...workshop]) void router.preloadRoute({ to });
    void router.preloadRoute({ to: "/builds/$buildId", params: { buildId: "-" } });
    void router.preloadRoute({ to: "/ideas/$ideaId", params: { ideaId: "-" } });
    void import("@/components/ideas/CardMenu");
  });
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
    <div className="bg-paper">
      <Sidebar />
      <main className="pt-safe md:pl-sidebar">
        <div className="max-w-wide pb-page mx-auto w-full px-5 md:px-12 md:pb-16">
          <OfflineNotice />
          <Outlet />
        </div>
      </main>
      <StatusBarCap />
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
  const { paletteOpen, helpOpen, setPaletteOpen } = usePalette();
  const [palette, setPalette] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  if (paletteOpen && !palette) setPalette(true);
  if (helpOpen && !shortcuts) setShortcuts(true);
  useEffect(() => {
    const warm = () => {
      void loadPalette();
      void loadShortcuts();
      void import("@/components/ui/Palette");
    };
    // The first key press or touch after a page load starts the fetch at once, rather than waiting for an idle moment
    // that a busy first second may not give (the Ctrl of ⌘K gets a head start on its K).
    const events = ["keydown", "pointerdown"] as const;
    const onFirst = () => {
      for (const type of events) window.removeEventListener(type, onFirst, true);
      warm();
    };
    for (const type of events) window.addEventListener(type, onFirst, { capture: true, passive: true });
    // And a second after the first screen at the latest: a busy first second may never give the browser an idle moment.
    const timer = setTimeout(warm, 1000);
    const id = "requestIdleCallback" in window ? requestIdleCallback(warm, { timeout: 4000 }) : undefined;
    return () => {
      clearTimeout(timer);
      if (id !== undefined) cancelIdleCallback(id);
      for (const type of events) window.removeEventListener(type, onFirst, true);
    };
  }, []);
  return (
    <Suspense fallback={null}>
      {palette && (
        // The frame and search box draw as soon as ⌘K is pressed; the commands fill in when their code arrives.
        <Suspense
          fallback={
            // Only while it is asked for: Escape, a click outside or a second ⌘K close the frame (paletteOpen goes false).
            paletteOpen ? (
              <Suspense fallback={null}>
                <PaletteShell onOpenChange={setPaletteOpen} />
              </Suspense>
            ) : null
          }
        >
          <CommandPalette />
        </Suspense>
      )}
      {shortcuts && <ShortcutOverlay />}
    </Suspense>
  );
}
