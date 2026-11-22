/**
 * Keeps that someone downloaded a file of an idea or build (decision 0076): one listener for every download link to
 * `/api/files/<id>` (the file, or a model's sliced file), so the app can tell which build the next print belongs to.
 * "Open in Bambu Studio" is kept by the server when it makes the link.
 */
const FILE = /^\/api\/files\/([0-9a-f-]{36})(?:\/sliced)?$/i;

export function followDownloads(): () => void {
  const onClick = (event: MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest("a[download]") : null;
    if (!(link instanceof HTMLAnchorElement)) return;
    const url = new URL(link.href, window.location.href);
    const id = url.origin === window.location.origin ? FILE.exec(url.pathname)?.[1] : undefined;
    if (!id) return;
    void fetch(`/api/files/${id}/downloads`, {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { Accept: "application/json" },
    }).catch(() => undefined);
  };
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}
