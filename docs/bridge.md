# The printer bridge

An optional, read-only program that listens to the X2D over your home network and tells Spaghetti when a print starts, how it is going and when it ends, and keeps the AMS slots in step. Spaghetti works fully without it ([decision 0010](decisions/0010-optional-read-only-printer-bridge.md)).

- **Optional.** Nothing in the app needs it. Everything it does you can do by hand.
- **Read-only.** It never sends a command to the printer: no start, stop, pause, heat or file upload. Over MQTT it publishes exactly one message, the status request `pushall`, so the printer answers with its whole state. Over FTP it only lists a folder and downloads a file. The code is built so there is no other way: see `bridge/printer-link.ts` and `bridge/printer-files.ts`.
- **Local.** It talks to the printer on your network and to Spaghetti with an agent token. It never uses Bambu's cloud or a Bambu account ([decision 0003](decisions/0003-no-bambu-dependency.md)).
- What it does is shown as "via Printer bridge", like any agent's work.

Everything below about the X2D that we could not check against a real one is marked **[uncertain]**, as in [printer.md](printer.md). This was built from the community's documentation of Bambu's local protocols and tested against a fake printer; the first run on a real X2D is the real test, so read the log.

## On a Mac (the easy way)

For a Mac that is usually on. No Node, pnpm, Docker or Homebrew: one program, installed by one command. In Spaghetti open **Printer → Connect the bridge**; it walks through this and shows the command.

**1. On the printer.** Turn on **LAN Only mode**, then **Developer mode** (Bambu's wiki says Developer mode is what opens MQTT, the live stream and FTP to other programs on current firmware; it sits under the access code on the printer's Settings, General tab). Note the printer's **IP address**, its **serial number** and the **access code** from its screen. Keep the Mac and the printer on the same network. See [1. Put the printer in LAN Only mode](#1-put-the-printer-in-lan-only-mode) for what LAN Only costs.

**2. On the Mac.** Paste the command from the app into Terminal:

```sh
curl -fsSL https://spaghetti.day/bridge/install.sh | sh -s -- ABCD-EFGH
```

`ABCD-EFGH` is the pairing code: valid for ten minutes and usable once. It is traded for the bridge's token, which is never in the command or your shell history. The installer:

1. downloads the right program (Apple silicon or Intel) from the repository's GitHub releases and checks it against the release's `SHA256SUMS`;
2. puts it in `~/Library/Application Support/Spaghetti Bridge/bin/` and signs it ad hoc (Apple silicon only runs signed programs; this needs no developer account);
3. runs `spaghetti-bridge setup`: pairs first (the code only lasts ten minutes) and saves the token at once, listens for the printer announcing itself (so it can often fill in the address and serial number), asks for what it doesn't know (the access code is always asked, never taken from the command line), and **checks the printer answers** from Terminal, so a problem shows up while you're looking. If the check fails and you don't go on, the pairing is already saved: fix the problem and run the installer command again without a code;
4. writes `config.json` there (readable only by you), a LaunchAgent in `~/Library/LaunchAgents/day.spaghetti.bridge.plist` (`RunAtLoad` and `KeepAlive`: it starts when you log in and again if it stops) and logs to `~/Library/Logs/Spaghetti Bridge/bridge.log`; then starts it and waits until Spaghetti has heard from it.

**Update:** run the same command again (a new code is only needed to pair again; without one it keeps the saved connection and settings). **Remove:** `curl -fsSL https://spaghetti.day/bridge/install.sh | sh -s -- uninstall`, then **Disconnect** on the Printer page to end its token. `spaghetti-bridge status` (in the `bin/` folder) shows whether it is running and the end of its log. Options after the code: `--app URL` for a Spaghetti elsewhere than spaghetti.day, `--ip`, `--serial`, `--access-code` (it would be in your history: prefer being asked), `--camera off`, `--no-check`, `--no-start`, `--version TAG`.

**Sleep, wake, restarts.** It starts at login and is restarted by macOS if it stops. A Mac that sleeps can't hear the printer, so a print that starts and ends while it sleeps is missed (the bridge cannot wake it). When the Mac wakes the bridge notices (its timer ran late), reconnects and sends `pushall`, so a print still going is picked up from where it is. If the printer's address changes, after about half a minute of failures the bridge listens for the printer's announcement, follows it to the new address and saves it; giving the printer a fixed address in the router is still better. Without the announcement the Printer page says it can't find the printer at the old address, and `spaghetti-bridge setup --ip NEW` fixes it.

