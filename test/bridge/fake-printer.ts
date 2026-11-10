import { createServer, type Server } from "node:net";
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
  private broker!: Aedes;
  private server!: Server;
  url = "";
  connections = 0;

  async start(): Promise<this> {
    this.broker = await Aedes.createBroker();
    this.broker.authenticate = (_client, username, password, done) => {
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
      if (packet.topic === `device/${this.serial}/request` && payload.includes("pushall"))
        this.onFullStatusRequested?.();
    });
    this.server = createServer(this.broker.handle);
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    this.url = `mqtt://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    return this;
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
