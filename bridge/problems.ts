/**
 * What is wrong, in plain words. The printer link's errors (a Node socket error, an MQTT refusal, a changed
 * certificate) become a `BridgeProblem` the Printer page shows and the log repeats. Pure: no sockets here.
 *
 * macOS Local Network privacy [uncertain, see docs/bridge.md]: a program that isn't allowed to reach the local
 * network gets EHOSTUNREACH ("No route to host") for addresses on the LAN, with no other sign. The same error is
 * what a printer that is off or on another network gives, so the sentence names both.
 */
import type { BridgeProblem } from "../src/shared/bridge.ts";

export interface ProblemContext {
  host: string;
  platform?: NodeJS.Platform;
}

const codeOf = (error: unknown): string | undefined => {
  const e = error as { code?: unknown; errors?: unknown[]; cause?: unknown } | null;
  if (typeof e?.code === "string") return e.code;
  if (Array.isArray(e?.errors) && e.errors.length) return codeOf(e.errors[0]);
  return e?.cause ? codeOf(e.cause) : undefined;
};

const textOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The "mqtt" package reports a refused login as an error with code 4 or 5 ("Not authorized"). */
const loginRefused = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 4 || code === 5 || /not authorized|bad user ?name or password/i.test(textOf(error));
};

export const LOCAL_NETWORK_HELP =
  "open System Settings → Privacy & Security → Local Network and turn on Spaghetti Bridge (if it isn't listed, run `spaghetti-bridge check` once in Terminal and allow Terminal there)";

export function explainLinkError(error: unknown, context: ProblemContext): BridgeProblem | null {
  const code = codeOf(error);
  const message = textOf(error);
  if (/certificate changed/i.test(message)) {
    return {
      code: "certificate",
      message:
        "The printer's certificate changed, so the bridge stopped sending the access code. If you updated or reset the printer, accept the new one (see the bridge guide); if not, something else on the network may be answering as the printer.",
    };
  }
  if (loginRefused(error)) {
    return {
      code: "wrong-access-code",
      message:
        "The printer refused the access code. Read it again on the printer's screen and run the installer again.",
    };
  }
  if (code === "EHOSTUNREACH" || /no route to host/i.test(message)) {
    return {
      code: context.platform === "darwin" ? "local-network" : "unreachable",
      message:
        context.platform === "darwin"
          ? `Can't reach the printer at ${context.host}. If it is on and on this network, macOS may be blocking Spaghetti Bridge from the local network: ${LOCAL_NETWORK_HELP}.`
          : `Can't reach the printer at ${context.host}. Is it on, and on the same network as this computer?`,
    };
  }
  if (code === "ECONNREFUSED") {
    return {
      code: "refused",
      message: `The printer at ${context.host} refused the connection. LAN Only mode may be off on the printer (and on some firmware Developer mode is needed too).`,
    };
  }
  if (
    code === "ETIMEDOUT" ||
    code === "ENETUNREACH" ||
    code === "EHOSTDOWN" ||
    code === "ENOTFOUND" ||
    /timed? ?out/i.test(message)
  ) {
    return {
      code: "unreachable",
      message: `Can't find the printer at ${context.host}. Is it on, on the same network, and is that still its address? (Giving it a fixed address in the router stops it changing.)`,
    };
  }
  return null;
}

/** Connected, but the printer never said anything. */
export const silentProblem = (): BridgeProblem => ({
  code: "silent",
  message:
    "The printer is connected but isn't telling the bridge anything. Check that LAN Only mode is on, and try Developer mode on the printer if it has one.",
});

/** What is wrong right now, by where it came from, so a source clears its own problem when it heals. */
export class Health {
  private problems = new Map<string, BridgeProblem>();
  set(source: string, problem: BridgeProblem | null) {
    if (problem) this.problems.set(source, problem);
    else this.problems.delete(source);
  }
  list(): BridgeProblem[] {
    return [...this.problems.values()];
  }
}
