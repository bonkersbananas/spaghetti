import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PairingError } from "../../bridge/mac/pair.ts";
import { LABEL, macPaths } from "../../bridge/mac/paths.ts";
import { launchAgentPlist } from "../../bridge/mac/plist.ts";
import { problemWithSettings, readSettings, writeSettings } from "../../bridge/mac/settings.ts";
import { parseSetupArgs, runSetup, runUninstall, type SetupEnv, SetupStop } from "../../bridge/mac/setup.ts";

let home: string;
let said: string[];
let launchctl: string[][];
let paired: Array<[string, string]>;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "bridge-home-"));
  said = [];
  launchctl = [];
  paired = [];
  const paths = macPaths(home);
  mkdirSync(dirname(paths.binary), { recursive: true });
  writeFileSync(paths.binary, "#!/bin/sh\n");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function env(overrides: Partial<SetupEnv> = {}): SetupEnv {
  return {
    home,
    uid: 501,
    fetch,
    run: (command, args) => {
      launchctl.push([command, ...args]);
      return { ok: true, output: "" };
    },
    ask: null,
    say: (line) => said.push(line),
    discover: async () => [],
    serialOf: async () => null,
    check: async () => ({ ok: true }),
    pair: async (appUrl, code) => {
      paired.push([appUrl, code]);
      return { token: "spg_secret_token", agentId: "a1", appUrl, scopes: ["read", "attempts", "printer"] };
    },
    heardFromBridge: async () => true,
    sleep: async () => {},
    now: () => 1_000,
    ...overrides,
  };
}

const given = { printerHost: "192.168.1.50", serial: "00M09A000000000", accessCode: "12345678" };

describe("the LaunchAgent", () => {
  const paths = macPaths("/Users/marie");
  const plist = launchAgentPlist(paths);

  it("starts at login, restarts when it stops, and logs under ~/Library/Logs", () => {
    expect(plist).toContain(`<key>Label</key>\n  <string>${LABEL}</string>`);
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
    expect(plist).toContain("<string>/Users/marie/Library/Logs/Spaghetti Bridge/bridge.log</string>");
    expect(plist).toContain(
      "<string>/Users/marie/Library/Application Support/Spaghetti Bridge/bin/spaghetti-bridge</string>",
    );
    expect(plist).toMatch(/<string>run<\/string>\s*<string>--config<\/string>/);
  });

  it("is well-formed XML with escaped names and never holds a secret", () => {
    const odd = launchAgentPlist(macPaths("/Users/R&D <x>"));
    expect(odd).toContain("R&amp;D &lt;x&gt;");
    expect(odd).not.toMatch(/spg_|accessCode|token/i);
    expect(plist.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    // Balanced tags: every opening <dict>/<array> is closed.
    for (const tag of ["dict", "array"]) {
      expect(plist.match(new RegExp(`<${tag}>`, "g"))?.length).toBe(plist.match(new RegExp(`</${tag}>`, "g"))?.length);
    }
  });
});

describe("the settings file", () => {
  it("is readable only by its owner, and read back", () => {
    const path = join(home, "x", "config.json");
    writeSettings(path, { ...given, appUrl: "https://spaghetti.day", token: "spg_x", dataDir: "/d" });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readSettings(path).printerHost).toBe("192.168.1.50");
    expect(readSettings(join(home, "missing.json"))).toEqual({});
  });

  it("says what is wrong with an address, a serial number or an access code", () => {
    expect(problemWithSettings(given)).toBeNull();
    expect(problemWithSettings({ ...given, printerHost: "printer" })).toMatch(/address/);
    expect(problemWithSettings({ ...given, printerHost: "x1.local" })).toBeNull();
    expect(problemWithSettings({ ...given, serial: "1" })).toMatch(/serial/);
    expect(problemWithSettings({ ...given, accessCode: "" })).toMatch(/access code/);
  });
});

describe("reading the installer's arguments", () => {
  it("takes the code as the first bare word and flags for the rest", () => {
    expect(
      parseSetupArgs(["ABCD-EFGH", "--app", "http://x", "--ip", "1.2.3.4", "--camera", "off", "--no-check"]),
    ).toEqual({
      code: "ABCD-EFGH",
      appUrl: "http://x",
      printerHost: "1.2.3.4",
      camera: "off",
      noCheck: true,
      noStart: false,
    });
    expect(parseSetupArgs([], { BRIDGE_PRINTER_ACCESS_CODE: "abc12345" }).accessCode).toBe("abc12345");
  });
});

