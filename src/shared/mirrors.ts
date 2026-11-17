/**
 * Sites that only show a model another site hosts (aggregators, mirrors): their address names the source model, so
 * a link there is read as the source's link. One row per mirror; another mirror is a line here.
 */

interface Mirror {
  domains: readonly string[];
  /** Tested against the pathname; the groups name the source site and the model's id there. */
  path: RegExp;
  /** The source model's own address for what `path` matched. */
  source: (site: string, id: string) => string | null;
}

const MIRRORS: readonly Mirror[] = [
  {
    // 3dgo.app/models/<site>/<id>: the address forms its own links use (its pages are behind a challenge from data centres).
    domains: ["3dgo.app"],
    path: /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?models\/(makerworld|printables|thingiverse)\/(\d+)\/?$/i,
    source: (site, id) => {
      switch (site.toLowerCase()) {
        case "makerworld":
          return `https://makerworld.com/models/${id}`;
        case "printables":
          return `https://www.printables.com/model/${id}`;
        case "thingiverse":
          return `https://www.thingiverse.com/thing:${id}`;
        default:
          return null;
      }
    },
  },
];

const hostIs = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** The source model's address when `url` is a mirror's page for it, else null. */
export function mirrorSource(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  for (const mirror of MIRRORS) {
    if (!mirror.domains.some((domain) => hostIs(host, domain))) continue;
    const found = mirror.path.exec(url.pathname);
    const source = found?.[1] && found[2] ? mirror.source(found[1], found[2]) : null;
    if (source) return source;
  }
  return null;
}
