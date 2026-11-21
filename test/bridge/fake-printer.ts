import { createServer, type Server } from "node:net";
import tls from "node:tls";
import { Aedes, type PublishPacket } from "aedes";
import type { Report } from "./fixtures.ts";

/**
 * A printer's MQTT broker, in this process on a free port (plain MQTT: the TLS on 8883 is the real printer's, and
 * the bridge treats the address as a setting). It records every message a client publishes, and replays reports on
 * `device/<serial>/report`.
 */
export class FakePrinter {
  readonly serial = "00M09A000000000";
  readonly accessCode = "12345678";
  published: Array<{ topic: string; payload: string }> = [];
  subscribed: string[] = [];
  /** Called when a client connects: how a test plays the printer's answer to `pushall`. */
  onFullStatusRequested: (() => void) | undefined;
  /**
   * Plays a printer in cloud mode that won't take `pushall`: "error" answers it with a refusal on the report topic,
   * "drop" closes the connection that sent it.
   */
  refusePushall: "error" | "drop" | null = null;
  private broker!: Aedes;
  private server!: Server;
  url = "";
  connections = 0;
  /** Every login attempt, with the password it carried: an impostor must never see the real one. */
  logins: string[] = [];

  async start(certificate?: { key: string; cert: string }): Promise<this> {
    this.broker = await Aedes.createBroker();
    this.broker.authenticate = (_client, username, password, done) => {
      this.logins.push(password?.toString() ?? "");
      const ok = username === "bblp" && password?.toString() === this.accessCode;
      done(null, ok);
    };
    this.broker.on("client", () => {
      this.connections++;
    });
    this.broker.on("subscribe", (subscriptions) => {
      this.subscribed.push(...subscriptions.map((subscription) => subscription.topic));
    });
    this.broker.on("publish", (packet: PublishPacket, client) => {
      if (!client) return; // our own replays
      const payload = packet.payload.toString();
      this.published.push({ topic: packet.topic, payload });
      if (packet.topic !== `device/${this.serial}/request` || !payload.includes("pushall")) return;
      if (this.refusePushall === "drop") setTimeout(() => client.close(), 5);
      else if (this.refusePushall === "error") void this.answer(REFUSED_PUSHALL);
      else this.onFullStatusRequested?.();
    });
    this.server = certificate ? tls.createServer(certificate, this.broker.handle) : createServer(this.broker.handle);
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    this.url = `${certificate ? "mqtts" : "mqtt"}://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    return this;
  }

  /** Sends one message on the report topic, as the printer would. */
  answer(message: unknown): Promise<void> {
    return new Promise<void>((resolve) => {
      this.broker.publish(
        {
          cmd: "publish",
          qos: 0,
          dup: false,
          retain: false,
          topic: `device/${this.serial}/report`,
          payload: Buffer.from(JSON.stringify(message)),
        },
        () => resolve(),
      );
    });
  }

  /** Sends reports as the printer would, one after another. */
  async replay(reports: readonly Report[], gapMs = 5): Promise<void> {
    for (const report of reports) {
      await new Promise<void>((resolve) => {
        this.broker.publish(
          {
            cmd: "publish",
            qos: 0,
            dup: false,
            retain: false,
            topic: `device/${this.serial}/report`,
            payload: Buffer.from(JSON.stringify(report)),
          },
          () => resolve(),
        );
      });
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  }

  /** Cuts every connection, as a printer that rebooted would. */
  dropClients() {
    const { clients } = this.broker as unknown as { clients: Record<string, { close(): void }> };
    for (const client of Object.values(clients)) client.close();
  }

  async stop() {
    await new Promise<void>((resolve) => this.broker.close(() => resolve()));
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

/**
 * A refusal in the shape of Bambu's other refused commands (`result: "fail"`, an `err_code`, a `reason`): what an X2D
 * in cloud mode sends, if it refuses `pushall` at all, is [uncertain].
 */
export const REFUSED_PUSHALL = {
  pushing: { command: "pushall", sequence_id: "0", result: "fail", reason: "verify failed", err_code: 84033543 },
};
