/**
 * A stand-in for the Anthropic API, for the e2e tests and the screenshots: Claude drafting an idea from a model
 * page is a Worker-side call, so a browser test can't stub it; the Worker is pointed here instead
 * (ANTHROPIC_BASE_URL). The page a draft is asked for decides the answer by a word in its address:
 * `slow` takes a few seconds (the "reading the page" state stays long enough to look at), `broken` can't be read,
 * `refused` is refused, anything else is a good draft.
 */
import { createServer, type Server } from "node:http";

/** How long a `slow` page takes. */
export const SLOW_MS = 4000;

const draft = {
  readable: true,
  title: "Cable comb for the desk",
  note: "A small comb that keeps the desk cables in line. Prints in minutes and fixes the tangle at once.",
  designer: "Mila Okafor",
  license: "CC BY 4.0",
  material: "PETG",
  plate: "Textured PEI plate",
  settings: "0.2 mm layers, 15% infill, no supports",
  imageUrls: [],
};

export async function startFakeClaude(port: number): Promise<{ url: string; stop: () => void; server: Server }> {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", async () => {
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
                  text: JSON.stringify(asked.includes("broken") ? { ...draft, readable: false } : draft),
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
