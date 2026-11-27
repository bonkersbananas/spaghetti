import { useEffect } from "react";

export const PENDING = "sg-passkey-ask";

/** Called by a password sign-in: the next screen may quietly offer a passkey for this device. */
export function askForPasskeyAfterSignIn() {
  try {
    sessionStorage.setItem(PENDING, "1");
  } catch {
    // No storage: no offer.
  }
}

/**
 * "Next time, just Face ID?", once per device, after a password sign-in on a device with no passkey. Every screen
 * runs this hook, so it only looks for the sign-in's mark; the offer itself (passkeys, the toast) loads when there is one.
 */
export function usePasskeyOffer() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem(PENDING) !== "1") return;
    } catch {
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void import("./passkey-offer-show").then((m) => {
      if (!stopped) timer = m.offerPasskeyLater();
    });
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
}
