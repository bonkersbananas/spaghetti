import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APP_NAME, LABEL, macPaths } from "../../bridge/mac/paths.ts";

const script = join(process.cwd(), "public/bridge/install.sh");
const source = readFileSync(script, "utf8");

/** Runs one of the script's functions without running the installer. */
const call = (code: string, env: Record<string, string> = {}) =>
  spawnSync("sh", ["-c", `SPAGHETTI_INSTALL_SOURCE_ONLY=1 . '${script}'; ${code}`], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

describe("the installer's pieces", () => {
  it("is in step with the program about where things live", () => {
    expect(source).toContain(`LABEL="${LABEL}"`);
    expect(source).toContain(`APP_NAME="${APP_NAME}"`);
    const paths = macPaths("$HOME");
    expect(paths.binary).toBe(`$HOME/Library/Application Support/${APP_NAME}/bin/spaghetti-bridge`);
    expect(source).toContain('bin="$HOME/Library/Application Support/$APP_NAME/bin"');
    expect(source).toContain("$HOME/Library/LaunchAgents/$LABEL.plist");
    expect(paths.plist).toBe(`$HOME/Library/LaunchAgents/${LABEL}.plist`);
  });

  it("picks the program for the Mac: native on Apple silicon, even in a Rosetta shell; Intel; nothing else", () => {
    const asset = (os: string, arch: string, translated = "0") =>
      call(`asset_for ${os} ${arch} ${translated}`).stdout.trim();
    expect(asset("Darwin", "arm64")).toBe("darwin-arm64");
    expect(asset("Darwin", "x86_64")).toBe("darwin-x64");
    expect(asset("Darwin", "x86_64", "1")).toBe("darwin-arm64");
    expect(call("asset_for Linux x86_64 0").status).not.toBe(0);
    expect(call("asset_for Darwin ppc 0").status).not.toBe(0);
  });

  it("finds the newest bridge release among other releases", () => {
    const releases = JSON.stringify([
      { tag_name: "v3.0.0" },
      { tag_name: "bridge-v1.2.0" },
      { tag_name: "bridge-v1.1.0" },
    ]);
    expect(call("latest_tag", {}).status).toBe(0);
    const result = spawnSync("sh", ["-c", `SPAGHETTI_INSTALL_SOURCE_ONLY=1 . '${script}'; latest_tag`], {
      input: releases,
      encoding: "utf8",
    });
    expect(result.stdout.trim()).toBe("bridge-v1.2.0");
    const pretty = spawnSync("sh", ["-c", `SPAGHETTI_INSTALL_SOURCE_ONLY=1 . '${script}'; latest_tag`], {
      input: '{\n  "tag_name": "bridge-v2.0.0-rc.1",\n}',
      encoding: "utf8",
    });
    expect(pretty.stdout.trim()).toBe("bridge-v2.0.0-rc.1");
    const none = spawnSync("sh", ["-c", `SPAGHETTI_INSTALL_SOURCE_ONLY=1 . '${script}'; latest_tag`], {
      input: '[{"tag_name":"v1"}]',
      encoding: "utf8",
    });
    expect(none.stdout.trim()).toBe("");
  });
});

describe("the whole script, with a stand-in for the network and the Mac", () => {
  let dir: string;
  let home: string;
  let bin: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "installer-"));
    home = join(dir, "home");
    bin = join(dir, "bin");
    mkdirSync(home);
    mkdirSync(bin);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** A "release": the program is a shell script that records what `setup` was given. */
  function release(options: { corrupt?: boolean } = {}) {
    const program = `#!/bin/sh\nif [ "$1" = version ]; then echo 1.2.0; exit 0; fi\nprintf '%s\\n' "$@" > "${join(dir, "setup-args.txt")}"\n`;
    const gz = gzipSync(Buffer.from(program));
    const sums = `${createHash("sha256")
      .update(options.corrupt ? Buffer.from("other") : gz)
      .digest("hex")}  spaghetti-bridge-darwin-arm64.gz\n`;
    writeFileSync(join(dir, "asset.gz"), gz);
    writeFileSync(join(dir, "SHA256SUMS"), sums);
    writeFileSync(join(dir, "releases.json"), JSON.stringify([{ tag_name: "bridge-v1.2.0" }]));
    // curl serves those files by URL and records what was asked; uname says Darwin on Apple silicon.
    const curl = `#!/bin/sh
out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; -*) shift;; *) url="$1"; shift;; esac; done
echo "$url" >> "${join(dir, "urls.txt")}"
case "$url" in
  *api.github.com*releases*) cp "${join(dir, "releases.json")}" "$out";;
  *SHA256SUMS) cp "${join(dir, "SHA256SUMS")}" "$out";;
  *spaghetti-bridge-darwin-arm64.gz) cp "${join(dir, "asset.gz")}" "$out";;
  *) exit 22;;
esac
`;
    writeFileSync(join(bin, "curl"), curl);
    writeFileSync(
      join(bin, "uname"),
      `#!/bin/sh\ncase "$1" in -s) echo Darwin;; -m) echo arm64;; *) echo Darwin;; esac\n`,
    );
    for (const name of ["curl", "uname"]) chmodSync(join(bin, name), 0o755);
  }

  const run = (args: string[]) =>
    spawnSync("sh", [script, ...args], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
    });

  it("downloads, checks, installs and hands the code and options on to setup, quoted as given", () => {
    release();
    const result = run(["ABCD-EFGH", "--app", "https://x.test", "--version", "bridge-v1.2.0", "--ip", "it's 1"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Checksum matches");
    const installed = join(home, "Library/Application Support/Spaghetti Bridge/bin/spaghetti-bridge");
    expect(readFileSync(installed, "utf8")).toContain("1.2.0");
    expect(readFileSync(join(dir, "setup-args.txt"), "utf8").split("\n").filter(Boolean)).toEqual([
      "setup",
      "ABCD-EFGH",
      "--app",
      "https://x.test",
      "--ip",
      "it's 1",
    ]);
    // The tag was given, so GitHub's list wasn't asked; the code never went anywhere but the program's arguments.
    const urls = readFileSync(join(dir, "urls.txt"), "utf8");
    expect(urls).not.toContain("api.github.com");
    expect(urls).not.toContain("ABCD-EFGH");
  });

  it("finds the latest release by itself", () => {
    release();
    const result = run(["ABCD-EFGH"]);
    expect(result.status).toBe(0);
    expect(readFileSync(join(dir, "urls.txt"), "utf8")).toContain(
      "releases/download/bridge-v1.2.0/spaghetti-bridge-darwin-arm64.gz",
    );
  });

  it("throws away a download that doesn't match its checksum and installs nothing", () => {
    release({ corrupt: true });
    const result = run(["ABCD-EFGH"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/doesn't match its checksum/);
    expect(() =>
      readFileSync(join(home, "Library/Application Support/Spaghetti Bridge/bin/spaghetti-bridge")),
    ).toThrow();
  });

  it("is for a Mac, and not for root", () => {
    writeFileSync(join(bin, "uname"), "#!/bin/sh\necho Linux\n");
    chmodSync(join(bin, "uname"), 0o755);
    const result = run(["ABCD-EFGH"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/for a Mac/);
  });

  it("removes what it made when asked to uninstall and the program is gone", () => {
    release();
    mkdirSync(join(home, "Library/LaunchAgents"), { recursive: true });
    mkdirSync(join(home, "Library/Application Support/Spaghetti Bridge"), { recursive: true });
    writeFileSync(join(home, "Library/LaunchAgents/day.spaghetti.bridge.plist"), "x");
    const result = run(["uninstall"]);
    expect(result.status).toBe(0);
    expect(() => readFileSync(join(home, "Library/LaunchAgents/day.spaghetti.bridge.plist"))).toThrow();
    expect(result.stdout).toMatch(/Disconnect/);
  });
});

describe("shellcheck", () => {
  it("is clean on the installer", () => {
    let available = true;
    try {
      execFileSync("shellcheck", ["--version"], { stdio: "ignore" });
    } catch {
      available = false;
    }
    // CI's runners have shellcheck; a machine without it skips (the workflow runs it too).
    if (!available) return;
    expect(() => execFileSync("shellcheck", ["-s", "sh", script], { stdio: "pipe" })).not.toThrow();
  });
});
