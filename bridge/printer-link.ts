/**
 * The MQTT link to the printer (TLS on 8883, user `bblp`, the access code as the password, a self-signed
 * certificate). It listens to `device/<serial>/report`.
 *
 * Read-only is structural: nothing here, or anywhere else in the bridge, can publish a message of its own choosing.
 * The one thing the link ever sends is the status request `pushall`, so that the printer answers with its whole state
 * instead of only changes. It is sent when the link connects (and again on every reconnect). The client object is
 * private to this module, `publish` is called in exactly one place, and that place passes every message through
 * `readOnlyMessage`, which throws for anything but `pushall` on the request topic (test/bridge/read-only.test.ts
 * proves both).
 *
 * A printer in cloud mode may refuse `pushall` (Bambu's authorization firmware checks commands; whether it counts this
 * one is [uncertain] for the X2D): it may answer it with an error, or drop the connection right after it. Either way
 * the link stops asking, for as long as it runs, and only listens: the printer still pushes its reports, and the X
 * series sends its whole state in each one. Asking again on every reconnect would be a loop of connect, ask, dropped.
 * One drop could be a printer that happened to restart, so it takes two in a row, each within `dropWindowMs` of the
 * request (a connection that outlives the window clears the count); an error answer counts at once.
 */
import tls from "node:tls";
import mqtt, { MqttClient } from "mqtt";
import { type CertPin, fingerprintOf } from "./pin.ts";

export interface PrinterLink {
  /**
   * Asks the printer for its full state (the status request `pushall`). The only thing this link sends; it sends
   * nothing once the printer has refused it.
   */
  requestFullStatus(): void;
  /** Whether the printer refused `pushall`, and how; null while it hasn't. */
  readonly pushallRefused: PushallRefusal | null;
  /** Drops the connection and connects again (after the computer woke, or the printer's address changed). */
  restart(): void;
  close(): Promise<void>;
}

export interface LinkOptions {
  /**
   * "mqtts://192.168.1.20:8883" (TLS); a plain "mqtt://" address is for tests. A function is asked at every
   * connection, so a changed address is picked up.
   */
  url: string | (() => string);
  serial: string;
  accessCode: string;
  onReport: (payload: Uint8Array) => void;
  onConnection: (connected: boolean) => void;
  /** Called with each error the link meets (a refused login, no route…), so the bridge can say what is wrong. */
  onError?: (error: Error) => void;
  log?: (message: string) => void;
  /** Pins the printer's certificate; without it a TLS address is not verified at all (tests only). */
  pin?: CertPin;
  /** Called once, when the printer refuses `pushall`: from then on the link only listens. */
  onPushallRefused?: (how: PushallRefusal) => void;
  /** A connection that closes this soon after `pushall` counts as the printer refusing it. */
  dropWindowMs?: number;
}

/**
 * "answered-error": the printer answered `pushall` with an error; "dropped": it closed the connection right after it,
 * twice in a row.
 */
export type PushallRefusal = "answered-error" | "dropped";

/** How soon after `pushall` a closed connection counts as the printer refusing it. */
export const PUSHALL_DROP_WINDOW_MS = 10_000;

/** The exact payload of the status request. */
export const PUSHALL = JSON.stringify({ pushing: { sequence_id: "0", command: "pushall" } });

/**
 * The guard at the link's one publish: the message, if it is the status request on this printer's request topic.
 * Anything else throws, so no change elsewhere can make the bridge send the printer a command.
 */
export function readOnlyMessage(serial: string, topic: string, payload: string): { topic: string; payload: string } {
  if (topic !== `device/${serial}/request` || payload !== PUSHALL) {
    throw new Error("The bridge is read-only: it only ever sends the printer the status request pushall.");
  }
  return { topic, payload };
}

/**
 * Whether a report is the printer refusing `pushall`: an answer about the command `pushall` (in any part of the
 * report) that carries a result other than success, or a non-zero error code. [uncertain] what an X2D sends: this is
 * the shape of Bambu's other refused commands (`result: "fail"`, `err_code`, `reason`).
 */