describe("setup", () => {
  it("pairs, saves, installs the login item, starts it and waits to be heard", async () => {
    await runSetup(
      parseSetupArgs(["ABCD-EFGH", "--app", "https://spaghetti.day"]),
      env({
        ask: async (question) =>
          question.includes("IP") ? given.printerHost : question.includes("serial") ? given.serial : given.accessCode,
      }),
    );
    const paths = macPaths(home);
    expect(paired).toEqual([["https://spaghetti.day", "ABCD-EFGH"]]);
    const saved = readSettings(paths.config);
    expect(saved).toMatchObject({
      ...given,
      token: "spg_secret_token",
      appUrl: "https://spaghetti.day",
      dataDir: paths.dataDir,
    });
    expect(statSync(paths.config).mode & 0o777).toBe(0o600);
    expect(readFileSync(paths.plist, "utf8")).toContain(LABEL);
    expect(readFileSync(paths.plist, "utf8")).not.toContain("spg_secret_token");
    expect(launchctl.map((call) => call.join(" "))).toEqual([
      `launchctl bootout gui/501/${LABEL}`,
      `launchctl bootstrap gui/501 ${paths.plist}`,
      `launchctl kickstart -k gui/501/${LABEL}`,
    ]);
    expect(said.join("\n")).toMatch(/Spaghetti heard from the bridge/);
    expect(said.join("\n")).not.toContain("spg_secret_token");
    expect(said.join("\n")).not.toContain(given.accessCode);
  });

  it("uses what discovery finds and only asks for the access code", async () => {
    const asked: string[] = [];
    await runSetup(
      parseSetupArgs(["ABCD-EFGH"]),
      env({
        discover: async () => [{ host: "192.168.1.77", serial: "00M09A111111111", model: "X", name: "Workshop X2D" }],
        ask: async (question) => {
          asked.push(question);
          return given.accessCode;
        },
      }),
    );
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/access code/);
    expect(readSettings(macPaths(home).config)).toMatchObject({
      printerHost: "192.168.1.77",
      serial: "00M09A111111111",
    });
  });

  it("without a terminal and without the details, stops and says how to give them", async () => {
    await expect(runSetup(parseSetupArgs(["ABCD-EFGH"]), env())).rejects.toThrow(/--ip, --serial and --access-code/);
    expect(existsSync(macPaths(home).config)).toBe(false);
    expect(launchctl).toEqual([]);
  });

  it("changes nothing when the printer can't be reached and nobody says to go on", async () => {
    const problem = { code: "local-network" as const, message: "Can't reach the printer: allow Local Network." };
    await expect(
      runSetup(
        parseSetupArgs([
          "ABCD-EFGH",
          "--ip",
          given.printerHost,
          "--serial",
          given.serial,
          "--access-code",
          given.accessCode,
        ]),
        env({ check: async () => ({ ok: false, problem }) }),
      ),
    ).rejects.toThrow(SetupStop);
    expect(said.join("\n")).toContain("allow Local Network");
    expect(existsSync(macPaths(home).config)).toBe(false);
    expect(launchctl).toEqual([]);
  });

  it("explains a spent code in plain words", async () => {
    await expect(
      runSetup(
        parseSetupArgs([
          "ABCD-EFGH",
          "--ip",
          given.printerHost,
          "--serial",
          given.serial,
          "--access-code",
          given.accessCode,
        ]),
        env({
          pair: async () => {
            throw new PairingError(
              "That code was used or has expired. Make a new one on the Printer page in Spaghetti.",
            );
          },
        }),
      ),
    ).rejects.toThrow(/used or has expired/);
  });

  it("needs a code the first time, and running it again keeps the saved connection", async () => {
    await expect(runSetup(parseSetupArgs([]), env())).rejects.toThrow(/pairing code/);
    await runSetup(
      parseSetupArgs([
        "ABCD-EFGH",
        "--ip",
        given.printerHost,
        "--serial",
        given.serial,
        "--access-code",
        given.accessCode,
      ]),
      env(),
    );
    paired.length = 0;
    // An update: no code, the new printer address only.
    await runSetup(parseSetupArgs(["--ip", "192.168.1.60"]), env());
    expect(paired).toEqual([]);
    expect(readSettings(macPaths(home).config)).toMatchObject({
      printerHost: "192.168.1.60",
      token: "spg_secret_token",
      accessCode: given.accessCode,
    });
  });

  it("retries the login item once the old one has finished stopping", async () => {
    let tries = 0;
    await runSetup(
      parseSetupArgs([
        "ABCD-EFGH",
        "--ip",
        given.printerHost,
        "--serial",
        given.serial,
        "--access-code",
        given.accessCode,
      ]),
      env({
        run: (command, args) => {
          launchctl.push([command, ...args]);
          if (args[0] === "bootstrap") return { ok: ++tries > 2, output: "Bootstrap failed: 5: Input/output error" };
          return { ok: true, output: "" };
        },
      }),
    );
    expect(tries).toBe(3);
  });

  it("uninstall stops the login item and removes everything it made", async () => {
    await runSetup(
      parseSetupArgs([
        "ABCD-EFGH",
        "--ip",
        given.printerHost,
        "--serial",
        given.serial,
        "--access-code",
        given.accessCode,
      ]),
      env(),
    );
    const paths = macPaths(home);
    mkdirSync(paths.logDir, { recursive: true });
    writeFileSync(paths.log, "x");
    launchctl.length = 0;
    runUninstall({
      home,
      uid: 501,
      run: (c, a) => (launchctl.push([c, ...a]), { ok: true, output: "" }),
      say: (l) => said.push(l),
    });
    expect(launchctl[0]).toEqual(["launchctl", "bootout", `gui/501/${LABEL}`]);
    for (const path of [paths.plist, paths.appDir, paths.logDir]) expect(existsSync(path)).toBe(false);
    expect(said.join("\n")).toMatch(/Disconnect/);
  });
});
