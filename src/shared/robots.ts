/**
 * A small robots.txt reader (RFC 9309, the parts that matter here): whether our agent may fetch a path. The most
 * specific group for our name wins, else `*`; the longest matching rule decides, and Allow beats Disallow on a tie.
 */
export function robotsAllows(txt: string, path: string, agent: string): boolean {
  const name = agent.toLowerCase();
  const groups: { agents: string[]; rules: { allow: boolean; pattern: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let collecting = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (!collecting || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      collecting = true;
    } else if (field === "allow" || field === "disallow") {
      collecting = false;
      if (current && value) current.rules.push({ allow: field === "allow", pattern: value });
    } else {
      collecting = false;
    }
  }
  const named = groups.filter((g) => g.agents.some((a) => a !== "*" && name.includes(a)));
  const chosen = named.length ? named : groups.filter((g) => g.agents.includes("*"));
  let verdict = true;
  let longest = -1;
  for (const rule of chosen.flatMap((g) => g.rules)) {
    if (!matches(rule.pattern, path)) continue;
    const length = rule.pattern.length;
    if (length > longest || (length === longest && rule.allow)) {
      longest = length;
      verdict = rule.allow;
    }
  }
  return verdict;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}