export function isPushallRefusal(report: unknown): boolean {
  if (!report || typeof report !== "object") return false;
  for (const part of Object.values(report as Record<string, unknown>)) {
    if (!part || typeof part !== "object") continue;
    const answer = part as Record<string, unknown>;
    if (answer.command !== "pushall") continue;
    const result = typeof answer.result === "string" ? answer.result.toLowerCase() : null;
    if (result && result !== "success" && result !== "ok") return true;
    for (const key of ["err_code", "errno", "error_code"]) {
      const code = answer[key];
      if ((typeof code === "number" && code !== 0) || (typeof code === "string" && code !== "" && code !== "0")) {
        return true;
      }
    }
  }
  return false;
}

export function connectToPrinter(options: LinkOptions): PrinterLink {
  const reportTopic = `device/${options.serial}/report`;
  const requestTopic = `device/${options.serial}/request`;
  const clientOptions = {
    username: "bblp",
    password: options.accessCode,
    clientId: `spaghetti-bridge-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 5_000,
    connectTimeout: 15_000,
    clean: true,
  };
  const current = () => new URL(typeof options.url === "function" ? options.url() : options.url);
  const first = current();
  const client =
    first.protocol === "mqtts:"
      ? new MqttClient(() => {
          const address = current();
          // The certificate is self-signed, so it isn't verified by a CA: its fingerprint is pinned instead. The
          // socket is corked, so the MQTT login (with the access code) waits in memory until the check passes.
          const socket = tls.connect({
            host: address.hostname,
            port: Number(address.port || 8883),
            rejectUnauthorized: false,
          });
          socket.cork();
          socket.once("secureConnect", () => {
            const refused = options.pin?.check("mqtt", fingerprintOf(socket));
            if (refused) socket.destroy(new Error("The printer's certificate changed."));
            else socket.uncork();
          });
          return socket;
        }, clientOptions)
      : mqtt.connect(typeof options.url === "string" ? options.url : first.toString(), clientOptions);

  let refused: PushallRefusal | null = null;
  let askedAt = 0;
  let dropsAfterAsking = 0;
  let survived: ReturnType<typeof setTimeout> | undefined;
  const dropWindowMs = options.dropWindowMs ?? PUSHALL_DROP_WINDOW_MS;
  /** Set while the link itself closes the connection (a restart, the end), which is no refusal. */
  let closingOnPurpose = false;
  const refuse = (how: PushallRefusal) => {
    if (refused) return;
    refused = how;
    options.log?.(
      how === "dropped"
        ? "The printer dropped the connection right after the status request (pushall), so the bridge won't ask again and only listens."
        : "The printer refused the status request (pushall), so the bridge won't ask again and only listens.",
    );
    options.onPushallRefused?.(how);
  };

  const requestFullStatus = () => {
    if (refused) return;
    const message = readOnlyMessage(options.serial, requestTopic, PUSHALL);
    askedAt = Date.now();
    client.publish(message.topic, message.payload, { qos: 0 });
    clearTimeout(survived);
    survived = setTimeout(() => {
      if (client.connected) dropsAfterAsking = 0;
    }, dropWindowMs);
    survived.unref?.();
  };

  client.on("connect", () => {
    closingOnPurpose = false;
    client.subscribe(reportTopic, { qos: 0 }, (error) => {
      if (error) options.log?.(`Couldn't listen to the printer: ${error.message}`);
      else requestFullStatus();
    });
    options.onConnection(true);
  });
  client.on("close", () => {
    if (!closingOnPurpose && askedAt && Date.now() - askedAt < dropWindowMs && ++dropsAfterAsking >= 2) {
      refuse("dropped");
    }
    askedAt = 0;
    options.onConnection(false);
  });
  client.on("error", (error) => {
    options.log?.(`Printer link: ${error.message}`);
    options.onError?.(error);
  });
  client.on("message", (_topic, payload) => {
    if (!refused && isPushallRefusal(parseJson(payload))) refuse("answered-error");
    options.onReport(payload);
  });

  return {
    requestFullStatus,
    get pushallRefused() {
      return refused;
    },
    restart: () => {
      closingOnPurpose = true;
      client.reconnect();
    },
    close: () => {
      closingOnPurpose = true;
      clearTimeout(survived);
      return client.endAsync();
    },
  };
}

function parseJson(payload: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return null;
  }
}
