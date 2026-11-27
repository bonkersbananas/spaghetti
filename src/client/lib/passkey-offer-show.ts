import { toast } from "@/components/ui/Toast";
import { PENDING } from "./passkey-offer";
import { addPasskeyHere, biometric, canOfferPasskey, isCancelled, offerSettled } from "./passkeys";

/**
 * Schedules the offer (a moment after the screen shows) and returns its timer, or nothing when this device can't be
 * offered one. It is settled the moment it shows (taken or dismissed, it never comes back), and it stays until the
 * person answers.
 */
export function offerPasskeyLater(): ReturnType<typeof setTimeout> | undefined {
  if (!canOfferPasskey()) return;
  // A browser driven by a test sits on its sign-in password screens a hundred times, and the offer would cover
  // the sheets under test: it stays quiet there unless a test asks for it (sessionStorage "sg-force-offer").
  if (navigator.webdriver && sessionStorage.getItem("sg-force-offer") !== "1") return;
  // Taken and settled when the toast shows, not before: React's double effect in development must find it still pending.
  return setTimeout(() => {
    try {
      sessionStorage.removeItem(PENDING);
    } catch {
      // Nothing to clear.
    }
    offerSettled();
    toast.offer(`Next time, just ${biometric()}?`, "Sign in with a touch instead of a password.", {
      label: "Set it up",
      onClick: () => {
        void addPasskeyHere().then(
          () => toast.success(`${biometric() === "a passkey" ? "Passkey" : biometric()} is set up`),
          (error) => {
            if (!isCancelled(error)) toast.error("Couldn't set that up", "You can try again from the account menu.");
          },
        );
      },
    });
  }, 1200);
}
