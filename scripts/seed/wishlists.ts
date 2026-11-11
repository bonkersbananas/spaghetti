/**
 * Both people's wishlists: Alex's top five and Sam's top four, with two ideas on both, so the wishlist
 * screen has two lists to compare. Seeded after the builds, so every entry is still an idea.
 */
import type { APIRequestContext } from "@playwright/test";
import { SEED_IDS } from "./ideas.ts";

export const SEED_WISHLISTS = {
  alex: [
    SEED_IDS.spoolHolder,
    SEED_IDS.deskTidy,
    "5eed0000-0000-4000-8000-000000000014", // the router's wall mount
    "5eed0000-0000-4000-8000-000000000007", // the gear set
    "5eed0000-0000-4000-8000-000000000003", // the oven knob
  ],
  sam: [
    "5eed0000-0000-4000-8000-000000000007",
    "5eed0000-0000-4000-8000-000000000011", // the calibration cube
    "5eed0000-0000-4000-8000-000000000013", // the coffee bag clips
    SEED_IDS.deskTidy,
  ],
};

export async function seedWishlists(requests: { alex: APIRequestContext; sam: APIRequestContext }, origin: string) {
  for (const who of ["alex", "sam"] as const) {
    for (const itemId of SEED_WISHLISTS[who]) {
      const response = await requests[who].put(`/api/wishlists/me/items/${itemId}`, {
        headers: { Origin: origin },
        data: {},
      });
      if (!response.ok()) throw new Error(`Seeding ${who}'s wishlist failed: ${response.status()}`);
    }
  }
}
