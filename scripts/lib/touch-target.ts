/**
 * Design lint rule: a class string with `touch-target` also needs relative,
 * absolute, fixed or sticky. The utility draws a 44 px ::after with
 * position: absolute, which lands on the nearest positioned ancestor when the
 * control isn't positioned itself, and then takes taps meant for other things.
 *
 * A responsive variant (md:relative) doesn't count: the hit area is for touch
 * screens of any width. The class may sit in another string of the same cn(...)
 * call or className attribute, so the check reads the whole call.
 */
export const TOUCH_TARGET_MESSAGE =
  "touch-target needs a positioned element (relative): its 44 px hit area otherwise covers other things";

const touchTarget = /(?<![\w:-])touch-target(?![\w-])/;
const positioned = /(?<![\w:-])(?:relative|absolute|fixed|sticky)(?![\w-])/;

function isComment(line: string) {
  return /^\s*(?:\/\/|\*|\/\*|\{\/\*)/.test(line);
}

/** The lines of the call or attribute around `index`: back to its `cn(` or `className=`, forward to where it closes. */
function around(lines: string[], index: number): string[] {
  let start = index;
  while (start > index - 30 && start > 0 && !/\bcn\(|className=|\bclass=/.test(lines[start] ?? "")) start--;
  let depth = 0;
  let end = start;
  for (; end < lines.length && end < start + 40; end++) {
    for (const ch of lines[end] ?? "") {
      if (ch === "(" || ch === "{") depth++;
      if (ch === ")" || ch === "}") depth--;
    }
    if (end >= index && depth <= 0) break;
  }
  return lines.slice(start, end + 1);
}

/** Line numbers (1-based) of `touch-target` uses with no position class in the same call. */
export function unpositionedTouchTargets(source: string): number[] {
  const lines = source.split("\n");
  const found: number[] = [];
  lines.forEach((line, index) => {
    if (isComment(line) || line.includes("design-lint-ignore") || !touchTarget.test(line)) return;
    if (positioned.test(line)) return;
    const call = around(lines, index).filter((l) => !isComment(l));
    if (call.some((l) => positioned.test(l))) return;
    found.push(index + 1);
  });
  return found;
}
