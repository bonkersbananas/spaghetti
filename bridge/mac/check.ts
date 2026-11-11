/**
 * "Can this computer reach the printer?" asked the way the bridge will: connect to its MQTT service, log in with
 * the access code and wait for it to say something. Used by the installer (so a problem is found while the person
 * is still in Terminal, where macOS can also ask about Local Network access) and by `spaghetti-bridge check`.
 * Read-only like the bridge itself: it listens and sends one `pushall`.
 */
import { join } from "node:path";
import type { BridgeProblem } from "../../src/shared/bridge.ts";
import { CertPin } from "../pin.ts";
import { connectToPrinter } from "../printer-link.ts";
import { explainLinkError, silentProblem } from "../problems.ts";
import { Store } from "../store.ts";

export type CheckResult = { ok: true } | { ok: false; problem: BridgeProblem };

export interface CheckOptions {
  host: string;
  serial: string;
  accessCode: string;
  dataDir: string;
  /** Plain "mqtt://" address, for tests. */
  mqttUrl?: string;
  timeoutMs?: number;
  platform?: NodeJS.Platform;
  trustNewCertificate?: boolean;
}

export function checkPrinter(options: CheckOptions): Promise<CheckResult> {
  const store = new Store(join(options.dataDir, "state.json"));
  const pin = new CertPin(
    { certs: store.certs, save: () => store.save() },
    { trustNew: options.trustNewCertificate ?? false },
  );
  return new Promise((resolve) => {
    let connected = false;
    let problem: BridgeProblem | null = null;
    let settled = false;
    const finish = (result: CheckResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void link.close().catch(() => {});
      resolve(result);
    };
    const link = connectToPrinter({
      url: options.mqttUrl ?? `mqtts://${options.host}:8883`,
      serial: options.serial,
      accessCode: options.accessCode,
      pin: options.mqttUrl ? undefined : pin,
      onReport: () => finish({ ok: true }),
      onConnection: (up) => {
        if (up) connected = true;
      },
      onError: (error) => {
        problem =
          explainLinkError(error, { host: options.host, platform: options.platform ?? process.platform }) ?? problem;
        // A refused login or a changed certificate won't get better by waiting.
        if (problem && (problem.code === "wrong-access-code" || problem.code === "certificate")) {
          finish({ ok: false, problem });
        }
      },
    });
    const timer = setTimeout(() => {
      finish({
        ok: false,
        problem:
          problem ??
          (connected
            ? silentProblem()
            : (explainLinkError(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }), {
                host: options.host,
                platform: options.platform ?? process.platform,
              }) ?? silentProblem())),
      });
    }, options.timeoutMs ?? 20_000);
  });
}
