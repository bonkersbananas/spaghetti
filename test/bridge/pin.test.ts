import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CertPin } from "../../bridge/pin.ts";
import { connectToPrinter, PUSHALL } from "../../bridge/printer-link.ts";
import { FakePrinter } from "./fake-printer.ts";

let dir: string;
const certificate = (name: string) => {
  const key = join(dir, `${name}.key`);
  const cert = join(dir, `${name}.crt`);
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "2",
      "-subj",
      `/CN=${name}`,
    ],
    {
      stdio: "ignore",
    },
  );
  return { key: readFileSync(key, "utf8"), cert: readFileSync(cert, "utf8") };
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "bridge-certs-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function storage() {
  return {
    certs: {} as Record<string, string>,
    saves: 0,
    save() {
      this.saves++;
    },
  };
}

describe("pinning the printer's certificate", () => {
  it("trusts the first certificate, accepts it again, refuses another, and accepts it when told to", () => {
    const store = storage();
    const logs: string[] = [];
    const pin = new CertPin(store, { log: (m) => logs.push(m) });
    expect(pin.check("mqtt", "AA:01")).toBeNull();
    expect(store.certs.mqtt).toBe("AA:01");
    expect(pin.check("mqtt", "AA:01")).toBeNull();
    const refused = pin.check("mqtt", "BB:02");
    expect(refused).toContain("AA:01");
    expect(refused).toContain("BB:02");
    expect(refused).toContain("--trust-new-certificate");
    expect(store.certs.mqtt).toBe("AA:01");
    // Each service has its own pin.
    expect(pin.check("ftps", "BB:02")).toBeNull();
    const trusting = new CertPin(store, { trustNew: true, log: (m) => logs.push(m) });
    expect(trusting.check("mqtt", "BB:02")).toBeNull();
    expect(store.certs.mqtt).toBe("BB:02");
    // The refusal is logged once, not on every reconnect.
    pin.check("mqtt", "CC:03");
    pin.check("mqtt", "CC:03");
    expect(logs.filter((m) => m.includes("changed"))).toHaveLength(1);
  });

  it("over MQTT: pins the first printer, and a second certificate never gets the access code", async () => {
    const real = await new FakePrinter().start(certificate("printer"));
    const impostor = await new FakePrinter().start(certificate("impostor"));
    const store = storage();
    const logs: string[] = [];
    const pin = new CertPin(store, { log: (m) => logs.push(m) });
    const connect = (printer: FakePrinter) =>
      connectToPrinter({
        url: printer.url,
        serial: printer.serial,
        accessCode: printer.accessCode,
        onReport: () => {},
        onConnection: () => {},
        pin,
        log: (m) => logs.push(m),
      });
    try {
      const first = connect(real);
      await expect.poll(() => real.published.length, { timeout: 5000 }).toBe(1);
      expect(real.published[0]?.payload).toBe(PUSHALL);
      expect(store.certs.mqtt).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/);
      await first.close();

      // Something else answers on the printer's address with its own certificate.
      const second = connect(impostor);
      await expect.poll(() => logs.some((m) => m.includes("certificate changed")), { timeout: 5000 }).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(impostor.logins).toEqual([]);
      expect(impostor.published).toEqual([]);
      await second.close();
    } finally {
      await real.stop();
      await impostor.stop();
    }
  }, 20_000);
});
