/**
 * A stand-in for the Anthropic API, for the e2e tests and the screenshots: Claude drafting an idea from a model
 * page is a Worker-side call, so a browser test can't stub it; the Worker is pointed here instead
 * (ANTHROPIC_BASE_URL). The page a draft is asked for decides the answer by a word in its address:
 * `slow` takes a few seconds (the "reading the page" state stays long enough to look at), `broken` can't be read,
 * `refused` is refused, anything else is a good draft.
 *
 * A request that asks what to try on the next attempt is the failure coach (decision 0027): see answerCoach.
 *
 * A request that asks for the pattern in a week is the week's paragraph (decision 0030): a word in the notebook (a
 * build's title or a print's note) decides the answer: `slow` takes ten seconds, `refused` is refused, `broken` is an
 * API error, `quiet` has nothing to add, anything else is a short paragraph.
 *
 * A request that asks which models to print next is the idea scout (decision 0039): a word in the notebook (a saved
 * idea's title) decides the answer: without the word `scout` in the notebook it finds nothing (unless started with
 * `scoutAlways`, as the screenshots are), `scout-slow` takes ten seconds, `scout-refused` is refused, `scout-broken` is an API error, `scout-hollow`
 * suggests only a dead link, anything else is three good models and one dead link (an address with `dead` in it,
 * which the Worker drops because it checks links, as it does for real, against nothing but this stand-in).
 *
 * A request with a photo in it is a print being read (decision 0022). A word in the build's title or the attempt's
 * note decides the answer: `slow` takes ten seconds ("Looking at the photo…" stays long enough to look at), `refused`
 * is refused, `broken` is an API error, `unsure` can't tell, `spaghetti` or `tangle` is a failed print, `partly` a
 * partly good one, anything else worked.
 */
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { root } from "./wrangler.ts";

/** How long a `slow` page takes. */
export const SLOW_MS = 4000;
/** A `slow` photo takes longer: the screens poll every few seconds while Claude looks, and a shot or a test needs to catch it. */
export const SLOW_PHOTO_MS = 10_000;

const draft = {
  readable: true,
  title: "Cable comb for the desk",
  note: "A small comb that keeps the desk cables in line. Prints in minutes and fixes the tangle at once.",
  designer: "Mila Okafor",
  license: "CC BY 4.0",
  material: "PETG",
  plate: "Textured PEI plate",
  settings: "0.2 mm layers, 15% infill, no supports",
  imageUrls: [] as string[],
};

const reads = {
  worked: {
    outcome: "success",
    failureTags: [],
    successNotes: ["nice-surface"],
    reason: "Clean walls and a smooth top; looks like a good one.",
  },
  partly: {
    outcome: "partial",
    failureTags: ["stringing"],
    successNotes: [],
    reason: "Mostly clean, with fine strings between the teeth.",
  },
  spaghetti: {
    outcome: "failed",
    failureTags: ["spaghetti", "bed-adhesion"],
    successNotes: [],
    reason: "Loose strands across the top half; looks like it lost adhesion early.",
  },
  unsure: { outcome: null, failureTags: [], successNotes: [], reason: null },
};

const noLabelValues = {
  brand: null,
  material: null,
  variant: null,
  colorName: null,
  colorHex: null,
  netGrams: null,
  diameterMm: null,
  nozzleTempMin: null,
  nozzleTempMax: null,
  bedTempMin: null,
  bedTempMax: null,
  dryTempC: null,
  dryHours: null,
  productCode: null,
};
const jadeLabel = {
  ...noLabelValues,
  brand: "Bambu Lab",
  material: "PLA",
  variant: "Basic",
  colorName: "Jade White",
  colorHex: "#f4f1ea",
  netGrams: 1000,
  diameterMm: 1.75,
  nozzleTempMin: 190,
  nozzleTempMax: 230,
  bedTempMin: 45,
  bedTempMax: 65,
  dryTempC: 55,
  dryHours: 8,
  productCode: "10100",
};
const labels = {
  good: [jadeLabel],
  partly: [{ ...noLabelValues, brand: "Polymaker", material: "PETG", nozzleTempMin: 240, nozzleTempMax: 260 }],
  two: [
    jadeLabel,
    { ...jadeLabel, material: "PETG", variant: "HF", colorName: "Black", colorHex: "#1d1d1f", productCode: "33102" },
  ],
  none: [] as unknown[],
};

