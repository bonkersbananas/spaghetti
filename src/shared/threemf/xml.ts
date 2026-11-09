/** A tiny, forgiving XML reader: no DOM, no dependencies. Enough for the slicers' config files. */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

const MAX_DEPTH = 64;
const MAX_NODES = 200_000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const ATTR_RE = /([^\s=/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * Parses `xml` into a synthetic root whose children are the document's top-level elements.
 * Text content is ignored (the files we read keep everything in attributes). Malformed
 * input yields what was readable; `truncated` says the tree was cut short.
 */
export function parseXml(xml: string): { root: XmlNode; truncated: boolean } {
  const root: XmlNode = { name: "#root", attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  let truncated = false;
  let count = 0;
  let i = 0;
  const n = xml.length;

  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) break;
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      if (end < 0) {
        truncated = true;
        break;
      }
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      if (end < 0) {
        truncated = true;
        break;
      }
      i = end + 3;
      continue;
    }
    if (xml[lt + 1] === "?" || xml[lt + 1] === "!") {
      // Processing instruction or DOCTYPE (internal subsets with entities are never expanded).
      const end = xml.indexOf(">", lt + 2);
      if (end < 0) {
        truncated = true;
        break;
      }
      i = end + 1;
      continue;
    }
    // Find the end of the tag, skipping quoted attribute values that may contain ">".
    let j = lt + 1;
    let quote = "";
    while (j < n) {
      const c = xml[j] as string;
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
      j++;
    }
    if (j >= n) {
      truncated = true;
      break;
    }
    const inner = xml.slice(lt + 1, j);
    i = j + 1;

    if (inner[0] === "/") {
      // Closing tag: pop to the matching open element if there is one.
      const name = inner.slice(1).trim();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k]?.name === name) {
          stack.length = k;
          break;
        }
      }
      continue;
    }

    const selfClosing = inner.endsWith("/");
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const m = /^([^\s/]+)/.exec(body);
    const tag = m?.[1];
    if (!tag) continue;
    const attrs: Record<string, string> = {};
    ATTR_RE.lastIndex = 0;
    for (let a = ATTR_RE.exec(body); a; a = ATTR_RE.exec(body)) {
      attrs[a[1] as string] = decodeEntities(a[2] ?? a[3] ?? "");
    }
    if (++count > MAX_NODES) {
      truncated = true;
      break;
    }
    const node: XmlNode = { name: tag, attrs, children: [] };
    (stack[stack.length - 1] as XmlNode).children.push(node);
    if (!selfClosing) {
      if (stack.length >= MAX_DEPTH) {
        truncated = true;
        break;
      }
      stack.push(node);
    }
  }
  return { root, truncated };
}

export function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c) => c.name === name);
}

export function firstChild(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((c) => c.name === name);
}

/** Reads `<metadata key="…" value="…"/>` children into a map (first one wins). */
export function metadataMap(node: XmlNode): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of node.children) {
    if (c.name !== "metadata") continue;
    const key = c.attrs.key;
    const value = c.attrs.value;
    if (key !== undefined && value !== undefined && !map.has(key)) map.set(key, value);
  }
  return map;
}
