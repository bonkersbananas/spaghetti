import type { AddressInfo } from "node:net";
import tls from "node:tls";

/**
 * The printer's SD card, as far as the bridge asks: an FTP server over implicit TLS with the user `bblp`, serving
 * `files` (path → bytes) to LIST and RETR, and nothing else. Every command is recorded, so a test can check that the
 * bridge only listed and downloaded. Not a real FTP server: just what basic-ftp sends.
 */
export class FakeFtps {
  readonly accessCode: string;
  files = new Map<string, Uint8Array>();
  commands: string[] = [];
  port = 0;
  private server!: tls.Server;
  private dataServers = new Set<tls.Server>();

  constructor(accessCode = "12345678") {
    this.accessCode = accessCode;
  }

  async start(certificate: { key: string; cert: string }): Promise<this> {
    this.server = tls.createServer(certificate, (socket) => this.control(socket, certificate));
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  async stop() {
    for (const server of this.dataServers) server.close();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private control(socket: tls.TLSSocket, certificate: { key: string; cert: string }) {
    socket.on("error", () => {});
    const reply = (text: string) => socket.write(`${text}\r\n`);
    let user = "";
    let data: Promise<tls.TLSSocket> | null = null;
    reply("220 Fake printer ready");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (let end = buffer.indexOf("\r\n"); end >= 0; end = buffer.indexOf("\r\n")) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const [verb = "", ...rest] = line.split(" ");
        const argument = rest.join(" ");
        const command = verb.toUpperCase();
        this.commands.push(command);
        switch (command) {
          case "USER":
            user = argument;
            reply("331 Password please");
            break;
          case "PASS":
            if (user === "bblp" && argument === this.accessCode) reply("230 Logged in");
            else reply("530 Login incorrect");
            break;
          case "FEAT":
            socket.write("211-Features:\r\n UTF8\r\n211 End\r\n");
            break;
          case "OPTS":
          case "PBSZ":
          case "PROT":
          case "TYPE":
          case "STRU":
          case "MODE":
          case "NOOP":
            reply(command === "PROT" ? "200 Protection set" : "200 OK");
            break;
          case "PWD":
            reply('257 "/"');
            break;
          case "QUIT":
            reply("221 Bye");
            socket.end();
            break;
          case "PASV":
          case "EPSV": {
            const server = tls.createServer(certificate);
            this.dataServers.add(server);
            data = new Promise((resolve) => server.once("secureConnection", resolve));
            server.listen(0, "127.0.0.1", () => {
              const port = (server.address() as AddressInfo).port;
              if (command === "EPSV") reply(`229 Entering Extended Passive Mode (|||${port}|)`);
              else reply(`227 Entering Passive Mode (127,0,0,1,${port >> 8},${port & 255})`);
            });
            break;
          }
          case "LIST": {
            const dir = (argument.split(" ").find((part) => !part.startsWith("-")) ?? "/").replace(/\/+$/, "") || "/";
            const entries = [...this.files].filter(([path]) => (path.slice(0, path.lastIndexOf("/")) || "/") === dir);
            const listing = entries
              .map(
                ([path, bytes]) =>
                  `-rw-r--r-- 1 bblp bblp ${bytes.length} Jan 01 12:00 ${path.slice(path.lastIndexOf("/") + 1)}`,
              )
              .join("\r\n");
            void this.transfer(reply, data, Buffer.from(listing ? `${listing}\r\n` : ""));
            break;
          }
          case "RETR": {
            const bytes = this.files.get(argument);
            if (!bytes) reply("550 No such file");
            else void this.transfer(reply, data, Buffer.from(bytes));
            break;
          }
          default:
            reply("502 Not here");
        }
      }
    });
  }

  private async transfer(reply: (text: string) => void, data: Promise<tls.TLSSocket> | null, payload: Buffer) {
    if (!data) return reply("425 Use PASV first");
    reply("150 Here it comes");
    const socket = await data;
    socket.on("error", () => {});
    await new Promise<void>((resolve) => socket.end(payload, resolve));
    reply("226 Done");
  }
}
