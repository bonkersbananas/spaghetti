/**
 * The shared page's one script (decision 0077): a tap on a plate's picture opens the 3D view of how it prints. The
 * sheet opens at once, from here (plain DOM, styled by guest.css); the viewer itself (React, three.js and the app's
 * own PrintViewer, src/guest/viewer.tsx) is fetched as a finger or the pointer nears a plate, never with the page, so
 * a phone at a friend's downloads nothing for it until someone asks. Imports nothing else: it loads with every page.
 */

type Viewer = typeof import("./viewer");

let viewer: Promise<Viewer> | null = null;
/** The viewer's code, once: a failed load (offline) is tried again on the next tap. */
const loadViewer = () => {
  viewer ??= import("./viewer").catch((error: unknown) => {
    viewer = null;
    throw error;
  });
  return viewer;
};

const PHONE_FILE_BYTES = 100 * 1024 * 1024;
const coarse = () => matchMedia("(pointer: coarse)").matches;

const CLOSE_PATH =
  "M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z";

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** What the page says about a plate's file (worker/guest/page.tsx `viewData`). */
interface Plate {
  url: string;
  id: string;
  name: string;
  plate: number;
  bytes: number;
}

/** The sheet: a modal dialog, a bottom sheet on a phone and a large panel on a computer, as the app's 3D view. */
function openSheet(opener: HTMLButtonElement, plate: Plate) {
  const dialog = element("dialog", "gp-viewer");
  dialog.setAttribute("aria-labelledby", "gp-viewer-title");
  dialog.setAttribute("aria-describedby", "gp-viewer-name");
  const sheet = element("div", "gp-viewer-sheet");
  const head = element("div", "gp-viewer-head");
  const words = element("div", "gp-viewer-words");
  const title = element("h2", "gp-viewer-title", "3D view");
  title.id = "gp-viewer-title";
  const name = element("p", "gp-viewer-name", plate.name);
  name.id = "gp-viewer-name";
  words.append(title, name);
  const close = element("button", "gp-viewer-close");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.innerHTML = `<svg class="gp-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><path d="${CLOSE_PATH}"/></svg>`;
  head.append(words, close);
  // Focus waits here while the code loads, and moves on to the viewer's stage.
  const stage = element("div", "gp-viewer-stage gv-root");
  stage.tabIndex = -1;
  stage.append(element("span", "gp-viewer-wait"));
  sheet.append(head, stage);
  dialog.append(sheet);
  document.body.append(dialog);

  let unmount: (() => void) | null = null;
  let closed = false;
  const shut = () => {
    if (closed) return;
    closed = true;
    unmount?.();
    dialog.close();
    dialog.remove();
    document.documentElement.classList.remove("gp-viewing");
    opener.focus({ preventScroll: true });
  };
  close.addEventListener("click", shut);
  dialog.addEventListener("close", shut);
  // A tap on the dimmed page around the panel closes it, as the app's dialog does.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) shut();
  });

  document.documentElement.classList.add("gp-viewing");
  dialog.showModal();
  stage.focus({ preventScroll: true });

  const failed = (words: string, retry: boolean) => {
    stage.replaceChildren();
    const note = element("div", "gp-viewer-note");
    note.append(element("p", "", words));
    if (retry) {
      const again = element("button", "gp-viewer-again", "Try again");
      again.type = "button";
      again.addEventListener("click", () => {
        stage.replaceChildren(element("span", "gp-viewer-wait"));
        show();
      });
      note.append(again);
    }
    stage.append(note);
  };
  const show = () => {
    if (plate.bytes > PHONE_FILE_BYTES && coarse()) {
      failed("Too big for the 3D view on a phone. A laptop will show it.", false);
      return;
    }
    loadViewer().then(
      (module) => {
        if (closed) return;
        stage.replaceChildren();
        unmount = module.mount(stage, opener.dataset.view3d ?? "{}");
      },
      () => !closed && failed("The 3D view needs a connection to load. Try again once you're online.", true),
    );
  };
  show();
}

function start() {
  for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-view3d]")) {
    // The code comes as a finger or the pointer nears a plate, so the sheet's viewer is ready by the tap.
    const warm = () => void loadViewer().catch(() => undefined);
    button.addEventListener("pointerenter", warm, { once: true });
    button.addEventListener("pointerdown", warm, { once: true });
    button.addEventListener("focus", warm, { once: true });
    button.addEventListener("click", () => {
      try {
        openSheet(button, JSON.parse(button.dataset.view3d ?? "") as Plate);
      } catch {
        // A plate the page described wrongly opens nothing.
      }
    });
  }
}

start();