/**
 * A request for a spool's label (decision 0031). A word in what the person wrote about the spool (its brand, color
 * or note) decides the answer: `slow` takes ten seconds, `refused` is refused, `broken` is an API error,
 * `unreadable` finds no label, `partly` reads only a brand, a material and the nozzle range, `two` finds two spools,
 * anything else is a good read of one spool.
 */
async function answerLabel(body: string, response: import("node:http").ServerResponse) {
  const written = (/What they already wrote about this spool:([^"]*)/.exec(body)?.[1] ?? "").toLowerCase();
  if (written.includes("slow")) await new Promise((resolve) => setTimeout(resolve, SLOW_PHOTO_MS));
  response.setHeader("Content-Type", "application/json");
  if (written.includes("broken")) {
    response.statusCode = 500;
    response.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "broken" } }));
    return;
  }
  const refused = written.includes("refused");
  const spools = written.includes("unreadable")
    ? labels.none
    : written.includes("partly")
      ? labels.partly
      : written.includes("two")
        ? labels.two
        : labels.good;
  response.end(
    JSON.stringify({
      id: "msg_fake",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: refused ? [] : [{ type: "text", text: JSON.stringify({ spools }) }],
      stop_reason: refused ? "refusal" : "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
  );
}

async function answerPhoto(body: string, response: import("node:http").ServerResponse) {
  const title = [/The build is called: ([^"\\]*)/, /Their note on this attempt: ([^"\\]*)/]
    .map((pattern) => pattern.exec(body)?.[1] ?? "")
    .join(" ")
    .toLowerCase();
  if (title.includes("slow")) await new Promise((resolve) => setTimeout(resolve, SLOW_PHOTO_MS));
  response.setHeader("Content-Type", "application/json");
  if (title.includes("broken")) {
    response.statusCode = 500;
    response.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "broken" } }));
    return;
  }
  const refused = title.includes("refused");
  const read = title.includes("unsure")
    ? reads.unsure
    : title.includes("spaghetti") || title.includes("tangle")
      ? reads.spaghetti
      : title.includes("partly")
        ? reads.partly
        : reads.worked;
  response.end(
    JSON.stringify({
      id: "msg_fake",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: refused ? [] : [{ type: "text", text: JSON.stringify(read) }],
      stop_reason: refused ? "refusal" : "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
  );
}

const noChange = {
  bedTemperature: null,
  nozzleTemperature: null,
  chamberTemperature: null,
  brim: null,
  supportEnabled: null,
  supportType: null,
  layerHeight: null,
  infillDensity: null,
  wallLoops: null,
  filamentDried: null,
  bedType: null,
  nozzleDiameter: null,
};

/** What the coach suggests (decision 0027): a brim, a warmer bed and drying as settings, a speed as a note. */
const coachAnswer = {
  suggestions: [
    {
      title: "Add a brim",
      why: "The corners lifted first; a brim holds them down.",
      change: { ...noChange, brim: true },
      note: null,
    },
    {
      title: "Warm the bed a little",
      why: "The stern corners curled as they cooled; 5 °C more keeps them down.",
      change: { ...noChange, bedTemperature: 65 },
      note: null,
    },
    {
      title: "Dry the filament first",
      why: "A spool that sat open for weeks picks up moisture, and wet filament warps.",
      change: { ...noChange, filamentDried: true },
      note: null,
    },
    {
      title: "Slow the outer wall to 60 mm/s",
      why: "Fine strings on the walls point at speed.",
      change: null,
      note: "Outer wall 60 mm/s",
    },
  ],
};

/**
 * A request that asks what to try next is the failure coach. A word in the build's title or the attempt's note picks
 * the answer: `slow`, `broken`, `refused`; `coach` (or the seed's "curled" stern) gets the good suggestions; anything
 * else has nothing useful to say, so the many failed attempts of other tests and the seed stay quiet.
 */
async function answerCoach(body: string, response: import("node:http").ServerResponse) {
  const words = [/The build: ([^"\\]*)/, /Their note: ([^"\\]*)/]
    .map((pattern) => pattern.exec(body)?.[1] ?? "")
    .join(" ")
    .toLowerCase();
  if (words.includes("slow")) await new Promise((resolve) => setTimeout(resolve, SLOW_PHOTO_MS));
  response.setHeader("Content-Type", "application/json");
  if (words.includes("broken")) {
    response.statusCode = 500;
    response.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "broken" } }));
    return;
  }
  const refused = words.includes("refused");
  const answer = words.includes("coach") || words.includes("curled") ? coachAnswer : { suggestions: [] };
  response.end(
    JSON.stringify({
      id: "msg_fake",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: refused ? [] : [{ type: "text", text: JSON.stringify(answer) }],
      stop_reason: refused ? "refusal" : "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
  );
}

/** The week's paragraph, as the stand-in writes it. */
export const WEEK_NOTE =
  "PETG warped twice this week, and both times the bed was 70 °C. The prints that worked all had a brim: worth keeping for the next one.";

async function answerWeek(body: string, response: import("node:http").ServerResponse) {
  // Only the notebook decides, not the instructions in the system prompt.
  let words = "";
  try {
    words = String(JSON.parse(body).messages?.[0]?.content ?? "").toLowerCase();
  } catch {
    // An unreadable request gets the good answer.
  }
  if (words.includes("slow")) await new Promise((resolve) => setTimeout(resolve, SLOW_PHOTO_MS));
  response.setHeader("Content-Type", "application/json");
  if (words.includes("broken")) {
    response.statusCode = 500;
    response.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "broken" } }));
    return;
  }
  const refused = words.includes("refused");
  const answer = { note: words.includes("quiet") ? null : WEEK_NOTE };
  response.end(
    JSON.stringify({
      id: "msg_fake",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: refused ? [] : [{ type: "text", text: JSON.stringify(answer) }],
      stop_reason: refused ? "refusal" : "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
  );
}

/** The models the stand-in scout suggests; the last one's link is dead. */
const SCOUT_MODELS = [
  {
    url: "https://makerworld.com/en/models/1100001-drawer-divider-set",
    title: "Drawer divider set",
    why: "For the kitchen drawer you saved.",
  },
  {
    url: "https://www.thingiverse.com/thing:6100002",
    title: "Planter with a saucer",
    why: "Uses the PETG you have on the shelf.",
  },
  {
    url: "https://makerworld.com/en/models/1100003-cable-chain-clips",
    title: "Cable chain clips",
    why: "A neat second try at the cable comb.",
  },
  {
    url: "https://makerworld.com/en/models/1100004-dead-link-vase",
    title: "Spiral vase",
    why: "Looks calm to print.",
  },
];

async function answerScout(base: string, always: boolean, body: string, response: import("node:http").ServerResponse) {
  let words = "";
  try {
    words = String(JSON.parse(body).messages?.[0]?.content ?? "").toLowerCase();
  } catch {
    // An unreadable request gets the good answer.
  }
  if (words.includes("scout-slow")) await new Promise((resolve) => setTimeout(resolve, SLOW_PHOTO_MS));
  response.setHeader("Content-Type", "application/json");
  if (words.includes("scout-broken")) {
    response.statusCode = 500;
    response.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "broken" } }));
    return;
  }
  const refused = words.includes("scout-refused");
  // Only a notebook that mentions "scout" (or a stand-in started for the screenshots) gets models: the e2e tests' other
  // specs share the database and must find Today as they left it.
  const models =
    !always && !words.includes("scout") ? [] : words.includes("scout-hollow") ? SCOUT_MODELS.slice(3) : SCOUT_MODELS;
  const answer = {
    suggestions: models.map((model, index) => ({ ...model, imageUrl: `${base}/images/${(index % 3) + 1}.jpg` })),
  };
  response.end(
    JSON.stringify({
      id: "msg_fake",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: refused ? [] : [{ type: "text", text: JSON.stringify(answer) }],
      stop_reason: refused ? "refusal" : "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
  );
}

/** What the webhook receiver below was sent: the signature headers and the body, for the tests to check. */
export interface ReceivedHook {
  path: string;
  signature: string;
  timestamp: string;
  delivery: string;
  body: string;
}

/**
 * Also a stand-in for a webhook receiver (the Worker may post to http://127.0.0.1 only while it is pointed at these
 * stand-ins: WEBHOOKS_ALLOW_LOCAL). POST /hooks/ok answers 200, /hooks/broken answers 500; GET /hooks lists what
 * arrived and DELETE /hooks forgets it.
 */
function receiveHook(request: IncomingMessage, response: ServerResponse, received: ReceivedHook[]) {
  const path = request.url ?? "";
  if (request.method === "GET") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(received));
    return;
  }
  if (request.method === "DELETE") {
    received.length = 0;
    response.statusCode = 204;
    response.end();
    return;
  }
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    const header = (name: string) => String(request.headers[name] ?? "");
    received.push({
      path,
      signature: header("spaghetti-signature"),
      timestamp: header("spaghetti-timestamp"),
      delivery: header("spaghetti-delivery"),
      body,
    });
    response.statusCode = path.endsWith("/broken") ? 500 : 200;
    response.end();
  });
}

