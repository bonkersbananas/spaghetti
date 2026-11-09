import { hashPassword } from "../../src/shared/password.ts";
import { isPersonColor, type PersonColor, USERNAME_PATTERN } from "../../src/shared/people.ts";
import { executeSql, type Target } from "./wrangler.ts";

export interface NewUser {
  username: string;
  name: string;
  color: PersonColor;
  password: string;
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function validateUser(user: NewUser): string | null {
  if (!USERNAME_PATTERN.test(user.username)) {
    return "Username: 2–32 lowercase letters, digits, - or _, starting with a letter or digit.";
  }
  if (!user.name.trim() || user.name.length > 60) return "Name: 1–60 characters.";
  if (!isPersonColor(user.color)) return "Color: pick one of the person colors.";
  if (user.password.length < 8) return "Password: at least 8 characters.";
  return null;
}

/**
 * Adds a person, or updates their name, color and password if the username
 * exists. Changing a password signs out their devices.
 */
export async function upsertUser(user: NewUser, target: Target) {
  const problem = validateUser(user);
  if (problem) throw new Error(problem);
  const hash = await hashPassword(user.password);
  const sql = [
    `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ${quote(user.username)});`,
    "INSERT INTO users (id, username, name, color, password_hash, created_at) VALUES (" +
      [crypto.randomUUID(), user.username, user.name.trim(), user.color, hash].map(quote).join(", ") +
      `, ${Date.now()}) ON CONFLICT(username) DO UPDATE SET name = excluded.name, color = excluded.color, password_hash = excluded.password_hash;`,
  ].join("\n");
  executeSql(sql, target);
}
