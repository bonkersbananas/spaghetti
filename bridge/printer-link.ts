/**
 * The MQTT link to the printer (TLS on 8883, user `bblp`, the access code as the password, a self-signed
 * certificate). It listens to `device/<serial>/report`.
 *
 * Read-only is structural: nothing here, or anywhere else in the bridge, can publish a message of its own choosing.
 * The one thing the link ever sends is `requestFullStatus()`: the status request `pushall`, so that the printer
 * answers with its whole state instead of only changes. It is sent when the link connects (and again on every
 * reconnect). The client object is private to this module and `publish` is called in exactly one place.
 */
import mqtt from "mqtt";

export interface PrinterLink {
  /** Asks the printer for its full state (the status request `pushall`). The only thing this link sends. */
  requestFullStatus(): void;
  close(): Promise<void>;
}

export interface LinkOptions {
  /** "mqtts://192.168.1.20:8883" (TLS); a plain "mqtt://" address is for tests. */
  url: string;
  serial: string;
  accessCode: string;
  onReport: (payload: Uint8Array) => void;
  onConnection: (connected: boolean) => void;
  log?: (message: string) => void;
}

/** The exact payload of the status request. */
export const PUSHALL = JSON.stringify({ pushing: { sequence_id: "0", command: "pushall" } });

export function connectToPrinter(options: LinkOptions): PrinterLink {
  const reportTopic = `device/${options.serial}/report`;
  const requestTopic = `device/${options.serial}/request`;
  const client = mqtt.connect(options.url, {
    username: "bblp",
    password: options.accessCode,
    clientId: `spaghetti-bridge-${Math.random().toString(16).slice(2, 10)}`,
    rejectUnauthorized: false,
    reconnectPeriod: 5_000,
    connectTimeout: 15_000,
    clean: true,
  });

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
  client.on("error", (error) => options.log?.(`Printer link: ${error.message}`));
  client.on("message", (_topic, payload) => options.onReport(payload));

  return { requestFullStatus, close: () => client.endAsync() };
}
