# 0016. "How did it go?" arrives as a web push nudge, once, answerable in a tap

Status: Accepted

**Decision:** the Worker sends Web Push (VAPID, signed and encrypted with WebCrypto only) when a print comes off the bed (the bridge's `ended_at`) or, without the bridge, ten minutes after its slicer estimate. At most one nudge per attempt per person, to the person who started it, and to the other person only if they chose "Also tell me about their prints" on that device. Never between 22:00 and 07:00 in the device's time zone: those wait until morning and are dropped after twelve hours or if an outcome came first. Where the platform has notification buttons, Worked / Partly / Spaghetti record the outcome through the service worker (the same `POST /attempts/:id/finish` the app uses; offline, into the outbox); tapping the notification opens the attempt sheet (`/builds/:id?attempt=…&finish=1`).

**Why:** a print finishes while nobody is at the printer, and the outcome only reaches the journal if someone remembers. One calm nudge at the right moment, answerable without opening the app, is how failures get recorded instead of forgotten.

**Consequences:** a cron every 5 minutes (a cheap query over open attempts) next to the daily purge. Subscriptions are per device and person in D1; a 404 or 410 from the push service removes one, and signing out forgets the device. The private VAPID key is a Worker secret (`VAPID_PRIVATE_KEY`, never in the repository), the public one a var; docs/deploy.md says how to make and set them. iPhone only gets web push for an app added to the Home Screen (iOS 16.4+) and has no notification buttons. Desktop Chrome shows two buttons, so there Worked and Spaghetti are offered and Partly is one tap away in the sheet. Quiet hours are fixed, not a setting.