**Camera.** We do not download ffmpeg for you (a third-party binary fetched by a script is a risk we'd rather not take). The bridge takes a frame when a print ends in this order: the printer's RTSPS stream through ffmpeg if you have it (`brew install ffmpeg`; the LaunchAgent's PATH includes Homebrew's folders), then the printer's own picture stream (JPEG over TLS, port 6000, no ffmpeg) where the printer serves one, then no photo. Which of these the X2D serves is **[uncertain]**; if none, prints simply get no camera photo. `--camera off` stops the attempts.

**What was verified and what was not.** Verified in the sandbox (Linux): the program compiles for both Mac targets and, built natively, passes `scripts/bridge-smoke.ts`: against a TLS MQTT broker and an FTPS server it starts the attempt, fetches and attaches the file, pins the certificates, and sends the printer only `pushall` and the card only list and download; the installer script, plist and settings are unit tested; the Worker side is tested. CI runs the same smoke test on macOS runners (Apple silicon and Intel) before it publishes a release. **Not verified on a real Mac and X2D:** everything below marked [uncertain], and the first real run.

- **Gatekeeper and signing.** A file downloaded by `curl` doesn't get the quarantine flag, so Gatekeeper doesn't assess it; the installer clears the flag anyway and signs the program ad hoc. A program downloaded in a browser would be quarantined and refused unsigned/unnotarised: use the command, not the browser. Not notarised (that needs a paid Apple developer account): **[uncertain]** whether a future macOS tightens this for curl downloads. Each update changes the program's signature; macOS may then ask about the local network again.
- **Local Network privacy (macOS 15 and later).** Apple lets a program reach devices on the home network only if the person allows it; Apple's note TN3179 says programs run as root or as a launchd *daemon* are allowed automatically, and others may be asked. The bridge is a LaunchAgent (no password needed to install). What is known from Apple's developer forums: an agent that is refused gets `EHOSTUNREACH` ("No route to host") for LAN addresses, a program run from Terminal is judged as Terminal, and the permission prompt may not appear at all for a program launchd starts, or only if it keeps trying instead of exiting. Whether a prompt appears for this program, and under what name, **[uncertain]**. The design therefore: (a) the installer's check runs *in Terminal*, where macOS prompts for Terminal if it needs to; (b) the bridge never exits on a refused connection, it keeps retrying every few seconds; (c) a "No route to host" on a Mac is reported to the app as "Can't reach the printer at … macOS may be blocking Spaghetti Bridge from the local network: open System Settings → Privacy & Security → Local Network and turn on Spaghetti Bridge" (the Printer page shows it); (d) the same words are in the log. If it is not listed there, run `spaghetti-bridge check` in Terminal and allow Terminal, or tell us: a LaunchDaemon (needs `sudo`) is the fallback we did not build.
- **Developer mode.** Bambu's own wiki says Developer mode opens MQTT, the live stream and FTP; third-party sites (SimplyPrint's X2D guide) say current firmware wants LAN Only plus Developer mode for third-party control. Whether *read-only* listening works without Developer mode on the X2D is **[uncertain]**; if the bridge says "isn't telling the bridge anything", turn it on. Bambu's disclaimer for Developer mode says they can't oversee what third-party software does; this one only listens.
- **Finding the printer.** Bambu printers announce themselves with SSDP (UDP broadcast to port 2021, multicast to 1990), naming address, serial and model; the bridge only listens. That the X2D does so, and that this passes macOS's Local Network privacy, is **[uncertain]**. The serial number is also tried from the common name of the printer's MQTT certificate **[uncertain]**; otherwise you type it.
- **Not tested on a real sleep/wake.** The wake logic watches for a late timer; the test uses fake clocks.

## Other ways to run it: Raspberry Pi, NAS, Docker, Node

Everything below this line is for a computer that isn't the Mac above: a Pi, a NAS, a spare Linux box. The settings are the same five.

## 1. Put the printer in LAN Only mode

The local protocols (MQTT, FTP, camera) are served by the printer on your network, protected by an **access code** that only you know. Bambu ties them to **LAN Only mode**.

1. On the printer's screen, open the network settings and turn on **LAN Only Mode** **[uncertain: the menu names on the X2D]**.
2. Bambu's wiki says **Developer mode** (below the access code) is what opens MQTT, the live stream and FTP to other programs; turn it on after LAN Only mode. Whether listening alone works without it on the X2D is **[uncertain]**.
3. Keep the printer and the bridge's computer on the same network (same Wi-Fi or LAN, no guest-network isolation).

**What it costs.** LAN Only mode turns off the printer's connection to Bambu's cloud. You lose what depends on it: the Bambu Handy app and remote monitoring away from home, sending prints from Bambu Studio over the internet (printing from Studio on your network still works), cloud print history, and notifications from Bambu. Firmware updates are done from Studio or an SD card instead of automatically. You can switch it back whenever you like; the bridge then simply stops hearing from the printer. Bambu has changed how third-party access to its printers is authorised before, and may again; because the bridge is optional, nothing in Spaghetti breaks when it stops working.

