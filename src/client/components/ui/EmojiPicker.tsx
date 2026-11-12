import { EmojiPicker as Frimousse, type Emoji as FrimousseEmoji, useSkinTone } from "frimousse";
import { type ComponentProps, createContext, useContext, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { SearchIcon } from "./icons";

/** Where the picker's data is served from: our own origin (public/emoji, made by scripts/emoji-data.ts), never a CDN. */
const EMOJI_DATA_URL = "/emoji";
const TONE_KEY = "spaghetti.emoji-skin-tone";
const TONES = ["none", "light", "medium-light", "medium", "medium-dark", "dark"] as const;
type Tone = (typeof TONES)[number];

const savedTone = (): Tone => {
  try {
    const saved = localStorage.getItem(TONE_KEY);
    return TONES.find((tone) => tone === saved) ?? "none";
  } catch {
    return "none";
  }
};

/** Remembers the skin tone picked with the picker's button, and nothing else. */
function RememberTone() {
  const [tone] = useSkinTone();
  useEffect(() => {
    try {
      localStorage.setItem(TONE_KEY, tone);
    } catch {}
  }, [tone]);
  return null;
}

/** What the grid's cells need from the picker: the emoji you gave (marked) and which layout it is. */
const PickerContext = createContext<{ given?: ReadonlySet<string>; sheet: boolean }>({ sheet: false });

const components = {
  CategoryHeader: ({ category, ...props }: ComponentProps<"div"> & { category: { label: string } }) => (
    <div
      {...props}
      className="bg-lifted text-caption text-ink-faint px-2 py-1.5 font-semibold tracking-wider uppercase"
    >
      {category.label}
    </div>
  ),
  Row: (props: ComponentProps<"div">) => <div {...props} />,
  Emoji: ({ emoji, ...props }: ComponentProps<"button"> & { emoji: FrimousseEmoji }) => {
    const { given, sheet } = useContext(PickerContext);
    return (
      <EmojiButton {...props} emoji={emoji.emoji} label={emoji.label} given={given?.has(emoji.emoji)} sheet={sheet} />
    );
  },
};

export interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  /** Emoji you have already given: marked, and picked again they are taken back. */
  given?: ReadonlySet<string>;
  /** Your latest picks, newest first: a row of them above the grid while the search is empty. */
  recent?: readonly string[];
  /** `sheet` is the phone's: large tiles and the search under the grid, at thumb reach. `menu` is the desktop popover's. */
  layout: "sheet" | "menu";
  className?: string;
}

/**
 * The full emoji picker: every emoji in categories, searched by name and keyword ("fire", "party", "pasta"), your
 * recent picks first, a skin tone button. Frimousse is the headless engine (virtual list, keyboard: arrows move,
 * Enter picks); everything you see is styled here with the tokens. It is loaded only when "more" is pressed, and
 * fetches its data from our own origin.
 */
export default function EmojiPicker({ onPick, given, recent, layout, className }: EmojiPickerProps) {
  const sheet = layout === "sheet";
  const [search, setSearch] = useState("");
  const [tone] = useState(savedTone);
  const context = useMemo(() => ({ given, sheet }), [given, sheet]);

  const field = (
    <div className={cn("flex items-center gap-2", sheet ? "pt-3" : "pb-2")}>
      <div className="bg-ink/5 rounded-pill focus-within:ring-ink/30 flex h-11 min-w-0 flex-1 items-center gap-2 px-4 focus-within:ring-2">
        <SearchIcon size={18} className="text-ink-faint shrink-0" aria-hidden />
        <Frimousse.Search
          aria-label="Search emoji"
          autoFocus={!sheet}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search emoji, like fire or pasta"
          className="text-body text-ink placeholder:text-ink-faint min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 shadow-none outline-none"
        />
      </div>
      <Frimousse.SkinToneSelector
        aria-label="Skin tone"
        className="pressable focus-ring bg-ink/5 hover:bg-ink/10 text-title font-emoji size-11 shrink-0 rounded-full"
      />
    </div>
  );

  return (
    <Frimousse.Root
      emojibaseUrl={EMOJI_DATA_URL}
      locale="en"
      columns={8}
      skinTone={tone}
      onEmojiSelect={({ emoji }) => onPick(emoji)}
      className={cn("flex flex-col", className)}
    >
      <PickerContext value={context}>
        <RememberTone />
        {!sheet && field}
        {!search && !!recent?.length && (
          <div className="mb-1">
            <p className="text-caption text-ink-faint px-2 py-1.5 font-semibold tracking-wider uppercase">
              Recently used
            </p>
            <ul className="flex flex-wrap" aria-label="Recently used">
              {recent.slice(0, 8).map((emoji) => (
                <li key={emoji} className="flex basis-1/8">
                  <EmojiButton
                    emoji={emoji}
                    label={emoji}
                    given={given?.has(emoji)}
                    sheet={sheet}
                    onClick={() => onPick(emoji)}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
        <Frimousse.Viewport className={cn("min-h-0", sheet ? "h-[min(40dvh,22rem)]" : "h-64")}>
          <Frimousse.Loading className="text-small text-ink-faint absolute inset-0 flex items-center justify-center">
            Loading emoji…
          </Frimousse.Loading>
          <Frimousse.Empty className="text-small text-ink-faint absolute inset-0 flex items-center justify-center px-6 text-center">
            No emoji for that. Try another word.
          </Frimousse.Empty>
          <Frimousse.List components={components} />
        </Frimousse.Viewport>
        {sheet && field}
      </PickerContext>
    </Frimousse.Root>
  );
}

function EmojiButton({
  emoji,
  label,
  given,
  sheet,
  recent,
  ...props
}: Omit<ComponentProps<"button">, "children"> & {
  emoji: string;
  label: string;
  given?: boolean;
  sheet: boolean;
  /** In the recent row, where the list item is the eighth. */
  recent?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      aria-label={label}
      aria-pressed={given}
      title={label}
      className={cn(
        "font-emoji data-[active]:bg-ink/8 flex flex-none items-center justify-center rounded-md transition-colors",
        sheet ? "text-headline h-12" : "text-title h-9",
        // A grid cell is an eighth of the row; in the recent row the list item is.
        recent ? "w-full" : "basis-1/8",
        given && "bg-tomato-soft ring-tomato/30 ring-1 ring-inset",
      )}
    >
      {emoji}
    </button>
  );
}
