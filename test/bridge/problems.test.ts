import type { AddressInfo } from "node:net";
import tls from "node:tls";
import { describe, expect, it, vi } from "vitest";
import { authPacket, firstFrame, jpegStreamCamera } from "../../bridge/camera.ts";
import { parseSsdp } from "../../bridge/discover.ts";
import { CertPin } from "../../bridge/pin.ts";
import { explainLinkError, Health, silentProblem } from "../../bridge/problems.ts";
import { watchForWake } from "../../bridge/wake.ts";
import { selfSigned } from "./certificate.ts";

const mac = { host: "192.168.1.50", platform: "darwin" as const };
const code = (value: string, message = value) => Object.assign(new Error(message), { code: value });

describe("saying what is wrong", () => {
  it("names macOS's Local Network privacy for 'no route to host' on a Mac, with where to allow it", () => {
    const problem = explainLinkError(code("EHOSTUNREACH", "connect EHOSTUNREACH 192.168.1.50:8883"), mac);
    expect(problem?.code).toBe("local-network");
    expect(problem?.message).toContain("System Settings");
    expect(problem?.message).toContain("Local Network");
    expect(problem?.message).toContain("192.168.1.50");
  });

  it("says the same thing without the macOS part elsewhere", () => {
    const problem = explainLinkError(code("EHOSTUNREACH"), { host: "10.0.0.2", platform: "linux" });
    expect(problem?.code).toBe("unreachable");
    expect(problem?.message).not.toContain("System Settings");
  });

  it("tells a refused connection (LAN Only mode) from a refused login (the access code) from a printer that isn't there", () => {
    expect(explainLinkError(code("ECONNREFUSED"), mac)?.code).toBe("refused");
    expect(
      explainLinkError(Object.assign(new Error("Connection refused: Not authorized"), { code: 5 }), mac)?.code,
    ).toBe("wrong-access-code");
    expect(explainLinkError(Object.assign(new Error("x"), { code: 4 }), mac)?.code).toBe("wrong-access-code");
    expect(explainLinkError(code("ETIMEDOUT"), mac)?.code).toBe("unreachable");
    expect(explainLinkError(new Error("connack timeout"), mac)?.code).toBe("unreachable");
    expect(explainLinkError(new Error("The printer's certificate changed."), mac)?.code).toBe("certificate");
  });

  it("looks inside an aggregate error, as Node's connection attempts give", () => {
    const aggregate = Object.assign(new Error("all failed"), { errors: [code("ECONNREFUSED")] });
    expect(explainLinkError(aggregate, mac)?.code).toBe("refused");
  });

  it("leaves what it doesn't know to the log, and a source clears its own problem", () => {
    expect(explainLinkError(new Error("something odd"), mac)).toBeNull();
    const health = new Health();
    health.set("link", explainLinkError(code("ECONNREFUSED"), mac));
    health.set("silent", silentProblem());
    expect(health.list().map((p) => p.code)).toEqual(["refused", "silent"]);
    health.set("link", null);
    expect(health.list().map((p) => p.code)).toEqual(["silent"]);
  });
});

describe("noticing sleep", () => {
  it("calls back when a look comes much later than it should, and not for a normal one", () => {
    vi.useFakeTimers();
    try {
      let clock = 0;
      const woke: number[] = [];
      const stop = watchForWake((ms) => woke.push(ms), { everyMs: 5_000, gapMs: 20_000, now: () => clock });
      clock += 5_000;
      vi.advanceTimersByTime(5_000);
      expect(woke).toEqual([]);
      clock += 8 * 60_000; // the lid was closed
      vi.advanceTimersByTime(5_000);
      expect(woke).toEqual([8 * 60_000 + 5_000 - 5_000]);
      clock += 5_000;
      vi.advanceTimersByTime(5_000);
      expect(woke).toHaveLength(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("finding the printer by its announcement", () => {
  const notify = [
    "NOTIFY * HTTP/1.1",
    "HOST: 239.255.255.250:1990",
    "Server: UPnP/1.0",
    "Location: 192.168.1.77",
    "NT: urn:bambulab-com:device:3dprinter:1",
    "USN: 00M09A111111111",
    "Cache-Control: max-age=1800",
    "DevModel.bambu.com: N7",
    "DevName.bambu.com: Workshop X2D",
    "DevConnect.bambu.com: lan",
  ].join("\r\n");

  it("reads the address, serial number, model and name", () => {
    expect(parseSsdp(notify)).toEqual({
      host: "192.168.1.77",
      serial: "00M09A111111111",
      model: "N7",
      name: "Workshop X2D",
    });
  });

  it("ignores other devices' announcements and anything odd", () => {
    expect(parseSsdp("NOTIFY * HTTP/1.1\r\nLocation: 192.168.1.9\r\nUSN: uuid:abc::upnp:rootdevice")).toBeNull();
    expect(parseSsdp(notify.replace("192.168.1.77", "not-an-address"))).toBeNull();
    expect(parseSsdp("garbage")).toBeNull();
  });
});

describe("a camera frame without ffmpeg", () => {
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, ...new Array(2000).fill(7), 0xff, 0xd9]);

  it("builds the picture stream's 80-byte login", () => {
    const packet = authPacket("12345678");
    expect(packet).toHaveLength(80);
    expect(packet.readUInt32LE(0)).toBe(0x40);
    expect(packet.subarray(16, 20).toString()).toBe("bblp");
    expect(packet.subarray(48, 56).toString()).toBe("12345678");
  });

  it("logs in over TLS (pinned), reads one frame, and sends nothing else", async () => {
    const received: Buffer[] = [];
    const server = tls.createServer(selfSigned("printer"), (socket) => {
      socket.on("error", () => {});
      socket.on("data", (chunk) => {
        received.push(Buffer.from(chunk));
        const header = Buffer.alloc(16);
        header.writeUInt32LE(JPEG.length, 0);
        socket.write(Buffer.concat([header, JPEG]));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const pin = new CertPin({ certs: {}, save() {} });
      const frame = await jpegStreamCamera({ host: "127.0.0.1", port, accessCode: "12345678", pin }).grab();
      expect(frame && [...frame.subarray(0, 2)]).toEqual([0xff, 0xd8]);
      expect(received).toHaveLength(1);
      expect(received[0]).toHaveLength(80);
      // A different certificate on the next visit: no login is sent at all.
      received.length = 0;
      const other = tls.createServer(selfSigned("impostor"), (socket) => {
        socket.on("error", () => {});
        socket.on("data", (chunk) => received.push(Buffer.from(chunk)));
      });
      await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
      const otherPort = (other.address() as AddressInfo).port;
      const swapped = new CertPin({ certs: { chamber: pin && "00:11" }, save() {} });
      expect(
        await jpegStreamCamera({
          host: "127.0.0.1",
          port: otherPort,
          accessCode: "12345678",
          pin: swapped,
          timeoutMs: 1500,
        }).grab(),
      ).toBeNull();
      expect(received).toHaveLength(0);
      other.close();
    } finally {
      server.close();
    }
  });

  it("gives null when the port is closed, and the first camera that has a frame wins", async () => {
    expect(await jpegStreamCamera({ host: "127.0.0.1", port: 1, accessCode: "x", timeoutMs: 1500 }).grab()).toBeNull();
    const frame = new Uint8Array([1]);
    expect(
      await firstFrame(
        { grab: async () => null },
        { grab: async () => frame },
        { grab: async () => new Uint8Array([2]) },
      ).grab(),
    ).toBe(frame);
    expect(
      await firstFrame({
        grab: async () => {
          throw new Error("x");
        },
      }).grab(),
    ).toBeNull();
  });
});
