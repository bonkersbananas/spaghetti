import { useEffect } from "react";
import { toast } from "@/components/ui/Toast";
import { addPasskeyHere, biometric, canOfferPasskey, isCancelled, offerSettled } from "./passkeys";

const PENDING = "sg-passkey-ask";

/** Called by a password sign-in: the next screen may quietly offer a passkey for this device. */
export function askForPasskeyAfterSignIn() {
  try {
    sessionStorage.setItem(PENDING, "1");
  } catch {
    // No storage: no offer.
  }
}

/**
 * "Next time, just Face ID?", once per device, after a password sign-in on a device with no passkey. It is
 * settled the moment it shows (taken or dismissed, it never comes back), and it stays until the person answers.
 */
export function usePasskeyOffer() {
  useEffect(() => {
    let asked = false;
    try {
      asked = sessionStorage.getItem(PENDING) === "1";
    } catch {
      return;
    }
    if (!asked || !canOfferPasskey()) return;
    // Taken and settled when the toast shows, not before: React's double effect in development must find it still pending.
    const timer = setTimeout(() => {
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
    return () => clearTimeout(timer);
  }, []);
}
