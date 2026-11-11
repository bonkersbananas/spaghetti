/**
 * The MQTT link to the printer (TLS on 8883, user `bblp`, the access code as the password, a self-signed
 * certificate). It listens to `device/<serial>/report`.
 *
 * Read-only is structural: nothing here, or anywhere else in the bridge, can publish a message of its own choosing.
 * The one thing the link ever sends is `requestFullStatus()`: the status request `pushall`, so that the printer
 * answers with its whole state instead of only changes. It is sent when the link connects (and again on every
 * reconnect). The client object is private to this module and `publish` is called in exactly one place.
 */
import tls from "node:tls";
import mqtt, { MqttClient } from "mqtt";
import { type CertPin, fingerprintOf } from "./pin.ts";

export interface PrinterLink {
  /** Asks the printer for its full state (the status request `pushall`). The only thing this link sends. */
  requestFullStatus(): void;
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
}

/** The exact payload of the status request. */
export const PUSHALL = JSON.stringify({ pushing: { sequence_id: "0", command: "pushall" } });

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

  const requestFullStatus = () => {
    client.publish(requestTopic, PUSHALL, { qos: 0 });
  };

  client.on("connect", () => {
    client.subscribe(reportTopic, { qos: 0 }, (error) => {
      if (error) options.log?.(`Couldn't listen to the printer: ${error.message}`);
      else requestFullStatus();
    });
    options.onConnection(true);
  });
  client.on("close", () => options.onConnection(false));
  client.on("error", (error) => {
    options.log?.(`Printer link: ${error.message}`);
    options.onError?.(error);
  });
  client.on("message", (_topic, payload) => options.onReport(payload));

  return {
    requestFullStatus,
    restart: () => client.reconnect(),
    close: () => client.endAsync(),
  };
}
