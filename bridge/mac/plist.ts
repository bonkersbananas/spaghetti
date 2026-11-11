/** The LaunchAgent that keeps the bridge running: starts at login, restarts if it stops, logs to ~/Library/Logs. */
import type { MacPaths } from "./paths.ts";
import { LABEL } from "./paths.ts";

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * What the plist says, and why:
 * - RunAtLoad: starts when the person logs in (a LaunchAgent runs in their session, so it can use their folders).
 * - KeepAlive: started again whenever it exits, after ThrottleInterval seconds so a crash loop can't spin.
 * - No secrets: the token and access code are in config.json (mode 600), never in this file or its arguments.
 * - PATH includes Homebrew's folders, so an ffmpeg installed there is found for the camera (launchd's own PATH is tiny).
 */
export function launchAgentPlist(paths: MacPaths): string {
  const args = [paths.binary, "run", "--config", paths.config];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((arg) => `    <string>${escapeXml(arg)}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>WorkingDirectory</key>
  <string>${escapeXml(paths.appDir)}</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(paths.log)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(paths.log)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin</string>
  </dict>
</dict>
</plist>
`;
}
