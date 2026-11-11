/**
 * A stand-in for the Anthropic API, for the e2e tests and the screenshots: Claude drafting an idea from a model
 * page is a Worker-side call, so a browser test can't stub it; the Worker is pointed here instead
 * (ANTHROPIC_BASE_URL). The page a draft is asked for decides the answer by a word in its address:
 * `slow` takes a few seconds (the "reading the page" state stays long enough to look at), `broken` can't be read,
 * `refused` is refused, anything else is a good draft.
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

export async function startFakeClaude(port: number): Promise<{ url: string; stop: () => void; server: Server }> {
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
