import { expect, it } from "vitest";
import { smoke } from "../../scripts/bridge-smoke.ts";

// The release build runs the same check on the compiled program (scripts/bridge-smoke.ts <binary>). Here it is the
// source, over real TLS: MQTT with a pinned certificate, FTPS, and an HTTP app, with a print replayed through them.
it("the bridge, end to end over TLS and FTPS, sends the printer only pushall and never writes to its card", async () => {
  const result = await smoke("node", ["bridge/index.ts"]);
  expect(result.problems, result.log).toEqual([]);
}, 60_000);
