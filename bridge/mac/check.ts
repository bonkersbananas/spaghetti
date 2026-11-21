/**
 * "Can this computer reach the printer?" asked the way the bridge will, one channel at a time, so that one run on a
 * printer settles what works in its mode (cloud mode, or LAN Only): the MQTT login with the access code, whether
 * reports come, whether the printer answers the status request `pushall` (or refuses it), whether its files can be
 * listed over FTPS, and whether its camera gives a frame. Used by the installer (so a problem is found while the
 * person is still in Terminal, where macOS can also ask about Local Network access) and by `spaghetti-bridge check`.
 *
 * Read-only like the bridge itself: it listens, sends one `pushall`, lists the card's folders and takes one frame,
 * which it throws away. Only the MQTT channel decides whether the bridge can work; the others say what it will lack.
 */
import { join } from "node:path";
import type { BridgeProblem } from "../../src/shared/bridge.ts";
import { type Camera, ffmpegCamera, jpegStreamCamera } from "../camera.ts";
import { CertPin } from "../pin.ts";
import { ftpFiles, type PrinterFiles } from "../printer-files.ts";
import { connectToPrinter, type PushallRefusal } from "../printer-link.ts";
import { emptyState, foldReport, parseReport } from "../printer-state.ts";
import { explainLinkError, silentProblem } from "../problems.ts";
import { Store } from "../store.ts";

export type CheckChannel = "login" | "reports" | "pushall" | "files" | "camera";

/** One line of the check: "ok" works, "partly" works with a cost, "no" doesn't, "skipped" wasn't tried. */
export interface CheckLine {
  channel: CheckChannel;
  status: "ok" | "partly" | "no" | "skipped";
  text: string;
}

/** `ok`: the printer's reports reach this computer, which is all the bridge needs to work. */
export type CheckResult = ({ ok: true } | { ok: false; problem: BridgeProblem }) & { lines: CheckLine[] };

export interface CheckOptions {
  host: string;
  serial: string;
  accessCode: string;
  dataDir: string;
  /** Plain "mqtt://" address, for tests. */
  mqttUrl?: string;
  timeoutMs?: number;
  platform?: NodeJS.Platform;
  trustNewCertificate?: boolean;
  /** "off" skips the camera, as the bridge would. */
  camera?: "on" | "off";
  ffmpeg?: string;
  /** Stand-ins for the card and the cameras, for tests. */
  files?: PrinterFiles;
  cameras?: Array<{ name: string; camera: Camera }>;
  dropWindowMs?: number;
}

/** What the bridge can't do without the printer's files, and how to give it them. */
export const WITHOUT_FILES =
  "The bridge still logs each print, its progress and end and a camera photo, but the attempt gets no slicer file from the printer: no plate picture, filament and grams, settings or 3D view from it (drop the .gcode.3mf into Spaghetti to add them by hand). To have them, put a USB drive in the printer (on the X2D the external storage is a USB drive) and turn on Store Sent Files on External Storage in its print options.";

const LIVEVIEW_HELP =
  "Turn on LAN Only Liveview on the printer (in its network settings; LAN Only mode itself can stay off). Without a frame prints just get no camera photo.";

export function symbolOf(line: CheckLine): string {
  return { ok: "✓", partly: "–", no: "✗", skipped: "·" }[line.status];
}

/** The check as lines of text, for Terminal. */
export function describeCheck(result: CheckResult): string[] {
  return result.lines.map((line) => `${symbolOf(line)} ${line.text}`);
}

export async function checkPrinter(options: CheckOptions): Promise<CheckResult> {
  const store = new Store(join(options.dataDir, "state.json"));
  const pin = new CertPin(
    { certs: store.certs, save: () => store.save() },
    { trustNew: options.trustNewCertificate ?? false },
  );
  const [link, files, camera] = await Promise.all([
    checkLink(options, pin),
    checkFiles(options, pin),
    checkCamera(options, pin),
  ]);
  const lines = [...link.lines, files, camera];
  return link.problem ? { ok: false, problem: link.problem, lines } : { ok: true, lines };
}

