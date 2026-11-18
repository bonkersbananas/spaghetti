/** A loose strand of spaghetti on the foot of a short note's index card: a loop or two and a trailing end. */
export default function Strand() {
  // Laid over the face's foot, so it never takes a line from the note (only a short note gets one: see NoteFace's `doodle`).
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 44"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      className="stroke-tomato/25 pointer-events-none absolute bottom-[8cqi] left-[8cqi] h-auto w-[34cqi]"
    >
      <path d="M3 34C14 36 20 24 28 14 34 6 44 8 42 18 40 28 28 32 28 22 28 10 46 4 58 10 70 16 66 32 56 30 48 28 54 14 68 18 80 22 84 34 98 30" />
    </svg>
  );
}
