import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Just enough of Spaghetti's API, over HTTP, for the bridge program to run against: it keeps builds, attempts and
 * what the bridge says, and checks the bearer token. The unit tests (test/bridge/fake-app.ts) fake the `Api` class
 * itself; this one is for running the real program, the compiled one included.
 */
export class HttpApp {
  readonly token = "spg_smoke_test_token";
  url = "";
  heartbeats: Array<Record<string, unknown>> = [];
  items = new Map<
    string,
    { id: string; stage: string; title: string | null; attempts: Array<Record<string, unknown>>; photos: unknown[] }
  >();
  files = new Map<string, { name: string; size: number }>();
  requests: string[] = [];
  private server!: Server;

  async start(): Promise<this> {
    this.server = createServer((request, response) => void this.handle(request, response));
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  stop() {
    this.server.closeAllConnections();
    return new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private async handle(request: IncomingMessage, response: import("node:http").ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    const send = (status: number, body: unknown = {}) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.headers.authorization !== `Bearer ${this.token}`) return send(401, { error: { message: "no" } });
    const url = new URL(request.url ?? "/", this.url);
    const path = url.pathname.replace(/^\/api/, "");
    this.requests.push(`${request.method} ${path}`);
    const json = () =>
      raw.length && request.headers["content-type"]?.includes("json") ? JSON.parse(raw.toString()) : {};
    let match: RegExpMatchArray | null;
    if (request.method === "PUT" && path === "/printer/bridge") {
      this.heartbeats.push(json());
      return send(200, { slots: {}, bridge: null });
    }
    if (request.method === "GET" && path === "/items") return send(200, { items: [...this.items.values()] });
    if (request.method === "POST" && path === "/items") {
      const body = json();
      this.items.set(body.id, { id: body.id, stage: body.stage, title: body.title ?? null, attempts: [], photos: [] });
      return send(201, {});
    }
    if (request.method === "GET" && (match = path.match(/^\/items\/([^/]+)$/))) {
      const item = this.items.get(match[1] as string);
      return item ? send(200, { item }) : send(404);
    }
    if (request.method === "POST" && (match = path.match(/^\/items\/([^/]+)\/attempts$/))) {
      const item = this.items.get(match[1] as string);
      if (!item) return send(404);
      const body = json();
      let attempt = item.attempts.find((a) => a.id === body.id);
      if (!attempt) {
        attempt = {
          id: body.id,
          itemId: item.id,
          outcome: null,
          endedAt: null,
          settings: body.settings ?? {},
          file: null,
          createdVia: "agent",
        };
        item.attempts.push(attempt);
      }
      return send(201, { attempt });
    }
    if (request.method === "PUT" && (match = path.match(/^\/attempts\/([^/]+)\/file$/))) {
      // The bridge uploads the slicer file as multipart; only its name and size matter here.
      const text = raw.toString("latin1");
      const name = /name="name"\r\n\r\n([^\r]*)/.exec(text)?.[1] ?? "?";
      const size = Number(/name="size"\r\n\r\n(\d+)/.exec(text)?.[1] ?? 0);
      this.files.set(match[1] as string, { name, size });
      const attempt = [...this.items.values()].flatMap((i) => i.attempts).find((a) => a.id === match?.[1]);
      if (attempt) attempt.file = { id: "f", name };
      return send(200, { attempt });
    }
    if (request.method === "PATCH" && (match = path.match(/^\/attempts\/([^/]+)$/))) {
      const attempt = [...this.items.values()].flatMap((i) => i.attempts).find((a) => a.id === match?.[1]);
      if (!attempt) return send(404);
      Object.assign(attempt, json());
      return send(200, { attempt });
    }
    if (request.method === "PUT" && path.match(/^\/items\/[^/]+\/photos\/[^/]+$/)) return send(200, { photo: {} });
    if (request.method === "GET" && path === "/spools") return send(200, { spools: [] });
    if (path.startsWith("/spools") || path.startsWith("/printer/slots")) return send(200, { spool: {}, slots: {} });
    if (request.method === "GET" && path === "/printer") return send(200, { setup: {}, slots: {}, bridge: null });
    return send(404, { error: { message: `no ${request.method} ${path}` } });
  }
}
