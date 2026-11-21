# The printer bridge

An optional, read-only program that listens to the X2D over your home network and tells Spaghetti when a print starts, how it is going and when it ends, and keeps the AMS slots in step. Spaghetti works fully without it ([decision 0010](decisions/0010-optional-read-only-printer-bridge.md)).

- **Optional.** Nothing in the app needs it. Everything it does you can do by hand.
- **Read-only.** It listens and asks the printer for its status; it can't start, stop or change a print: no start, stop, pause, heat or file upload. Over MQTT it publishes exactly one message, the status request `pushall`, so the printer answers with its whole state; if the printer refuses even that, it stops asking and only listens. Over FTP it only lists a folder and downloads a file. The code is built so there is no other way, and the tests prove it: the one publish in `bridge/printer-link.ts` goes through a guard that throws for anything but `pushall` on the printer's request topic, and `test/bridge/read-only.test.ts` fails if any other publish, MQTT or FTP client, or an FTP call that writes, deletes or renames appears anywhere in `bridge/`.
- **Cloud mode is fine.** The printer can stay in its normal cloud mode, so Bambu Handy, cloud printing and remote monitoring keep working ([decision 0074](decisions/0074-the-bridge-listens-in-cloud-mode.md)). See [1. Choose the printer's mode](#1-choose-the-printers-mode).
- **Local.** It talks to the printer on your network and to Spaghetti with an agent token. It never uses Bambu's cloud or a Bambu account ([decision 0003](decisions/0003-no-bambu-dependency.md)).
- What it does is shown as "via Printer bridge", like any agent's work.

Everything below about the X2D that we could not check against a real one is marked **[uncertain]**, as in [printer.md](printer.md). This was built from the community's documentation of Bambu's local protocols and tested against a fake printer; the first run on a real X2D (Nov 21, 2026, cloud mode) confirmed the channels listed under "What we couldn't confirm", so read the log for the rest.

## On a Mac (the easy way)

For a Mac that is usually on. No Node, pnpm, Docker or Homebrew: one program, installed by one command. In Spaghetti open **Printer → Connect the bridge**; it walks through this and shows the command.

**1. On the printer.** Leave it in cloud mode (**LAN Only mode off**, **Developer mode off**). Turn on **LAN Only Liveview** (in its network settings; it doesn't need LAN Only mode) so the bridge can take a camera frame, and, to give the bridge each print's file, put a **USB drive** in the printer and turn on **Store Sent Files on External Storage** (in its print options). Note the printer's **IP address**, its **serial number** and the **access code**: the code is shown under LAN Only mode, and can be read without turning the mode on. Keep the Mac and the printer on the same network. If the check in step 2 says the printer doesn't talk to the bridge in cloud mode, see [the fallback](#1-choose-the-printers-mode) and what it costs. **[uncertain: the menu names on the X2D]**

**2. On the Mac.** Paste the command from the app into Terminal:

```sh
curl -fsSL https://spaghetti.day/bridge/install.sh | sh -s -- ABCD-EFGH
```

`ABCD-EFGH` is the pairing code: valid for ten minutes and usable once. It is traded for the bridge's token, which is never in the command or your shell history. The installer:

1. finds the newest `bridge-v…` tag with one call to GitHub's tag list (by version number, skipping a tag whose release is not published yet, so `0.1.10` beats `0.1.9`; the many slicer releases in the same repository can't hide it), downloads the right program (Apple silicon or Intel) from that release and checks it against the release's `SHA256SUMS`;
2. puts it in `~/Library/Application Support/Spaghetti Bridge/bin/` and signs it ad hoc (Apple silicon only runs signed programs; this needs no developer account);
3. runs `spaghetti-bridge setup`: pairs first (the code only lasts ten minutes) and saves the token at once, listens for the printer announcing itself (so it can often fill in the address and serial number), asks for what it doesn't know (the access code is always asked, never taken from the command line), and **checks what the printer shares** from Terminal, one line per channel (see [The check](#the-check)), so a problem shows up while you're looking. Only the printer link decides: no files or no camera frame are said, with what they cost, but don't stop the install. If the link fails and you don't go on, the pairing is already saved: fix the problem and run the installer command again without a code;
4. writes `config.json` there (readable only by you), a LaunchAgent in `~/Library/LaunchAgents/day.spaghetti.bridge.plist` (`RunAtLoad` and `KeepAlive`: it starts when you log in and again if it stops) and logs to `~/Library/Logs/Spaghetti Bridge/bridge.log`; then starts it and waits until Spaghetti has heard from it.

**Update:** run the same command again (a new code is only needed to pair again; without one it keeps the saved connection and settings). **Remove:** `curl -fsSL https://spaghetti.day/bridge/install.sh | sh -s -- uninstall`, then **Disconnect** on the Printer page to end its token. `spaghetti-bridge status` (in the `bin/` folder) shows whether it is running and the end of its log. Options after the code: `--app URL` for a Spaghetti elsewhere than spaghetti.day, `--ip`, `--serial`, `--access-code` (it would be in your history: prefer being asked), `--camera off`, `--no-check`, `--no-start`, `--version TAG`.

**Keep the Mac awake.** Set it up once so it doesn't sleep while you're away: on a Mac mini, iMac or Studio, System Settings → Energy → *Prevent automatic sleeping when the display is off*; on a MacBook, keep it on its charger with the lid open and turn on the same switch (System Settings → Battery → Options, or Displays → Advanced, depending on the macOS version). The display may still turn off. Without that, the bridge misses prints that start and end while the Mac sleeps. The first time, macOS 15 or later may ask whether Terminal (or Spaghetti Bridge) may find devices on your local network: say yes.

**Sleep, wake, restarts.** It starts at login and is restarted by macOS if it stops. A Mac that sleeps can't hear the printer, so a print that starts and ends while it sleeps is missed (the bridge cannot wake it). When the Mac wakes the bridge notices (its timer ran late), reconnects and sends `pushall`, so a print still going is picked up from where it is. If the printer's address changes, after about half a minute of failures the bridge listens for the printer's announcement, follows it to the new address and saves it; giving the printer a fixed address in the router is still better. Without the announcement the Printer page says it can't find the printer at the old address, and `spaghetti-bridge setup --ip NEW` fixes it.

**Camera.** We do not download ffmpeg for you (a third-party binary fetched by a script is a risk we'd rather not take). The bridge takes a frame when a print ends in this order: the printer's RTSPS stream through ffmpeg if you have it (`brew install ffmpeg`; the LaunchAgent's PATH includes Homebrew's folders), then the printer's own picture stream (JPEG over TLS, port 6000, no ffmpeg) where the printer serves one, then no photo. On the H2D, H2S and X2D the RTSPS stream (port 322) is opened by the **LAN Only Liveview** switch, without LAN Only mode, and Handy's remote camera keeps working (ha-bambulab's setup notes; SimplyPrint says the same for the X1 and H2D); a real X2D in cloud mode gave a frame this way (Nov 21, 2026). If there is no frame, prints simply get no camera photo; the log says why (`No camera frame from…`, with ffmpeg's own last line), and after two prints in a row without a photo the Printer page shows a camera problem. The bridge looks for ffmpeg on its PATH and in `/opt/homebrew/bin`, `/usr/local/bin` and `/opt/local/bin`. `--camera off` stops the attempts.

**What was verified and what was not.** Verified in the sandbox (Linux): the program compiles for both Mac targets and, built natively, passes `scripts/bridge-smoke.ts`: against a TLS MQTT broker and an FTPS server it starts the attempt, fetches and attaches the file, pins the certificates, and sends the printer only `pushall` and the card only list and download; the installer script, plist and settings are unit tested; the Worker side is tested. CI runs the same smoke test on macOS runners (Apple silicon and Intel) before it publishes a release. **Not verified on a real Mac and X2D:** everything below marked [uncertain], and the first real run.

- **Gatekeeper and signing.** A file downloaded by `curl` doesn't get the quarantine flag, so Gatekeeper doesn't assess it; the installer clears the flag anyway and signs the program ad hoc. A program downloaded in a browser would be quarantined and refused unsigned/unnotarised: use the command, not the browser. Not notarised (that needs a paid Apple developer account): **[uncertain]** whether a future macOS tightens this for curl downloads. Each update changes the program's signature; macOS may then ask about the local network again.
- **Local Network privacy (macOS 15 and later).** Apple lets a program reach devices on the home network only if the person allows it; Apple's note TN3179 says programs run as root or as a launchd *daemon* are allowed automatically, and others may be asked. The bridge is a LaunchAgent (no password needed to install). What is known from Apple's developer forums: an agent that is refused gets `EHOSTUNREACH` ("No route to host") for LAN addresses, a program run from Terminal is judged as Terminal, and the permission prompt may not appear at all for a program launchd starts, or only if it keeps trying instead of exiting. Whether a prompt appears for this program, and under what name, **[uncertain]**. The design therefore: (a) the installer's check runs *in Terminal*, where macOS prompts for Terminal if it needs to; (b) the bridge never exits on a refused connection, it keeps retrying every few seconds; (c) a "No route to host" on a Mac is reported to the app as "Can't reach the printer at … macOS may be blocking Spaghetti Bridge from the local network: open System Settings → Privacy & Security → Local Network and turn on Spaghetti Bridge" (the Printer page shows it); (d) the same words are in the log. If it is not listed there, run `spaghetti-bridge check` in Terminal and allow Terminal, or tell us: a LaunchDaemon (needs `sudo`) is the fallback we did not build.
- **Cloud mode.** Bambu says status reports over MQTT stay open under its authorization firmware, and community tools read cloud-mode H2D printers locally (see [1. Choose the printer's mode](#1-choose-the-printers-mode)); a real X2D in cloud mode (Nov 21, 2026) passed the `check` for reports and answered `pushall` with its whole state.
- **Finding the printer.** Bambu printers announce themselves with SSDP (UDP broadcast to port 2021, multicast to 1990), naming address, serial and model; the bridge only listens. That the X2D does so, and that this passes macOS's Local Network privacy, is **[uncertain]**. The serial number is also tried from the common name of the printer's MQTT certificate **[uncertain]**; otherwise you type it.
- **Not tested on a real sleep/wake.** The wake logic watches for a late timer; the test uses fake clocks.

## The check

`spaghetti-bridge check` (in the `bin/` folder; the installer runs the same check) asks the printer the way the bridge will, one channel at a time, in up to half a minute, and prints a line for each: ✓ works, – works with a cost, ✗ doesn't, · not tried. Only the first two lines decide whether the bridge can work; the rest say what it will lack. It sends one `pushall`, lists the drive's folders and takes one camera frame, which it throws away.

| Line | ✓ means | Otherwise |
| --- | --- | --- |
| Printer link (MQTT, port 8883) | It logged in with the access code. | ✗ says why: a wrong access code, no route (on a Mac, maybe Local Network privacy), a changed certificate, or a refused connection (the printer keeps the port closed in this mode: the fallback). |
| Reports | The printer sends its status. | ✗ none in the time: check the serial number; if it is right, the printer doesn't report to local programs in this mode (the fallback). |
| Status request (pushall) | The printer sent its whole state. | – it refused `pushall` (an error answer, or the connection dropped right after it twice), or only parts of the state came: the bridge listens without asking and pieces the state together. Nothing to do. |
| Files (FTPS, port 990) | It can list the USB drive (how many files where). | – no files (no drive, or an empty one) or ✗ no answer or a refused login: prints are logged without the printer's copy of the file, and the line says what that costs and how to turn it on. |
| Camera | It took a frame (which stream). | – no frame: turn on LAN Only Liveview; the RTSPS stream also needs ffmpeg. Prints get no camera photo. |

Run it again after changing a setting on the printer. `--trust-new-certificate` accepts a changed certificate, as for `run`.

## Other ways to run it: Raspberry Pi, NAS, Docker, Node

Everything below this line is for a computer that isn't the Mac above: a Pi, a NAS, a spare Linux box. The settings are the same five.

## 1. Choose the printer's mode

The printer serves its local channels (MQTT for its reports, FTPS for its files, RTSPS for its camera) on your network, protected by an **access code** that only you know. Which of them it opens depends on its mode.

**Cloud mode (recommended).** The printer's normal mode: LAN Only mode off, Developer mode off. Bambu Handy, cloud printing, remote monitoring and automatic firmware updates keep working. Turn on **LAN Only Liveview** for the camera, and for the print files put a **USB drive** in the printer and turn on **Store Sent Files on External Storage**. This is also the safest mode for a read-only bridge: in cloud mode the printer itself refuses unsigned commands, so a program on your network with the access code can watch but not drive it.

| Channel | In cloud mode | What we know, and from where |
| --- | --- | --- |
| Reports (MQTT, 8883) | Yes (confirmed on an X2D in cloud mode, Nov 21, 2026) | Bambu's announcement of its authorization firmware (Jan 16, 2025; X1 first, the same on later models) restricts commands (starting prints, motion, heating, fans, AMS, calibration) and says "MQTT status push for tools like HomeAssistant" stays unaffected. ha-bambulab connects to cloud-mode printers locally ("cloud connected: sensors work, controls blocked") and lists the X2D; an H2D in cloud mode reported its status over local MQTT in its issue 1378 (Jun to Aug 2025). Not tried on an X2D by any source we found. |
| `pushall` answered | **Confirmed** (X2D, cloud mode, Nov 21, 2026: it answered with the whole state, not refused) | It is a status request, not a control, but third parties say the X2D and H2D want signed MQTT for commands, and none says whether `pushall` counts. The bridge doesn't depend on it: if the printer answers with an error, or drops the connection right after it twice in a row, the bridge stops asking and pieces the state together from the reports (the X series sends its whole state in each one). |
| Files (FTPS, 990) | Login confirmed (X2D, cloud mode, Nov 21, 2026); files not yet, as no USB drive was in; likely with one | A cloud-mode H2D owner read the print's `.3mf` from `/` once Store Sent Files on External Storage was on (ha-bambulab issue 1378, Aug 2025). On the H2 family FTPS sees only the external storage: the internal storage's `/cache` and `/model` answer 550 (bambuddy issue 2910, H2C, Aug to Oct 2026). The X2D's external storage is a USB drive (8 GB of internal eMMC besides). |
| Camera (RTSPS, 322) | Yes, with LAN Only Liveview on (confirmed on an X2D in cloud mode, Nov 21, 2026, through ffmpeg) | ha-bambulab: on the H2D, H2S, H3C and X2D "enable LAN Only Liveview … LAN mode itself is not required"; SimplyPrint says the same for the X1 and H2D. |

**Without files** (no USB drive, or Store Sent Files on External Storage off) the bridge still logs each print, its progress and end, and a camera photo, but the attempt gets no slicer file from the printer: no plate picture, filament and grams, settings or 3D view from it. Drop the `.gcode.3mf` into Spaghetti to add them by hand.

**The fallback: LAN Only mode with Developer mode.** Only if the check says the printer doesn't talk to the bridge in cloud mode. Turn on **LAN Only mode**, then **Developer mode** under it (Bambu's wiki: it "will open the MQTT channel, live stream, and FTP"). What it costs:

- LAN Only mode cuts the printer off from Bambu's cloud: no Bambu Handy or remote monitoring away from home, no sending prints from Bambu Studio over the internet (printing from Studio on your network still works), no cloud print history or Bambu notifications, and firmware updates from Studio or a USB drive instead of automatically.
- **Developer mode turns off the printer's authorization check, so it takes unsigned commands (start, stop, heat, move) from anything on your network that has the access code.** Bambu says it can't oversee what third-party software does in this mode and doesn't support it. The bridge still only listens; the risk is everything else on the network.

You can switch back whenever you like. Bambu has changed how third-party access to its printers is authorised before, and may again; because the bridge is optional, nothing in Spaghetti breaks when it stops working.

**Not built: Bambu's cloud MQTT.** With a Bambu account, Bambu's own servers relay the printer's reports to any program anywhere. Spaghetti doesn't use it ([decision 0003](decisions/0003-no-bambu-dependency.md)): it would need your Bambu login, depend on Bambu's servers and terms, and stop when Bambu changes them.

Keep the printer and the bridge's computer on the same network (same Wi-Fi or LAN, no guest-network isolation).

Sources (read Nov 21, 2026): [Bambu: Firmware update introducing new authorization control system](https://blog.bambulab.com/firmware-update-introducing-new-authorization-control-system-2) (Jan 2025); [Bambu wiki: Enable developer mode](https://wiki.bambulab.com/en/knowledge-sharing/enable-developer-mode); [ha-bambulab's README](https://github.com/greghesp/ha-bambulab) and [setup notes](https://docs.page/greghesp/ha-bambulab/setup); [ha-bambulab issue 1378: cover image and camera on an H2D](https://github.com/greghesp/ha-bambulab/issues/1378); [bambuddy issue 2910: the 3MF over FTPS on an H2C](https://github.com/maziggy/bambuddy/issues/2910); [SimplyPrint: Bambu Lab webcam setup](https://help.simplyprint.io/en/article/bambu-lab-integration-webcam-setup-and-usage-guide-u8nmfm/); [OpenBambuAPI: MQTT](https://github.com/Doridian/OpenBambuAPI/blob/main/mqtt.md); [beambam's notes on signed MQTT on the X2D and H2D](https://github.com/tribixbite/beambam) (a third party's claims).

## 2. Find the printer's IP, serial number and access code

All three are on the printer's screen, in the network and device settings **[uncertain: exact menus on the X2D]**:

- **IP address:** shown with the Wi-Fi network. Give the printer a fixed address in your router (a "DHCP reservation") so it doesn't change.
- **Serial number:** also shown in Bambu Studio next to the printer, and on a sticker. It names the MQTT topics (`device/<serial>/report`).
- **Access code:** shown under LAN Only Mode (eight characters), also while the mode is off. It is a password: don't share it, commit it or paste it in the issue tracker. It can be regenerated on the printer.

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

The bridge then fetches the print's `.gcode.3mf` from the printer's USB drive or SD card over FTPS (port 990, list and download only) and attaches it as the attempt's slicer file, so the app reads its settings, grams and plate picture as for any file. The file is only there with Store Sent Files on External Storage on. If it isn't found, the attempt still starts without it.

**While it prints**, once a minute the bridge sends the printer's progress (percent, minutes left, layer of total). Spaghetti shows it in place of the slicer's estimate while it's fresh and quietly goes back to the estimate when the bridge goes silent.

**A print ends** (finished, failed or cancelled): the bridge records when it ended and how long it took, and takes a camera frame as the attempt's photo (uploaded for the next browser to resize, like any photo that arrives without one). **It never says whether the print worked.** That is your call (Worked, Partly, Spaghetti); the attempt waits as "off the bed, how did it go?". For a failed or cancelled print, or when the printer's own detection reported spaghetti, it records a *suggested* failure tag that is offered when you pick Partly or Spaghetti.

**The AMS** is synced when the printer reports its trays and whenever they change. For each tray: the spool is found by its stored RFID tray UUID, else by brand, material and colour, and loaded into the slot. A Bambu spool (it has an RFID tag) that isn't in the pantry becomes a new spool. A tray without a tag that matches nothing is **left alone** and shown on the Printer page as "unknown spool in A3", so you can pick one. Where the printer knows the filament left (`remain`, not -1) the spool's level is set from it. Gram tracking will take over from there.

**When Spaghetti can't be reached**, events wait in `queue/` and are retried with backoff, in order. A job the app refuses for good (say, its attempt was deleted) is moved to `queue/failed/` so it doesn't block the rest.

## When something doesn't work

- **The Printer page says "Not set up" or "last heard … ago".** The bridge isn't running or can't reach the app. Check its log and the app URL; try `curl -H "Authorization: Bearer $BRIDGE_TOKEN" $BRIDGE_APP_URL/api/printer`.
- **"Printer link: Connection refused" or it connects but hears nothing.** Check the IP and the serial number (the serial names the topic the bridge listens to; a wrong one hears nothing). The access code is the MQTT password; a wrong one is refused at once. If all three are right, the printer doesn't talk to local programs in its mode: try [the fallback](#1-choose-the-printers-mode), LAN Only with Developer mode, and read what it costs first.
- **"The printer refused the status request (pushall)" in the log.** Nothing to fix: the bridge listens without asking from then on. Restarting it tries `pushall` once more.
- **No photo.** Turn on LAN Only Liveview on the printer; the RTSPS stream (port 322) also needs ffmpeg. A frame that can't be had is skipped without a fuss. `BRIDGE_CAMERA=off` stops the attempts.
- **No slicer file.** The bridge looks for `<job name>.gcode.3mf` and `<job name>.3mf` in the root of the printer's USB drive or SD card, `/cache` and `/model`. Put a USB drive in and turn on Store Sent Files on External Storage. A print started from the screen from a file on the drive works the same way; a print whose job name isn't its file name (one started from a MakerWorld profile is named after the profile) is not found **[uncertain on the X2D]**.
- **A print was cancelled but is logged as failed (or the other way round).** Cancelling is recognised by the error code `0300_400C` or a return to idle **[uncertain: firmware differs]**.

## What we couldn't confirm for the X2D [uncertain]

**Confirmed on a real X2D in cloud mode (LAN Only off, Developer mode off, LAN Only Liveview on), Nov 21, 2026**, by `spaghetti-bridge check`: the printer link (MQTT 8883 with the access code), reports, the `pushall` status request (answered with the whole state, not refused), FTPS login on 990 (no files seen: no USB drive was in) and the camera (RTSPS 322 through ffmpeg). Still open: what FTPS lists with a USB drive in, and the items below that the check doesn't touch.

- Whether the X2D uses the same MQTT report fields as the X1 and P1 families (`gcode_state`, `mc_percent`, `layer_num`, `ams`…), and whether its dual-nozzle setup adds fields the bridge ignores.
- The menu names on the X2D. (Reports, `pushall` and the FTPS login are confirmed, see above.)
- The FTPS folders for prints on the X2D's USB drive, and that port 990 and the user `bblp` are the same.
- Nothing more about the camera: RTSPS on 322 with LAN Only Liveview on works through ffmpeg.
- The AMS numbering on the X2D (units 0 to 3 as A to D; single-spool units such as the AMS HT are ignored for now) and the external spool as `vt_tray`.
- The HMS codes for the AI's spaghetti detection (`0C00_0300_0002_0001` in the community list) and the error code for a user cancel.
- The report fixtures in `test/bridge/fixtures.ts` were written by hand to the community-documented format, not recorded from a printer. When you have a real capture, add it there.