## 2. Find the printer's IP, serial number and access code

All three are on the printer's screen, in the network and device settings **[uncertain: exact menus on the X2D]**:

- **IP address:** shown with the Wi-Fi network. Give the printer a fixed address in your router (a "DHCP reservation") so it doesn't change.
- **Serial number:** also shown in Bambu Studio next to the printer, and on a sticker. It names the MQTT topics (`device/<serial>/report`).
- **Access code:** shown next to LAN Only Mode (eight characters). It is a password: don't share it, commit it or paste it in the issue tracker. It can be regenerated on the printer.

## 3. Make the token

The bridge reaches Spaghetti with an agent token with three scopes ([api.md](api.md)): `read` (to find the build to attach to), `attempts` (start, file, photo, end) and `printer` (AMS slots, spools, its status).

```sh
pnpm agent:add --owner alex --name "Printer bridge" --scopes read,attempts,printer
```

Or make it in the app: account menu, Agents, New agent. (The Mac installer makes it by itself, from a pairing code.) Use `--remote` for the deployed database. The token is shown once; keep it with the access code.

## 4. Configure it

Five settings, from environment variables or a JSON file (`pnpm bridge --config bridge.json`, or `BRIDGE_CONFIG`):

| Environment variable | File key | |
| --- | --- | --- |
| `BRIDGE_PRINTER_HOST` | `printerHost` | the printer's IP address |
| `BRIDGE_PRINTER_SERIAL` | `serial` | its serial number |
| `BRIDGE_PRINTER_ACCESS_CODE` | `accessCode` | the LAN access code |
| `BRIDGE_APP_URL` | `appUrl` | where Spaghetti is, e.g. `https://spaghetti.day` or `http://192.168.1.5:8787` |
| `BRIDGE_TOKEN` | `token` | the agent token (`spg_…`) |

Optional: `BRIDGE_DATA_DIR` (state and queue; default `./.bridge`, `/data` in Docker), `BRIDGE_CAMERA=off` (no camera frames), `BRIDGE_FFMPEG` (path to ffmpeg), `BRIDGE_MQTT_URL` (default `mqtts://<host>:8883`).

The bridge's data directory holds `state.json` (which print it is following and which attempt each print became) and `queue/` (events waiting for the app). Keep it between restarts: that is what stops a restart from logging a print twice. It holds no secrets.

## 5. Run it

**With Node** (24 or later), from a checkout of this repository, on any computer on the home network:

```sh
pnpm install
BRIDGE_PRINTER_HOST=192.168.1.50 BRIDGE_PRINTER_SERIAL=… BRIDGE_PRINTER_ACCESS_CODE=… \
BRIDGE_APP_URL=https://… BRIDGE_TOKEN=spg_… pnpm bridge
```

ffmpeg is optional on bare Node: with it on the PATH the bridge takes a camera frame when a print ends; without it prints just get no photo.

**With Docker on a Raspberry Pi** (or a NAS): `bridge/Dockerfile` builds a small multi-arch image with ffmpeg, and `bridge/compose.example.yaml` is a starting point. Put the access code and token in a `.env` file beside it (`PRINTER_ACCESS_CODE`, `SPAGHETTI_TOKEN`), then:

```sh
docker compose -f bridge/compose.example.yaml up -d --build
docker compose -f bridge/compose.example.yaml logs -f
```

To build the image for a Pi on a bigger machine: `docker buildx build --platform linux/arm64,linux/arm/v7,linux/amd64 -f bridge/Dockerfile -t spaghetti-bridge .` (a Pi 4 or 5 with a 64-bit system is `linux/arm64`).

The log says what it hears and does ("A print started", "Attaching … to the attempt already started by hand", "Unknown spool in A3"). It never prints the access code or the token.

## The printer's certificate

The printer's TLS certificate is self-signed, so nothing can verify it against a certificate authority, and the access code is a password. The bridge therefore **pins** it: the first time it reaches the printer's MQTT service and its FTPS service it stores the certificate's SHA-256 fingerprint in `state.json` (under `certs`), and after that it refuses a different certificate **before any credential is sent**, with a log line that says what changed. If the certificate changed because you updated the printer's firmware or reset it, accept the new one by running once with `--trust-new-certificate` (or `BRIDGE_TRUST_NEW_CERTIFICATE=1`), or delete that service's line under `certs` in `state.json`. If you changed nothing, something else on your network may be answering as the printer: don't accept it.