export async function startFakeClaude(
  port: number,
  { scoutAlways = false }: { scoutAlways?: boolean } = {},
): Promise<{ url: string; stop: () => void; server: Server }> {
  const base = `http://127.0.0.1:${port}`;
  // The model's pictures, served from here (the Worker allows this one origin for pictures while it talks to a stand-in).
  const pictures = [1, 2, 3].map((n) => readFileSync(join(root, `e2e/fixtures/model-${n}.jpg`)));
  const received: ReceivedHook[] = [];
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/hooks")) return receiveHook(request, response, received);
    const picture = /^\/images\/(\d)\.jpg$/.exec(request.url ?? "");
    if (picture) {
      response.setHeader("Content-Type", "image/jpeg");
      response.end(pictures[Number(picture[1]) - 1] ?? "");
      return;
    }
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", async () => {
      if (body.includes("Read the spool label")) return answerLabel(body, response);
      if (body.includes("What should they try on the next attempt?")) return answerCoach(body, response);
      if (body.includes("Which models should they print next?")) return answerScout(base, scoutAlways, body, response);
      if (body.includes("What is the pattern in this week, if there is one?")) return answerWeek(body, response);
      if (body.includes('"type":"image"')) return answerPhoto(body, response);
      const asked = body.match(/https?:\/\/[^"\\\s]+/)?.[0] ?? "";
      if (asked.includes("slow")) await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
      const refused = asked.includes("refused");
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          id: "msg_fake",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: refused
            ? []
            : [
                {
                  type: "text",
                  text: JSON.stringify(
                    asked.includes("broken")
                      ? { ...draft, readable: false }
                      : { ...draft, imageUrls: [1, 2, 3].map((n) => `${base}/images/${n}.jpg`) },
                  ),
                },
              ],
          stop_reason: refused ? "refusal" : "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${port}`, stop: () => server.close(), server };
}
