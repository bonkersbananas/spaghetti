# 0058. "Open in Bambu Studio" hands Bambu Studio a short-lived signed link

Status: Accepted (refines [0003](0003-no-bambu-dependency.md): the app never needs Bambu Studio; this only offers it)

**Decision:** On a computer, a model's card has an "Open in Bambu Studio" action (and an idea or build with exactly one openable file has a page-level one beside its quiet actions). It asks `POST /api/files/:id/open-link` for a link and sends the browser to Bambu Studio's address for it: `bambustudio://open?file=<link>` on Windows and Linux, `bambustudioopen://<link>` on macOS (both URL-encoded; the two schemes are what Bambu Studio's source reads: `GUI_App::post_init` and `MacOpenURL`). Bambu Studio then downloads the file itself.

- **Which file:** a sliced model opens its sliced `.gcode.3mf` (what you would print); a plain `.3mf` model or a slicer file opens its own bytes. Bambu Studio imports only `.3mf` by address (`Plater::import_model_id` refuses any other extension), so an `.stl` that isn't sliced offers nothing; wrapping an STL in a 3MF was left out as the simpler choice (slice it, then open the result).
- **Nothing for phones and tablets:** Bambu Studio doesn't run there (touch devices and mobile user agents are excluded).
- **No answer from the browser:** it can't tell whether an app opened, so a toast says "Nothing opened?" with "Download it instead" (the plain, signed-in download).
- **Bambu Studio asks once:** outside MakerWorld's hosts it shows "This file is not from a trusted site, do you want to open it anyway?" (its trusted list is compiled in). People answer Yes; we can't change that.

**The link:** `/open/<id>.<part>.<expires>.<signature>/<name>`. The signature is an HMAC-SHA256 of the first three, under a key derived (HKDF-SHA256, its own info string) from the existing `WEBHOOK_SECRET_KEY` secret, so it can't stand in for a webhook secret and needs no new secret to set. It is checked in constant time before anything is read; the link works for 10 minutes (`OPEN_LINK_MINUTES`), names one file and one part (another file's id, the other part or a moved expiry fails the signature), is read-only (`GET`, `Cache-Control: no-store`, `attachment`, `nosniff`), and still needs the file to be live (a deleted idea's file stops at once). The last path segment is only the file's plain name (ASCII, with its real extension), because Bambu Studio names the saved file from the end of the address. Only a signed-in person can make one (people only: no agent scope). Every failure is the same plain 404. Without `WEBHOOK_SECRET_KEY` the endpoint answers 503 `open_unavailable`.

**Why:** Marie (xixa), Nov 14: "It would be nice to have the option to open a idea/build in bambu studio." Today it means downloading, finding and opening the file. Bambu Studio fetches without the app's cookies, so the file has to be reachable by an address that proves itself: a stateless HMAC needs no table, no cleanup and no new secret, and ten minutes is enough to read Bambu Studio's question.

**Consequences:**

- The link is a bearer capability for ten minutes: anyone who sees it (the browser history, a shared screen) can fetch that one file in that time. Accepted: it is a model file in a two-person workspace.
- Rotating `WEBHOOK_SECRET_KEY` ends links in flight (and breaks webhooks, as before).
- `/open/*` is the one non-`/api` address that answers without a session; it is in `run_worker_first` and the auth guard's public list.
- Not verified in the sandbox: that Bambu Studio on a real Mac or PC opens the file.
