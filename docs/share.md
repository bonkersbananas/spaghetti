# Sharing into Spaghetti

An idea usually turns up while reading something else: a model on MakerWorld, a photo in the camera roll, a link in a chat. Four ways in, from one tap to a few; every one makes an **idea** that lands at the top of the Ideas inbox. A shared link goes into the note, so the link card shows its title (nothing new is fetched for it).

| Where | How |
| --- | --- |
| Android, desktop Chrome and Edge (installed app) | Spaghetti is in the share sheet: a Web Share Target in the manifest. |
| iPhone | Two iOS Shortcuts and a capture-only key (below). Safari doesn't support share targets for web apps. |
| Desktop browsers | The "Save to Spaghetti" bookmarklet. |
| Anything else (a script, another app) | `POST /api/capture` with a token. |

## Installed app (Web Share Target)

`public/manifest.webmanifest` declares `share_target`: a multipart `POST /api/share` with `title`, `text`, `url` and image files (`media`). The service worker (`src/sw/sw.js`, `receiveShare`) answers it, so it works with no signal: it keeps the form in the `sg-share` cache and redirects to `/share?id=…`. The page (`routes/_app/share.tsx`) reads the cache, saves the idea through the outbox (photos are resized in the browser, as for any capture; offline it waits and goes up when the connection is back) and opens the **Captured** sheet on the inbox, where the note can take a word more (autosaved) or the idea can be opened. Nothing waits for a button: the idea is saved before the sheet shows.

Not signed in: the sign-in page returns to `/share?id=…` and the share is kept until then. If the service worker isn't there (never installed, cleared), the Worker answers the POST itself with a redirect to `/share?title=…&text=…&url=…`: the words arrive, photos can't.

Android's share sheet often puts the link inside `text` as well as in `url`; it is added to the note once. A shared title that only repeats the text or the link isn't used as the idea's title.

## iPhone: two Shortcuts

Open **Agents** (account menu), then **Set up sharing from iPhone**. It makes a token with the `capture` scope only (it can add ideas and nothing else, not even read them) and shows these steps with the address and the token already in them, each value with a Copy button, and **Copy all steps** for the lot. Like any token it is shown once; the card makes a new one each time (under the agent "Share from iPhone"), and the old one can be revoked on the same page.

Build them in the Shortcuts app. The iPhone's menus change between iOS versions, so the names below are the ones to look for.

**Share to Spaghetti** (links and text)

1. Tap +, name it `Share to Spaghetti`.
2. Tap (i), turn on **Show in Share Sheet**, and under **Share Sheet Types** keep only **URLs** and **Text**.
3. Add **Get Contents of URL**, with the URL `https://spaghetti.day/api/capture`.
4. **Show More**: Method **POST**; add a header `Authorization` with the value `Bearer spg_…` (your token).
5. **Request Body**: **Form**. Add a **Text** field named `text` and set its value to **Shortcut Input**.
6. Last, **Show Notification** with **Contents of URL** as its text. It says "Saved to Spaghetti: …" or what went wrong (for example that the key was refused), so a failure shows on the phone instead of being silent.

**Share photo to Spaghetti** (photos)

1. A second shortcut, named `Share photo to Spaghetti`, with only **Images** as its Share Sheet Type.
2. Add **Convert Image** to **JPEG** (the iPhone's photos are HEIC, which Spaghetti doesn't store), with **Shortcut Input** as the image.
3. Add **Get Contents of URL** with the same URL, POST and `Authorization` header.
4. **Request Body**: **File**, and choose the **Converted Image**.
5. Last, the same **Show Notification** with **Contents of URL**.

To use them: in Safari, Photos or any app, tap Share and choose the shortcut (**Edit Actions** in the share sheet's list puts it first). The idea is saved on the server at once.

## Desktop: the bookmarklet

On the Agents page, drag **Save to Spaghetti** to the bookmarks bar (or copy it and make a bookmark whose address is that text). On any page it opens a small window at `/share?title=…&url=…&text=…` (the page's title and address, and whatever is selected), signed in as you, and the idea is saved straight away. It holds no token. If the browser blocks the window it opens in the same tab.

## `POST /api/capture`

For the Shortcuts, and for anything else that has a token. Scope `capture` (people may use it with their session). It reads the body in any of these shapes (`readBody` in `src/worker/routes/capture.ts`, with the tests in `test/worker/capture.test.ts`):

| Content-Type | Body |
| --- | --- |
| `application/json` | `{ "url"?, "text"?, "title"?, "id"?, "image"? }` (`image` is a base64 JPEG or WebP) |
| `application/x-www-form-urlencoded` | the same text fields: what a Shortcuts **Form** body with only text fields sends |
| `multipart/form-data` | the same text fields, and photos in any file part. A part that isn't an image is read as text (Shortcuts can send a URL or rich text as a file part): as `text`, `url` or `title` by its field name, otherwise as loose text |
| `image/jpeg`, `image/webp` (or any body that starts like an image) | the photo itself |
| `text/plain`, `text/uri-list` | the words, or the link when it is only a link |

`id`, `title`, `text` and `url` may also be in the query string. A `text` that is only a link is the link.

```sh
curl -X POST https://spaghetti.day/api/capture \
  -H "Authorization: Bearer spg_…" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://makerworld.com/en/models/123","title":"Drawer bins"}'
# 201 {"id":"…","url":"https://spaghetti.day/ideas/…","photos":0,"message":"Saved to Spaghetti: Drawer bins"}
```

The answer depends on who asks: a JSON request (or `Accept: application/json`) gets the JSON above, and an error as `{ "error": { "code", "message" } }`; anything else, such as a Shortcut, gets one plain sentence, `Saved to Spaghetti: Drawer bins`, or on failure `Spaghetti couldn't save that: there was no link, text, title or photo in it.` with the same status (so a notification can show it).

The note is the text, then the link (once); the title is the title if there is one. At least one of link, text, title or photo is needed (`400`). Photos are stored as they came, JPEG or WebP only (`415` otherwise: HEIC must be converted first), and flagged `needsResize`: the next browser that opens the app resizes them ([decision 0004](decisions/0004-photos-resized-in-the-browser.md)). An `id` (a UUID) makes the call safe to repeat. The idea is the token owner's, marked "via" the token's agent.
