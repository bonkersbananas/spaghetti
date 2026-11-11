# 0036. The 3D view reads the slicer file in the browser and loads only when asked for

Status: Accepted

**Decision:** A sliced attempt's `.gcode.3mf` can be opened in 3D from a quiet "3D" control on its plate picture. The browser fetches the file from the existing `/api/files/:id`, a Web Worker streams the plate's G-code through the reader in `shared/gcode` (extrusion moves only, per layer, thinned to a segment budget that is smaller on phones), and the viewer (three.js, one instanced box per segment, a layer slider) draws the layers as they arrive. Nothing of it is in any screen's first load: the viewer, three.js and the worker are lazy chunks, fetched when a finger or the pointer nears the "3D" control, and left out of the service worker's precache. The viewer only ever reads; it never sends anything to the printer ([0010](0010-optional-read-only-printer-bridge.md)).

**Why:** Carl Oscar and Marie wanted "to see models as they are", and the file is already kept with the attempt. Parsing in the browser keeps the Worker free of anything but bytes (decision 0001), and streaming keeps a 50–100 MB G-code from ever sitting whole in a phone's memory.

**Consequences:** The viewer needs the network: a file is fetched when it is opened, and is not kept for offline use (the app's offline mode is read-only and caches photos, not slicer files). Only files the server kept (up to `MAX_SLICER_FILE_BYTES`, 25 MB) can be opened; larger ones keep only what they said. A project `.3mf` that was never sliced has no G-code and says so. Revisit offline use if people ask for it (cache the file by id: its bytes never change).
