import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { DropOverlay } from "@/components/shell/DropOverlay";
import { LazyCaptureSheet } from "@/components/shell/LazyCaptureSheet";
import { OfflineNotice } from "@/components/shell/OfflineNotice";
import { Sidebar } from "@/components/shell/Sidebar";
import { StatusBarCap } from "@/components/shell/StatusBarCap";
import { sections, workshop } from "@/components/shell/sections";
import { TabBar } from "@/components/shell/TabBar";
import { CaptureProvider, useCapture, useGlobalCapture } from "@/lib/capture";
import { CONTENT_ID, focusContent } from "@/lib/focus-content";
import { focusSearch } from "@/lib/focus-search";
import { useHotkeys } from "@/lib/hotkeys";
import { connectOutbox } from "@/lib/items";
import { useLiveUpdates } from "@/lib/live";
import { followUnreadModels } from "@/lib/model-read";
import { clearOfflineData } from "@/lib/offline";
import { outbox } from "@/lib/outbox";
import { PaletteProvider, usePalette } from "@/lib/palette";
import { usePasskeyOffer } from "@/lib/passkey-offer";
import { followUnresizedPhotos } from "@/lib/photo-resize";
import { preloaded } from "@/lib/preloaded";
import { openedDirectly } from "@/lib/previous-path";
import { rememberedUser, sessionQuery } from "@/lib/queries";
import { useServiceWorkerMessages } from "@/lib/sw-messages";
import { useIsDesktop } from "@/lib/use-media-query";
import { forgetEndedSession, isSigningOut } from "@/lib/use-sign-out";
import { useWhenIdle } from "@/lib/when-idle";

// Desktop-only overlays, loaded once the app is idle rather than with the first screen.
// Held as loaded modules and rendered directly, not through React.lazy: its 300 ms Suspense reveal throttle made the
// first ⌘K slow even with the code in (lib/preloaded.ts).
const palette = preloaded(() => import("@/components/shell/CommandPalette"));
const shortcuts = preloaded(() => import("@/components/shell/ShortcutOverlay"));
const paletteShell = preloaded(() => import("@/components/ui/Palette"));
// The "Captured" sheet only exists after something was shared in: its code comes then, not with every first load.
const ShareSheet = lazy(() => import("@/components/shell/ShareSheet").then((m) => ({ default: m.ShareSheet })));

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
      throw redirect({ to: "/sign-in", search: { redirect: location.href }, replace: true });
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
      forgetEndedSession();
      void clearOfflineData();
      void navigate({ to: "/sign-in", search: { redirect: location.pathname + location.search }, replace: true }).then(
        () => queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" }),
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
  // Keeps this device's clock for "Since Thursday" once the app is idle (its code is out of the first load), and the
  // files downloaded to print (which build a print belongs to, decision 0076); stops with the shell.
  useEffect(() => {
    const stops: Array<() => void> = [];
    const stop = () => {
      for (const one of stops) one();
    };
    let off = false;
    const start = () => {
      void import("@/lib/since").then((since) => {
        if (!off) stops.push(since.followActivity());
      });
      void import("@/lib/downloads").then((downloads) => {
        if (!off) stops.push(downloads.followDownloads());
      });
    };
    const idle = "requestIdleCallback" in window;
    const id = idle ? requestIdleCallback(start, { timeout: 4000 }) : window.setTimeout(start, 1500);
    return () => {
      off = true;
      stop();
      if (idle) cancelIdleCallback(id);
      else clearTimeout(id);
    };
  }, []);
  // Follows what the other person does, while the app is open.
  useLiveUpdates();
  // After a password sign-in on a device with no passkey: one quiet offer.
  usePasskeyOffer();
  // A tapped notification says where to go; an answer given offline lands in the outbox behind this page's back.
  useServiceWorkerMessages(
    (path) => void navigate({ href: path, state: openedDirectly }),
    () => void outbox.pickUp(),
  );
  // Photos that came from an agent are resized quietly, in idle time, by the first browser that sees them.
  useEffect(() => followUnresizedPhotos(queryClient), [queryClient]);
  // Models from an agent are sliced the same way (and their pictures drawn), once, by the first browser that sees them.
  useEffect(() => followUnreadModels(queryClient), [queryClient]);
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
    // A device the server lost track of is signed up for notifications again.
    void import("@/lib/push").then((m) => m.resyncPush()).catch(() => undefined);
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
      <a
        href={`#${CONTENT_ID}`}
        onClick={(event) => {
          event.preventDefault();
          focusContent();
        }}
        className="text-small text-ink bg-lifted shadow-float focus-ring fixed top-3 left-3 z-50 -translate-y-20 rounded-md px-3 py-2 font-medium focus-visible:translate-y-0 max-md:hidden"
      >
        Skip to content
      </a>
      <Sidebar />
      <main id={CONTENT_ID} className="pt-safe md:pl-sidebar focus-visible:shadow-none">
        <div className="max-w-wide pb-page mx-auto w-full px-5 md:px-12 md:pb-16">
          <OfflineNotice />
          <Outlet />
        </div>
      </main>
      <StatusBarCap />
      <TabBar />
      <LazyCaptureSheet />
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
  const [asked, setAsked] = useState(false);
  const [helpAsked, setHelpAsked] = useState(false);
  if (paletteOpen && !asked) setAsked(true);
  if (helpOpen && !helpAsked) setHelpAsked(true);
  const loadedPalette = palette.use();
  const loadedShortcuts = shortcuts.use();
  const loadedShell = paletteShell.use();
  useEffect(() => {
    const warm = () => {
      void palette.start();
      void shortcuts.start();
      void paletteShell.start();
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
  if (asked && !loadedPalette) void palette.start();
  return (
    <>
      {asked &&
        (loadedPalette ? (
          <loadedPalette.CommandPalette />
        ) : (
          // The frame and search box draw as soon as ⌘K is pressed; the commands fill in when their code arrives.
          // Only while it is asked for: Escape, a click outside or a second ⌘K close the frame (paletteOpen goes false).
          paletteOpen && loadedShell && <loadedShell.PaletteShell onOpenChange={setPaletteOpen} />
        ))}
      {helpAsked && loadedShortcuts && <loadedShortcuts.ShortcutOverlay />}
    </>
  );
}
