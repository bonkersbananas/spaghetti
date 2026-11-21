/**
 * "Read-only" as a property the tests prove, not a promise: the bridge can only ever send the printer the status
 * request `pushall`, and can only list and download its files. These read the bridge's own source, so a change that
 * adds another publish or an FTP write fails here before it is reviewed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { isPushallRefusal, PUSHALL, readOnlyMessage } from "../../bridge/printer-link.ts";

const root = join(import.meta.dirname, "../../bridge");
const sources = (readdirSync(root, { recursive: true }) as string[])
  .filter((path) => path.endsWith(".ts"))
  .map((path) => ({ path: relative(root, join(root, path)), text: readFileSync(join(root, path), "utf8") }));
/** The code without its comments, so a sentence about uploads in a comment doesn't count. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the printer link sends nothing but pushall", () => {
  it("has the bridge's only MQTT client and its only publish, behind the guard", () => {
    expect(sources.length).toBeGreaterThan(10);
    const mqttUsers = sources.filter((file) => /from "mqtt"/.test(file.text)).map((file) => file.path);
    expect(mqttUsers).toEqual(["printer-link.ts"]);
    const publishes = sources.flatMap((file) =>
      [...code(file.text).matchAll(/\.publish(Async)?\s*\(([^)]*)/g)].map((match) => ({
        path: file.path,
        args: match[2],
      })),
    );
    expect(publishes).toEqual([{ path: "printer-link.ts", args: "message.topic, message.payload, { qos: 0 }" }]);
    const link = code(sources.find((file) => file.path === "printer-link.ts")?.text ?? "");
    expect(link).toMatch(
      /const message = readOnlyMessage\(options\.serial, requestTopic, PUSHALL\);\s*askedAt = Date\.now\(\);\s*client\.publish\(message\.topic/,
    );
    // Nor does anything reach under the client to send a packet of its own.
    for (const file of sources) expect(code(file.text)).not.toMatch(/\b(sendPacket|_sendPacket|_writePacket)\b/);
  });

  it("refuses at the publish anything but pushall on the printer's request topic", () => {
    const serial = "00M09A000000000";
    expect(readOnlyMessage(serial, `device/${serial}/request`, PUSHALL)).toEqual({
      topic: `device/${serial}/request`,
      payload: PUSHALL,
    });
    const commands = [
      { print: { command: "pause", sequence_id: "1" } },
      { print: { command: "project_file", url: "file:///sdcard/x.3mf" } },
      { print: { command: "gcode_line", param: "M104 S250" } },
      { system: { command: "ledctrl", led_node: "chamber_light", led_mode: "on" } },
      { pushing: { sequence_id: "0", command: "pushall" }, print: { command: "stop" } },
    ];
    for (const command of commands) {
      expect(() => readOnlyMessage(serial, `device/${serial}/request`, JSON.stringify(command))).toThrow(/read-only/);
    }
    // The same bytes with other spacing, or another printer's or another topic, are refused too.
    expect(() => readOnlyMessage(serial, `device/${serial}/request`, `${PUSHALL} `)).toThrow();
    expect(() => readOnlyMessage(serial, "device/OTHER/request", PUSHALL)).toThrow();
    expect(() => readOnlyMessage(serial, `device/${serial}/report`, PUSHALL)).toThrow();
  });

  it("knows a refused pushall from a printer's ordinary answers", () => {
    expect(isPushallRefusal({ pushing: { command: "pushall", result: "fail", err_code: 84033543 } })).toBe(true);
    expect(isPushallRefusal({ print: { command: "pushall", result: "FAILED" } })).toBe(true);
    expect(isPushallRefusal({ pushing: { command: "pushall", errno: "84033543" } })).toBe(true);
    expect(isPushallRefusal({ pushing: { command: "pushall", result: "success" } })).toBe(false);
    expect(isPushallRefusal({ print: { command: "push_status", gcode_state: "IDLE", result: "fail" } })).toBe(false);
    expect(isPushallRefusal({ print: { command: "pause", result: "fail", err_code: 1 } })).toBe(false);
    expect(isPushallRefusal(null)).toBe(false);
    expect(isPushallRefusal("pushall")).toBe(false);
  });
});

describe("the printer's files are only listed and read", () => {
  it("has the bridge's only FTP client, and no call that writes, deletes, renames or sends a raw command", () => {
    const ftpUsers = sources.filter((file) => /from "basic-ftp"/.test(file.text)).map((file) => file.path);
    expect(ftpUsers).toEqual(["printer-files.ts"]);
    const files = code(sources.find((file) => file.path === "printer-files.ts")?.text ?? "");
    const writes =
      /\.(uploadFrom|uploadFromDir|appendFrom|remove|removeDir|removeEmptyDir|clearWorkingDir|rename|ensureDir|send|sendIgnoringError|cd|cdup)\s*\(/g;
    expect([...files.matchAll(writes)].map((match) => match[0])).toEqual([]);
    // What it does call on the client: connecting, logging in, listing and downloading, and closing.
    const calls = new Set([...files.matchAll(/client\.(\w+)\s*\(/g)].map((match) => match[1]));
    expect([...calls].sort()).toEqual(
      ["close", "connectImplicitTLS", "downloadTo", "list", "login", "useDefaultSettings"].sort(),
    );
  });
});
