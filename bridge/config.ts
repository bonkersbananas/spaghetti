/** The bridge's settings, from the environment or a JSON config file (`--config path`, or BRIDGE_CONFIG). */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface Config {
  /** The printer's address on the home network. */
  printerHost: string;
  /** Its serial number, which names the MQTT topics. */
  serial: string;
  /** The LAN access code. A secret: never logged. */
  accessCode: string;
  /** Where Spaghetti is: "https://spaghetti.example.com" or "http://192.168.1.5:8787". */
  appUrl: string;
  /** The agent token (spg_…). A secret: never logged. */
  token: string;
  /** Where the state file and the queue live. */
  dataDir: string;
  /** MQTT address; defaults to mqtts://<host>:8883. */
  mqttUrl: string;
  /** Turn the camera frame off. */
  camera: boolean;
  ffmpeg: string;
  /** Accept (and pin) a changed printer certificate this run. */
  trustNewCertificate: boolean;
}

const KEYS = {
  printerHost: "BRIDGE_PRINTER_HOST",
  serial: "BRIDGE_PRINTER_SERIAL",
  accessCode: "BRIDGE_PRINTER_ACCESS_CODE",
  appUrl: "BRIDGE_APP_URL",
  token: "BRIDGE_TOKEN",
} as const;

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
): Config {
  const flag = argv.indexOf("--config");
  const file = (flag >= 0 ? argv[flag + 1] : undefined) ?? env.BRIDGE_CONFIG;
  const fromFile: Record<string, unknown> = file ? JSON.parse(readFileSync(file, "utf8")) : {};
  const pick = (name: keyof Config, envName?: string): string | undefined => {
    const fromEnv = envName ? env[envName] : undefined;
    const value = fromEnv ?? fromFile[name];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const missing: string[] = [];
  const need = (name: keyof typeof KEYS) => {
    const value = pick(name, KEYS[name]);
    if (!value) missing.push(`${KEYS[name]} (or "${name}" in the config file)`);
    return value ?? "";
  };
  const printerHost = need("printerHost");
  const serial = need("serial");
  const accessCode = need("accessCode");
  const appUrl = need("appUrl");
  const token = need("token");
  if (missing.length) throw new Error(`Missing settings: ${missing.join(", ")}. See docs/bridge.md.`);
  if (!token.startsWith("spg_")) throw new Error("The token should start with spg_ (make one with pnpm agent:add).");
  const dataDir = pick("dataDir", "BRIDGE_DATA_DIR") ?? join(process.cwd(), ".bridge");
  return {
    printerHost,
    serial,
    accessCode,
    appUrl,
    token,
    dataDir,
    mqttUrl: pick("mqttUrl", "BRIDGE_MQTT_URL") ?? `mqtts://${printerHost}:8883`,
    camera: (pick("camera", "BRIDGE_CAMERA") ?? "on") !== "off",
    ffmpeg: pick("ffmpeg", "BRIDGE_FFMPEG") ?? "ffmpeg",
    trustNewCertificate: argv.includes("--trust-new-certificate") || env.BRIDGE_TRUST_NEW_CERTIFICATE === "1",
  };
}
