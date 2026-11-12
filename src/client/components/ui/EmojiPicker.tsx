import {
  defaultEmojiDataResolver,
  EmojiPicker as Frimousse,
  type Emoji as FrimousseEmoji,
  useSkinTone,
} from "frimousse";
import { type ComponentProps, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { SearchIcon } from "./icons";
import { Overline } from "./Overline";

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
    <div {...props} className="bg-lifted py-1.5">
      <Overline>{category.label}</Overline>
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
  const [emojis, setEmojis] = useState<readonly Entry[] | null>(null);
  const searching = search.trim() !== "";
  // Frimousse loads and filters the data (what this device can draw); the search reads the same list.
  const resolveEmojiData = useCallback<typeof defaultEmojiDataResolver>(async (locale, options) => {
    const data = await defaultEmojiDataResolver(locale, options);
    setEmojis(data.emojis);
    return data;
  }, []);
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
      columns={COLUMNS}
      skinTone={tone}
      resolveEmojiData={resolveEmojiData}
      onEmojiSelect={({ emoji }) => onPick(emoji)}
      className={cn("flex flex-col", className)}
    >
      <PickerContext value={context}>
        <RememberTone />
        {!sheet && field}
        {/* One height for the whole body, so the sheet doesn't grow or shrink as you type or when nothing matches. */}
        <div className={cn("flex min-h-0 flex-col", sheet ? "h-[min(50dvh,26rem)]" : "h-72")}>
          {!searching && !!recent?.length && (
            <div className="mb-1 shrink-0">
              <Overline as="h3" className="block py-1.5">
                Recently used
              </Overline>
              <ul className="flex flex-wrap" aria-label="Recently used">
                {recent.slice(0, 8).map((emoji) => (
                  <li key={emoji} className="flex basis-1/8">
                    <EmojiButton
                      recent
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
          {searching ? (
            <SearchResults key={search.trim()} query={search} emojis={emojis} onPick={onPick} />
          ) : (
            <Frimousse.Viewport className="min-h-0 flex-1">
              <Frimousse.Loading className="text-small text-ink-faint absolute inset-0 flex items-center justify-center">
                Loading emoji…
              </Frimousse.Loading>
              <Frimousse.List components={components} />
            </Frimousse.Viewport>
          )}
        </div>
        {sheet && field}
      </PickerContext>
    </Frimousse.Root>
  );
}

const COLUMNS = 8;

type Entry = Awaited<ReturnType<typeof defaultEmojiDataResolver>>["emojis"][number];

/** Frimousse's own ranking: a word in the name counts ten, a word among the keywords one. */
function find(emojis: readonly Entry[], query: string): Entry[] {
  const needle = query.toLowerCase().trim();
  const scored: Array<[Entry, number]> = [];
  for (const entry of emojis) {
    let score = entry.label.toLowerCase().includes(needle) ? 10 : 0;
    for (const tag of entry.tags) if (tag.toLowerCase().includes(needle)) score += 1;
    if (score) scored.push([entry, score]);
  }
  return scored.sort((a, b) => b[1] - a[1]).map(([entry]) => entry);
}

/**
 * What the search finds, as one grid with no category headings (like Slack's), or a friendly word when nothing
 * matches. Arrows move, Enter picks, like the categories' grid.
 */
function SearchResults({
  query,
  emojis,
  onPick,
}: {
  query: string;
  emojis: readonly Entry[] | null;
  onPick: (emoji: string) => void;
}) {
  const { given, sheet } = useContext(PickerContext);
  const [tone] = useSkinTone();
  const found = useMemo(() => (emojis ? find(emojis, query).slice(0, 160) : []), [emojis, query]);
  const shown = (entry: Entry) => (tone !== "none" && entry.skins ? (entry.skins[tone] ?? entry.emoji) : entry.emoji);
  // The first result is on from the start (the picker remounts this for each query); arrows move, Enter picks. Heard
  // on the document, in the capture phase, so it comes before Frimousse's own keys, which belong to its hidden grid.
  const [active, setActive] = useState(0);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS }[event.key];
      if (step !== undefined) {
        event.preventDefault();
        setActive((index) => Math.max(0, Math.min(found.length - 1, index + step)));
      } else if (event.key === "Enter" && found[active]) {
        event.preventDefault();
        onPick(shown(found[active]));
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });
  if (!emojis)
    return <p className="text-small text-ink-faint flex flex-1 items-center justify-center">Loading emoji…</p>;
  if (!found.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="font-emoji text-headline" aria-hidden>
          🍝
        </p>
        <p className="text-body text-ink font-semibold">Nothing like that in the pantry</p>
        <p className="text-small text-ink-faint">No emoji for “{query.trim()}”. Try fire, party or pasta.</p>
      </div>
    );
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: a grid of buttons, like Frimousse's own (role grid, row, gridcell)
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" role="grid" aria-label="Search results">
      {/* biome-ignore lint/a11y/useSemanticElements: see above */}
      {/* biome-ignore lint/a11y/useFocusableInteractive: the cells inside take the focus */}
      <div className="flex flex-wrap" role="row">
        {found.map((entry, index) => {
          const emoji = shown(entry);
          return (
            <EmojiButton
              key={entry.emoji}
              role="gridcell"
              emoji={emoji}
              label={entry.label}
              given={given?.has(emoji)}
              sheet={sheet}
              active={index === active}
              onClick={() => onPick(emoji)}
              ref={(node) => {
                if (index === active) node?.scrollIntoView({ block: "nearest" });
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function EmojiButton({
  emoji,
  label,
  given,
  sheet,
  recent,
  active,
  ...props
}: Omit<ComponentProps<"button">, "children"> & {
  emoji: string;
  label: string;
  given?: boolean;
  sheet: boolean;
  /** In the recent row, where the list item is the eighth. */
  recent?: boolean;
  /** The one the arrow keys are on (search results; the category grid marks its own). */
  active?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      aria-label={label}
      aria-pressed={given}
      data-active={active ? "" : undefined}
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
