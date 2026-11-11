import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CertPin } from "../../bridge/pin.ts";
import { ftpFiles } from "../../bridge/printer-files.ts";
import { selfSigned } from "./certificate.ts";
import { FakeFtps } from "./fake-ftps.ts";

let ftps: FakeFtps;
beforeAll(async () => {
  ftps = new FakeFtps();
  ftps.files.set("/bracket_v2.gcode.3mf", Uint8Array.from([1, 2, 3, 4]));
  ftps.files.set("/cache/other.gcode.3mf", Uint8Array.from([9]));
  await ftps.start(selfSigned("00M09A000000000"));
});
afterAll(() => ftps.stop());

describe("the FTPS stand-in", () => {
  it("serves the bridge's list and download, pinned, and nothing else is ever sent", async () => {
    const pin = new CertPin({ certs: {}, save() {} });
    const files = ftpFiles({ host: "127.0.0.1", port: ftps.port, accessCode: ftps.accessCode, pin });
    expect(await files.find(["bracket_v2.gcode.3mf"])).toEqual({ path: "/bracket_v2.gcode.3mf", size: 4 });
    expect(await files.find(["other.gcode.3mf"])).toEqual({ path: "/cache/other.gcode.3mf", size: 1 });
    expect(await files.find(["missing.3mf"])).toBeNull();
    expect([...(await files.download("/bracket_v2.gcode.3mf"))]).toEqual([1, 2, 3, 4]);
    const sent = new Set(ftps.commands);
    for (const verb of ["STOR", "DELE", "RNFR", "RNTO", "MKD", "RMD", "APPE"]) expect(sent.has(verb)).toBe(false);
  });

  it("refuses a wrong access code", async () => {
    const files = ftpFiles({
      host: "127.0.0.1",
      port: ftps.port,
      accessCode: "nope",
      pin: new CertPin({ certs: {}, save() {} }),
    });
    await expect(files.find(["x.3mf"])).rejects.toThrow();
  });
});
