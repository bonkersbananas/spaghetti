# Bridge tests

There is no printer in CI, so the tests bring a fake one:

- `fake-printer.ts` is an in-process MQTT broker (aedes) on a local port. It records everything a client publishes
  (the read-only test checks that the bridge sent exactly one status request, `pushall`) and replays report
  sequences when asked.
- `fixtures.ts` has the sequences: a full print, a failed print (AI spaghetti detection), a cancel, a failure with no
  spaghetti, AMS changes and a restart mid-print. **They were written by hand to the community-documented report
  format** (the OpenBambuAPI MQTT notes, the Home Assistant Bambu Lab integration's field names, bambulabs_api). They
  are not recordings from an X2D. When someone has a real capture, put it next to these and make the tests pass on it.
- The printer's SD card is a stub implementing `PrinterFiles` (list and download only), serving the two-plate
  `.gcode.3mf` that `e2e/fixtures/slicer-file.ts` builds; the camera is a stub returning a JPEG.
- `e2e/bridge.spec.ts` runs the whole bridge against a real local app with a real agent token.
