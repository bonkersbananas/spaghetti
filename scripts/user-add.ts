/**
 * pnpm user:add — add one of the two people, or reset their password.
 *
 *   pnpm user:add                         # asks for everything
 *   pnpm user:add --username sam --name Sam --color sea
 *   pnpm user:add ... --remote            # the deployed D1 database
 *   pnpm user:add ... --persist-to /data  # local state elsewhere (the container)
 *   pnpm user:add --check --remote        # writes nothing: only proves the database can be reached
 *
 * The password is asked for without echo, or read from SPAGHETTI_PASSWORD.
 * Local by default; it applies local migrations first.
 */
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { PERSON_COLORS, type PersonColor } from "../src/shared/people.ts";
import { upsertUser } from "./lib/users.ts";
import { applyMigrations, executeSql, type Target } from "./lib/wrangler.ts";

const { values } = parseArgs({
  options: {
    username: { type: "string" },
    name: { type: "string" },
    color: { type: "string" },
    remote: { type: "boolean", default: false },
    check: { type: "boolean", default: false },
    "persist-to": { type: "string", default: process.env.SPAGHETTI_STATE_DIR },
  },
});

const rl = createInterface({ input: process.stdin, output: process.stdout });

async function ask(question: string, fallback?: string): Promise<string> {
  if (fallback) return fallback;
  if (!process.stdin.isTTY) throw new Error(`Missing --${question.toLowerCase().split(" ")[0]}`);
  return (await rl.question(`${question}: `)).trim();
}

async function askHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error("Set SPAGHETTI_PASSWORD when not running in a terminal.");
  const output = process.stdout;
  const write = output.write.bind(output);
  output.write(`${question}: `);
  // Mute echo while the password is typed.
  (output as { write: unknown }).write = () => true;
  try {
    return await rl.question("");
  } finally {
    (output as { write: unknown }).write = write;
    output.write("\n");
  }
}

async function main() {
  if (values.check) {
    const target: Target = { remote: values.remote, persistTo: values["persist-to"] };
    executeSql("SELECT count(*) FROM users;", target);
    console.log(`✓ The ${target.remote ? "deployed" : "local"} database can be reached. Nothing was written.`);
    rl.close();
    return;
  }
  const username = (await ask("Username (to sign in)", values.username)).toLowerCase();
  const name = await ask("Name (shown in the app)", values.name);
  const color = (await ask(`Color (${PERSON_COLORS.join(", ")})`, values.color)) as PersonColor;
  let password = process.env.SPAGHETTI_PASSWORD ?? "";
  if (!password) {
    password = await askHidden("Password");
    if ((await askHidden("Again")) !== password) throw new Error("The passwords don't match.");
  }
  rl.close();

  const target: Target = { remote: values.remote, persistTo: values["persist-to"] };
  if (!target.remote) applyMigrations(target);
  await upsertUser({ username, name, color, password }, target);
  console.log(`✓ ${name} (${username}) can sign in${target.remote ? " on the deployed app" : " locally"}.`);
}

main().catch((error: unknown) => {
  rl.close();
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