async function checkLink(
  options: CheckOptions,
  pin: CertPin,
): Promise<{ problem: BridgeProblem | null; lines: CheckLine[] }> {
  const platform = options.platform ?? process.platform;
  let connected = false;
  let reports = 0;
  let whole = false;
  let state = emptyState();
  let refused: PushallRefusal | null = null;
  let problem: BridgeProblem | null = null;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void link.close().catch(() => {});
      resolve();
    };
    const link = connectToPrinter({
      url: options.mqttUrl ?? `mqtts://${options.host}:8883`,
      serial: options.serial,
      accessCode: options.accessCode,
      pin: options.mqttUrl ? undefined : pin,
      dropWindowMs: options.dropWindowMs,
      onReport: (payload) => {
        const report = parseReport(payload);
        const next = foldReport(state, report, { listening: Boolean(refused) });
        if (next !== state) reports++;
        state = next;
        if (state.complete) {
          whole = true;
          finish();
        }
      },
      onConnection: (up) => {
        if (up) {
          connected = true;
          problem = null;
        }
      },
      onPushallRefused: (how) => {
        refused = how;
      },
      onError: (error) => {
        problem = explainLinkError(error, { host: options.host, platform }) ?? problem;
        // A refused login or a changed certificate won't get better by waiting.
        if (problem && (problem.code === "wrong-access-code" || problem.code === "certificate")) finish();
      },
    });
    const timer = setTimeout(finish, options.timeoutMs ?? 30_000);
  });

  const seconds = Math.round((options.timeoutMs ?? 30_000) / 1000);
  const lines: CheckLine[] = [];
  if (!connected) {
    const why =
      problem ??
      explainLinkError(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }), {
        host: options.host,
        platform,
      }) ??
      silentProblem();
    lines.push({ channel: "login", status: "no", text: `Printer link (MQTT, port 8883): ${why.message}` });
    lines.push({ channel: "reports", status: "skipped", text: "Reports: not tried (no link)." });
    lines.push({ channel: "pushall", status: "skipped", text: "Status request (pushall): not tried (no link)." });
    return { problem: why, lines };
  }
  lines.push({
    channel: "login",
    status: "ok",
    text: "Printer link (MQTT, port 8883): logged in with the access code.",
  });
  lines.push(
    reports
      ? { channel: "reports", status: "ok", text: "Reports: the printer is sending its status." }
      : {
          channel: "reports",
          status: "no",
          text: `Reports: none in ${seconds} s. ${silentProblem().message}`,
        },
  );
  lines.push(pushallLine(refused, whole, reports > 0, seconds));
  return { problem: reports ? null : silentProblem(), lines };
}

function pushallLine(refused: PushallRefusal | null, whole: boolean, heard: boolean, seconds: number): CheckLine {
  const listens = whole
    ? "The bridge doesn't need it: the reports carry the printer's whole state."
    : "The bridge pieces the printer's state together from the reports it sends by itself.";
  if (refused === "answered-error") {
    return {
      channel: "pushall",
      status: "partly",
      text: `Status request (pushall): the printer refused it (it answered with an error), so the bridge won't ask again. ${listens}`,
    };
  }
  if (refused === "dropped") {
    return {
      channel: "pushall",
      status: "partly",
      text: `Status request (pushall): the printer dropped the connection right after it (twice in a row), so the bridge won't ask again; it connected again and only listens. ${listens}`,
    };
  }
  if (whole) {
    return {
      channel: "pushall",
      status: "ok",
      text: "Status request (pushall): the printer sent its whole state.",
    };
  }
  if (!heard) {
    return { channel: "pushall", status: "no", text: `Status request (pushall): no answer in ${seconds} s.` };
  }
  return {
    channel: "pushall",
    status: "partly",
    text: `Status request (pushall): no whole state in ${seconds} s, only parts. ${listens}`,
  };
}

async function checkFiles(options: CheckOptions, pin: CertPin): Promise<CheckLine> {
  const files = options.files ?? ftpFiles({ host: options.host, accessCode: options.accessCode, pin });
  if (!files.look) return { channel: "files", status: "skipped", text: "Files: not checked." };
  try {
    const seen = await files.look();
    const count = seen.reduce((sum, place) => sum + place.files, 0);
    if (!seen.length || count === 0) {
      return {
        channel: "files",
        status: "partly",
        text: `Files (FTPS, port 990): logged in, but there are no files to read: the USB drive (or SD card) is empty or not in the printer. ${WITHOUT_FILES}`,
      };
    }
    const where = seen
      .filter((place) => place.files)
      .map((place) => `${place.files} in ${place.dir}`)
      .join(", ");
    return {
      channel: "files",
      status: "ok",
      text: `Files (FTPS, port 990): can list and read the printer's USB drive (${where}). A print's file is kept there only with Store Sent Files on External Storage on.`,
    };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    const why = /530|login|password/i.test(text)
      ? "the printer refused the access code for its files."
      : /certificate changed/i.test(text)
        ? "the printer's certificate for its files changed, so the bridge didn't send the access code."
        : "the printer's file service didn't answer (it serves only a USB drive or SD card, and may be closed in this mode).";
    return { channel: "files", status: "no", text: `Files (FTPS, port 990): ${why} ${WITHOUT_FILES}` };
  }
}

async function checkCamera(options: CheckOptions, pin: CertPin): Promise<CheckLine> {
  if (options.camera === "off") return { channel: "camera", status: "skipped", text: "Camera: off (--camera off)." };
  let noFfmpeg = false;
  const base = { host: options.host, accessCode: options.accessCode, pin };
  const cameras = options.cameras ?? [
    {
      name: "the camera stream (RTSPS, port 322, through ffmpeg)",
      camera: ffmpegCamera({
        ...base,
        ffmpeg: options.ffmpeg,
        log: (message) => {
          if (/ffmpeg isn't installed/.test(message)) noFfmpeg = true;
        },
      }),
    },
    { name: "the picture stream (port 6000)", camera: jpegStreamCamera(base) },
  ];
  for (const { name, camera } of cameras) {
    const frame = await camera.grab().catch(() => null);
    if (frame) return { channel: "camera", status: "ok", text: `Camera: took a frame from ${name}.` };
  }
  return {
    channel: "camera",
    status: "partly",
    text: `Camera: no frame. ${LIVEVIEW_HELP}${noFfmpeg ? " The RTSPS stream also needs ffmpeg, which isn't installed: brew install ffmpeg." : ""}`,
  };
}
