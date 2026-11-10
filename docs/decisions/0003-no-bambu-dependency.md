# 0003. Never depend on a Bambu service

Status: Accepted

**Decision:** Spaghetti understands the printer's details but never needs a Bambu service (cloud, Handy app, account, MQTT broker) to work.

**Why:** a notebook that stops working when a vendor changes an API or an account is locked is not a notebook. Bambu's cloud and protocols are undocumented and change.

**Consequences:** what the app learns about the printer comes from files people hand it ([0013](0013-bambu-studio-and-orca-files-only.md)), from what they type, or from the optional local bridge. That bridge ([0010](0010-optional-read-only-printer-bridge.md)) talks to the printer over the local network only and the app works without it. See [docs/printer.md](../printer.md).
