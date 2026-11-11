import { useEffect, useState } from "react";
import { Toaster as SonnerToaster } from "sonner";
import { useIsDesktop } from "@/lib/use-media-query";
import { CheckCircleIcon, WarningIcon } from "./icons";

/** True while a sheet or dialog is in the page. */
function useDialogOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => setOpen(!!document.querySelector("[role=dialog]"));
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    check();
    return () => observer.disconnect();
  }, []);
  return open;
}

/**
 * The Toaster itself (sonner is about 10 kB gzip, so it loads once the app is idle or a toast is asked for: see Toast.tsx).
 * Mount once, at the root. Phones: above the tab bar, but at the top while a sheet is open (a bottom sheet would
 * cover them, or they would cover its buttons). Desktop: bottom right. Toasts sit above sheets (app.css) and take
 * presses without closing the sheet (Sheet.tsx ignores presses on them).
 */
export default function ToastHost({ onReady }: { onReady: () => void }) {
  const isDesktop = useIsDesktop();
  // sonner keeps no toast made before its Toaster is mounted: the toast calls wait for this.
  useEffect(onReady, [onReady]);
  const overSheet = useDialogOpen() && !isDesktop;
  return (
    <SonnerToaster
      position={isDesktop ? "bottom-right" : overSheet ? "top-center" : "bottom-center"}
      offset={isDesktop ? 24 : undefined}
      // --sg-actionbar-offset is set while a screen shows its ActionBar, so toasts never cover it.
      mobileOffset={{
        bottom: "calc(var(--sg-tabbar-height) + var(--sg-actionbar-offset, 0rem) + 0.75rem)",
        top: "calc(var(--sg-safe-top, 0px) + 0.75rem)",
      }}
      gap={8}
      icons={{
        success: <CheckCircleIcon size={18} weight="fill" />,
        error: <WarningIcon size={18} weight="fill" />,
      }}
    />
  );
}
