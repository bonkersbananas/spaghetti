import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { CameraIcon, PlusIcon } from "@/components/ui/icons";
import { useCapture } from "@/lib/capture";
import { type Section, tabs } from "./sections";

function Tab({ to, label, icon: Icon }: Section) {
  return (
    <Link
      to={to}
      // Each section's code is fetched once the app is idle (routes/_app.tsx), and on the touch itself.
      className="pressable press-none group text-ink-faint data-[status=active]:text-tomato-ink flex flex-1 flex-col items-center justify-center gap-px"
    >
      {({ isActive }) => (
        <>
          {/* The held highlight: a soft round behind the icon. */}
          <span className="group-active:bg-pressed group-data-[pressed]:bg-pressed rounded-pill flex h-7 w-12 items-center justify-center">
            <Icon size={24} weight={isActive ? "fill" : "regular"} aria-hidden />
          </span>
          <span className="text-caption font-semibold">{label}</span>
        </>
      )}
    </Link>
  );
}

/**
 * Phone navigation, within thumb reach: Today, Ideas, capture, Builds, Journal.
 * The capture button sits in the middle, a little larger, because capturing is
 * the main thing people do. Search is a tool, not a place: it is in the page header.
 */
/** How long a press on the capture button must last to go straight to the camera. */
const HOLD_MS = 450;

/**
 * The capture button: a tap opens the capture sheet; holding it opens the camera at once, and the photo lands in
 * the sheet with the note ready. The camera opens from the release (a real user gesture: iOS Safari only lets a file
 * input open from one, not from a timer), and the icon turns into a camera once the hold counts, so you know to let go.
 */
function CaptureButton() {
  const { setOpen, openWith } = useCapture();
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<number>(undefined);
  const held = useRef(false);
  const down = useRef(false);
  const [armed, setArmed] = useState(false);
  const stop = () => {
    window.clearTimeout(timer.current);
    setArmed(false);
  };
  return (
    <>
      <button
        type="button"
        onPointerDown={() => {
          down.current = true;
          held.current = false;
          timer.current = window.setTimeout(() => {
            held.current = true;
            setArmed(true);
          }, HOLD_MS);
        }}
        onPointerUp={() => {
          down.current = false;
          window.clearTimeout(timer.current);
          // A release on the button is followed by its click, at once. If none comes (the finger slid off and lifted
          // with nothing cancelling the gesture), the hold is over: don't stay armed.
          timer.current = window.setTimeout(() => {
            held.current = false;
            setArmed(false);
          }, 300);
        }}
        onPointerCancel={() => {
          down.current = false;
          held.current = false;
          stop();
        }}
        // Sliding off with the finger still down: no click will come, so the hold is over. (On touch the pointer
        // also "leaves" after it is lifted, just before the click, and that must not undo the hold.)
        onPointerLeave={() => {
          if (!down.current) return;
          held.current = false;
          stop();
        }}
        onContextMenu={(event) => event.preventDefault()}
        onClick={() => {
          const camera = held.current;
          held.current = false;
          stop();
          if (camera) input.current?.click();
          else setOpen(true);
        }}
        aria-label="New idea"
        aria-description="Hold to take a photo"
        style={{ WebkitTouchCallout: "none" }}
        className="pressable press-tomato focus-ring bg-tomato text-on-accent shadow-raised flex size-12 items-center justify-center rounded-lg select-none"
      >
        {/* Both stay in the page and one is hidden: swapping the node under the finger would drop the click. */}
        <PlusIcon size={26} weight="bold" aria-hidden className={armed ? "hidden" : undefined} />
        <CameraIcon size={26} weight="bold" aria-hidden className={armed ? undefined : "hidden"} />
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-testid="tabbar-camera-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) openWith({ files });
        }}
      />
    </>
  );
}

export function TabBar() {
  const [today, ideas, builds, journal] = tabs;
  return (
    <nav
      aria-label="Sections"
      className="sg-tabbar bg-cream/92 pb-safe shadow-bar fixed inset-x-0 bottom-0 z-30 backdrop-blur-xl md:hidden"
    >
      <div className="h-tabbar-row mx-auto flex max-w-lg items-stretch px-2">
        <Tab {...today} />
        <Tab {...ideas} />
        <div className="flex flex-1 items-center justify-center">
          <CaptureButton />
        </div>
        <Tab {...builds} />
        <Tab {...journal} />
      </div>
    </nav>
  );
}
