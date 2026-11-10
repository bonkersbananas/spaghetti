# 0003. Never depend on a Bambu service

Status: Accepted

**Decision:** Spaghetti understands the printer's details but never needs a Bambu service (cloud, Handy app, account, MQTT broker) to work.

**Why:** a notebook that stops working when a vendor changes an API or an account is locked is not a notebook. Bambu's cloud and protocols are undocumented and change.

**Consequences:** everything the app learns about the printer comes from files people hand it ([0013](0013-bambu-studio-and-orca-files-only.md)) or from what they type. A future printer bridge ([0010](0010-no-printer-connection-for-now.md)) must be optional and the app must work without it. See [docs/printer.md](../printer.md).
