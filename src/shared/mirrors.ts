/**
 * Sites that only show a model another site hosts (aggregators, mirrors): their address names the source model, so
 * a link there is read as the source's link. One row per mirror; another mirror is a line here.
 */

interface Mirror {
  domain: string;
  /** Tested against the pathname; the groups name the source site and the model's id there. */
  path: RegExp;
}

/** The source model's own address, by the site's name in a mirror's address; `$` is the id. */
const SOURCES: Record<string, string> = {
  makerworld: "https://makerworld.com/models/$",
  printables: "https://www.printables.com/model/$",
  thingiverse: "https://www.thingiverse.com/thing:$",
};

// 3dgo.app/models/<site>/<id>: the address forms its own links use (its pages are behind a challenge from data centres).
const MIRRORS: readonly Mirror[] = [
  { domain: "3dgo.app", path: /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?models\/([a-z]+)\/(\d+)\/?$/i },
];

/** The source model's address when `url` is a mirror's page for it, else null. */
export function mirrorSource(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  for (const { domain, path } of MIRRORS) {
    const [, site = "", id = ""] =
      (host === domain || host.endsWith(`.${domain}`) ? path.exec(url.pathname) : null) ?? [];
    const source = Object.hasOwn(SOURCES, site.toLowerCase()) ? SOURCES[site.toLowerCase()] : undefined;
    if (source) return source.replace("$", id);
  }
  return null;
}
