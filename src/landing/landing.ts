/**
 * The landing page's few moving parts. Everything on the page is there and readable without this script; it only
 * adds motion (for people who haven't asked for less) and the "How did it go?" buttons' answers.
 *
 * Kept tiny and free of the app's code: it is the page's only script.
 */

const motion = matchMedia("(prefers-reduced-motion: no-preference)").matches;
const root = document.documentElement;

/** The top bar gets its frosted paper once the page has moved under it. */
function followScroll() {
  const bar = document.querySelector<HTMLElement>("[data-bar]");
  if (!bar) return;
  const update = () => bar.toggleAttribute("data-scrolled", window.scrollY > 8);
  update();
  window.addEventListener("scroll", update, { passive: true });
}

/**
 * Things arrive as they come into view (.lp-rise), and some start a small show then (.lp-watch: a strand drawing
 * itself, a timer filling, a search typing). What is already on screen when the page opens is simply there.
 */
function revealOnScroll() {
  const targets = document.querySelectorAll<HTMLElement>(".lp-rise, .lp-watch");
  if (!motion || !("IntersectionObserver" in window)) {
    for (const target of targets) arrive(target);
    return;
  }
  const inView = (element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    return box.top < window.innerHeight * 0.92 && box.bottom > 0;
  };
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        arrive(entry.target as HTMLElement);
      }
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.15 },
  );
  for (const target of targets) {
    if (inView(target)) arrive(target);
    else {
      prepare(target);
      observer.observe(target);
    }
  }
  root.classList.add("lp-ready");
}

/** Before something comes into view: a search box that will type its words starts empty. */
function prepare(element: HTMLElement) {
  const query = element.querySelector<HTMLElement>(".lp-finder__query");
  if (query) {
    query.dataset.text = query.textContent ?? "";
    query.textContent = "";
    element.classList.add("is-typing");
  }
}

function arrive(element: HTMLElement) {
  element.classList.add("is-in");
  const query = element.querySelector<HTMLElement>(".lp-finder__query");
  if (query?.dataset.text) void type(element, query, query.dataset.text);
}

async function type(finder: HTMLElement, query: HTMLElement, text: string) {
  await wait(500);
  for (let i = 1; i <= text.length; i++) {
    query.textContent = text.slice(0, i);
    await wait(70 + Math.random() * 60);
  }
  await wait(250);
  finder.classList.remove("is-typing");
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ANSWERS: Record<string, string> = {
  worked: "Al dente. Keep the settings as a recipe and print it again.",
  partly: "Close. Note what curled, change one thing, go again.",
  spaghetti: "A proud nest. Snap it, tag it, and the next try starts from here.",
};

const FILAMENT = ["#ec5b93", "#f6c443", "#2fb3ad", "#ee7b2c", "#fffcf7"];

/** "How did it go?": the app's three answers. A tap picks one, says what happens next, and sends something flying. */
function outcomeToy() {
  const toy = document.querySelector<HTMLElement>(".lp-toy");
  const answer = toy?.querySelector<HTMLElement>("[data-answer]");
  if (!toy || !answer) return;
  for (const button of toy.querySelectorAll<HTMLButtonElement>("[data-outcome]")) {
    button.addEventListener("click", () => {
      const outcome = button.dataset.outcome ?? "";
      for (const other of toy.querySelectorAll("[data-outcome]")) {
        other.setAttribute("aria-pressed", String(other === button));
      }
      answer.textContent = ANSWERS[outcome] ?? "";
      if (motion) burst(toy, button, outcome);
      if (motion && "vibrate" in navigator) navigator.vibrate(10);
    });
  }
}

function burst(toy: HTMLElement, button: HTMLElement, outcome: string) {
  const from = button.getBoundingClientRect();
  const box = toy.getBoundingClientRect();
  const x = from.left - box.left + from.width / 2;
  const y = from.top - box.top + from.height / 2;
  const strands = outcome === "spaghetti";
  const count = strands ? 7 : outcome === "worked" ? 16 : 8;
  const colors = outcome === "partly" ? ["#f6c443", "#e3ae45", "#fffcf7"] : FILAMENT;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6;
    const distance = (strands ? 70 : 60) + Math.random() * 50;
    const bit = strands ? strand() : document.createElement("span");
    bit.classList.add("lp-bit");
    if (strands) bit.classList.add("lp-bit--strand");
    bit.setAttribute("aria-hidden", "true");
    bit.style.setProperty("--x", `${x}px`);
    bit.style.setProperty("--y", `${y}px`);
    bit.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    bit.style.setProperty("--dy", `${Math.sin(angle) * distance - (strands ? 0 : 20)}px`);
    bit.style.setProperty("--r", `${(Math.random() - 0.5) * 360}deg`);
    bit.style.setProperty("--c", colors[i % colors.length] ?? "#fffcf7");
    bit.addEventListener("animationend", () => bit.remove());
    toy.append(bit);
  }
}

/** A loose strand of filament, a different squiggle each time. */
function strand(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 40 40");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const r = () => Math.round(Math.random() * 32 + 4);
  path.setAttribute("d", `M${r()} ${r()}C${r()} ${r()} ${r()} ${r()} ${r()} ${r()}S${r()} ${r()} ${r()} ${r()}`);
  svg.append(path);
  return svg;
}

followScroll();
revealOnScroll();
outcomeToy();
