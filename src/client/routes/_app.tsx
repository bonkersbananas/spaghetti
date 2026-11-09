import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { CaptureSheet } from "@/components/shell/CaptureSheet";
import { Sidebar } from "@/components/shell/Sidebar";
import { sections } from "@/components/shell/sections";
import { TabBar } from "@/components/shell/TabBar";
import { CaptureProvider, useCapture } from "@/lib/capture";
import { useHotkeys } from "@/lib/hotkeys";
import { sessionQuery } from "@/lib/queries";

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
  const { setOpen } = useCapture();
  useHotkeys({
    c: () => setOpen(true),
    ...Object.fromEntries(sections.map((s) => [s.hotkey, () => navigate({ to: s.to })])),
  });

  return (
    <div className="bg-paper min-h-dvh">
      <Sidebar />
      <main className="pt-safe md:pl-sidebar">
        <div className="max-w-wide pb-tabbar mx-auto w-full px-5 md:px-12 md:pb-16">
          <Outlet />
        </div>
      </main>
      <TabBar />
      <CaptureSheet />
    </div>
  );
}