- **Camera:** ffmpeg can't pin a fingerprint, so the bridge reads the stream's certificate first (a separate handshake that sends nothing) and pins that too, then starts ffmpeg. A service that presented the right certificate once and a different one to ffmpeg would not be caught.
- **Bambu's printer CA [uncertain]:** the community tools may verify the certificate against a Bambu printer CA with the serial number as the name. We couldn't confirm that for the X2D, so the bridge doesn't rely on it; if you can, that would be better than trust on first use.
- The first connection is the weak moment: pin it on a network you trust.

## What it does

**A print starts** (the printer reports a new job while it is preparing or printing):

1. If one of you already started an attempt by hand that is still printing and has no slicer file (within 12 hours before), the print attaches to it.
2. Otherwise, if an open build's latest attempt used a slicer file with the same name, the next attempt starts on that build.
3. Otherwise a new build starts, named after the job with the file name tidied ("bracket_v2.gcode.3mf" becomes "bracket v2"). Titles are optional; tidy up later.

The bridge then fetches the print's `.gcode.3mf` from the printer's SD card over FTPS (port 990, list and download only) and attaches it as the attempt's slicer file, so the app reads its settings, grams and plate picture as for any file. If the file isn't found, the attempt still starts without it.

**While it prints**, once a minute the bridge sends the printer's progress (percent, minutes left, layer of total). Spaghetti shows it in place of the slicer's estimate while it's fresh and quietly goes back to the estimate when the bridge goes silent.

**A print ends** (finished, failed or cancelled): the bridge records when it ended and how long it took, and takes a camera frame as the attempt's photo (uploaded for the next browser to resize, like any photo that arrives without one). **It never says whether the print worked.** That is your call (Worked, Partly, Spaghetti); the attempt waits as "off the bed, how did it go?". For a failed or cancelled print, or when the printer's own detection reported spaghetti, it records a *suggested* failure tag that is offered when you pick Partly or Spaghetti.

**The AMS** is synced when the printer reports its trays and whenever they change. For each tray: the spool is found by its stored RFID tray UUID, else by brand, material and colour, and loaded into the slot. A Bambu spool (it has an RFID tag) that isn't in the pantry becomes a new spool. A tray without a tag that matches nothing is **left alone** and shown on the Printer page as "unknown spool in A3", so you can pick one. Where the printer knows the filament left (`remain`, not -1) the spool's level is set from it. Gram tracking will take over from there.

**When Spaghetti can't be reached**, events wait in `queue/` and are retried with backoff, in order. A job the app refuses for good (say, its attempt was deleted) is moved to `queue/failed/` so it doesn't block the rest.

## When something doesn't work

- **The Printer page says "Not set up" or "last heard … ago".** The bridge isn't running or can't reach the app. Check its log and the app URL; try `curl -H "Authorization: Bearer $BRIDGE_TOKEN" $BRIDGE_APP_URL/api/printer`.
- **"Printer link: Connection refused" or it connects but hears nothing.** LAN Only mode isn't on, the IP or serial is wrong, or (on some firmware) Developer mode is needed **[uncertain]**. The access code is the MQTT password; a wrong one is refused at once.
- **No photo.** The camera is RTSPS on port 322 on the X1 family; the X2D's camera may differ **[uncertain]**, and ffmpeg must be installed. A frame that can't be had is skipped without a fuss. `BRIDGE_CAMERA=off` stops the attempts.
- **No slicer file.** The bridge looks for `<job name>.gcode.3mf` and `<job name>.3mf` in the SD card's root, `/cache` and `/model` **[uncertain: where the X2D keeps sent prints]**. Prints started from the printer's screen from a file on the card work the same way; prints sent from the cloud may leave no file.
- **A print was cancelled but is logged as failed (or the other way round).** Cancelling is recognised by the error code `0300_400C` or a return to idle **[uncertain: firmware differs]**.

## What we couldn't confirm for the X2D [uncertain]

- Whether the X2D uses the same MQTT report fields as the X1 and P1 families (`gcode_state`, `mc_percent`, `layer_num`, `ams`…), and whether its dual-nozzle setup adds fields the bridge ignores.
- Whether LAN Only mode alone is enough to read status, or Developer mode is also required, and the menu names.
- The FTPS folders for prints, and that port 990 and the user `bblp` are the same.
- The camera: RTSPS on port 322 and the path `/streaming/live/1`, and the `-tls_verify 0` flag needed for its self-signed certificate.
- The AMS numbering on the X2D (units 0 to 3 as A to D; single-spool units such as the AMS HT are ignored for now) and the external spool as `vt_tray`.
- The HMS codes for the AI's spaghetti detection (`0C00_0300_0002_0001` in the community list) and the error code for a user cancel.
- The report fixtures in `test/bridge/fixtures.ts` were written by hand to the community-documented format, not recorded from a printer. When you have a real capture, add it there.
