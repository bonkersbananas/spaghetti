import { cn } from "@/lib/cn";

/**
 * As wide as the field is tall, so the target is square and the field's whole height (`TextField`'s sizes), with the
 * glyph nudged left to where the browser drew its own (about 27 px from a medium field's edge).
 */
const room = { sm: "w-11 pr-0.5", md: "w-12 pr-1.5 md:w-11 md:pr-2.5", lg: "w-16" } as const;

/**
 * The × that empties a field (`TextField` with `type="search"` or `clearable` draws it while it has text; anything
 * else that holds an input in a `relative` box can place it too, after the input, which must carry `peer`). It shows
 * while the field has the focus. The glyph is the 16 px one the browser drew, but the
 * button is the field's whole height and reaches its right edge (44 px or more, a thumb's width), so a tap near the ×
 * can't miss it and land in the text. It never takes the focus (a phone's keyboard stays up), empties the field
 * through its own onChange (the `input` event typing sends) and leaves the caret in it. Not a Tab stop: Escape and
 * select-all do the same there.
 */
export default function ClearButton({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label="Clear"
      title="Clear"
      data-clear
      // Keep the focus in the field.
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        // The field is the input in the same box.
        const field = event.currentTarget.parentElement?.querySelector("input");
        if (!field) return;
        // React hears the input event; a value set directly would pass for its own echo and be ignored.
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, "");
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.focus();
      }}
      className={cn(
        // Only while the field has the focus, as the browser's own showed (the field is its `peer`).
        "text-ink-faint hover:text-ink duration-fast absolute inset-y-0 right-0 hidden items-center justify-center transition-colors peer-focus:flex",
        // Square, not rounded: it draws nothing of its own, and a rounded corner would be a spot no tap reaches.
        room[size],
      )}
    >
      {/* The browser's own × as app.css drew it before, so only the target grew. */}
      <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
        <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );
}
