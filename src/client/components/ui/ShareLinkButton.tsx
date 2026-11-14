import { IconButton } from "@/components/ui/Button";
import { ShareIcon } from "@/components/ui/icons";
import { toast } from "@/components/ui/Toast";
import { useIsDesktop } from "@/lib/use-media-query";

/** The page's own address on the app's origin, without a photo or tab picked in the query. */
const pageLink = () => `${window.location.origin}${window.location.pathname}`;

async function share(title: string, canShare: boolean) {
  const url = pageLink();
  if (canShare && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: title || "Spaghetti", url });
      return;
    } catch (error) {
      // Closing the share sheet is not an error; anything else falls back to copying.
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied", "Only the two of you can open it.");
  } catch {
    toast.error("Couldn't copy the link", "It is in the address bar.");
  }
}

/**
 * The share button in a detail page's bar (idea, build, twist), always the same place: before the delete button.
 * Phones open the system share sheet (it matters most in the installed app, which has no address bar); computers
 * copy the link and say so in a toast. The link opens the page for the two people signed in, nothing is public.
 */
export function ShareLinkButton({ title }: { title?: string }) {
  const isDesktop = useIsDesktop();
  const canShare = !isDesktop && typeof navigator !== "undefined" && "share" in navigator;
  return (
    <IconButton
      icon={ShareIcon}
      label={canShare ? "Share link" : "Copy link"}
      title={canShare ? "Share link" : "Copy link"}
      onClick={() => void share(title ?? "", canShare)}
    />
  );
}
