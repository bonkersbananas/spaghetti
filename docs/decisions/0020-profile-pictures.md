# 0020. Profile pictures are small squares cropped in the browser, stored in R2 under a versioned address

Status: Accepted

**Decision:** Each person can set a profile picture from the account menu. The browser crops it (a circle mask over a square, drag and pinch or scroll) and resizes it to 256 px, WebP or JPEG ([0004](0004-photos-resized-in-the-browser.md)); `PUT /api/people/me/photo` stores it in R2 as `people/<id>/<version>` and `users.photo_key` points at it. Every `person` carries `photoUrl` (`/api/people/<id>/photo?v=<version>`), so a new picture is a new address, cached for a year, and the service worker keeps it for offline.

**Rules:** only people set or remove their own picture, never an agent (`person_only`); agents only read `photoUrl`. Initials on the person's color stay under the picture while it loads, if it fails and offline, so nothing shifts. The other person sees a change through a `person` entry in the change feed. Changing or removing a picture has Undo in the toast; the previous picture's bytes are read before the change, since the server deletes them. The crop and upload code is a lazy chunk that loads when the account menu opens.

**Left out:** a second 96 px size (256 px at 24 px is a few KB, so one file is simpler), a picture for agents (they keep their mark), and a separate camera button (the system picker offers the camera and the library).
