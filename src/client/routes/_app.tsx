import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { CaptureSheet } from "@/components/shell/CaptureSheet";
import { DropOverlay } from "@/components/shell/DropOverlay";
import { OfflineNotice } from "@/components/shell/OfflineNotice";
import { Sidebar } from "@/components/shell/Sidebar";
import { sections, workshop } from "@/components/shell/sections";
import { TabBar } from "@/components/shell/TabBar";
import { CaptureProvider, useCapture, useGlobalCapture } from "@/lib/capture";
import { useHotkeys } from "@/lib/hotkeys";
import { connectOutbox } from "@/lib/items";
import { sessionQuery } from "@/lib/queries";
import { focusSearch } from "@/lib/search";

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
      <Shell />
    </CaptureProvider>
  );
}

function Shell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setOpen } = useCapture();
  const dragging = useGlobalCapture();
  // Sends captures still waiting from this visit or an earlier one.
  useEffect(() => connectOutbox(queryClient), [queryClient]);
  useHotkeys({
    c: () => setOpen(true),
    ...Object.fromEntries(
      [...sections, ...workshop].map((s) => [
        s.hotkey,
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
      <DropOverlay visible={dragging} />
    </div>
  );
}
