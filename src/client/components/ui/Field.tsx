import { formatDuration } from "@shared/time";
import {
  type ComponentPropsWithRef,
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/cn";
import { Caution } from "./Caution";
import type { Icon } from "./icons";
import { type SaveState, SaveStatus } from "./SaveStatus";

interface FieldFrameProps {
  id: string;
  label?: string;
  hint?: ReactNode;
  error?: string;
  /** A gentle note (a Caution), such as a printer limit: shown instead of the hint, never blocking. */
  caution?: ReactNode;
  /** A small mark after the label, such as FromFileMark. */
  mark?: ReactNode;
  saveState?: SaveState;
  className?: string;
  children: ReactNode;
}

function FieldFrame({ id, label, hint, error, caution, mark, saveState, className, children }: FieldFrameProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {(label || saveState) && (
        <div className="flex items-baseline justify-between gap-3 px-0.5">
          {label && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <label htmlFor={id} className="text-small text-ink-soft truncate font-semibold">
                {label}
              </label>
              {mark}
            </span>
          )}
          {saveState && <SaveStatus state={saveState} />}
        </div>
      )}
      {children}
      {error ? (
        <p id={`${id}-message`} className="text-small text-tomato-ink px-0.5 font-medium">
          {error}
        </p>
      ) : caution ? (
        <div id={`${id}-message`}>
          <Caution>{caution}</Caution>
        </div>
      ) : hint ? (
        <p id={`${id}-message`} className="text-small text-ink-faint px-0.5">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const inputSurface =
  "w-full rounded-md bg-ink/4 text-ink shadow-well placeholder:text-ink-faint transition-shadow duration-fast ease-out focus:shadow-ring disabled:opacity-60";

export interface TextFieldProps extends Omit<ComponentPropsWithRef<"input">, "size"> {
  label?: string;
  hint?: ReactNode;
  error?: string;
  /** A gentle note beside the field (a printer limit); see Caution. */
  caution?: ReactNode;
  /** A small mark after the label (FromFileMark). */
  mark?: ReactNode;
  /** Shown beside the label for fields that autosave. */
  saveState?: SaveState;
  icon?: Icon;
  /** A unit after the value, inside the field: "°C", "mm", "%". */
  suffix?: string;
  /** "plain" drops the surface, for titles that read as text until edited. */
  appearance?: "surface" | "plain";
  /** "sm" for dense groups of fields, such as print settings. "lg" is one big figure to type, such as a weighing. */
  size?: "sm" | "md" | "lg";
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  {
    label,
    hint,
    error,
    caution,
    mark,
    saveState,
    icon: IconComponent,
    suffix,
    appearance = "surface",
    size = "md",
    className,
    id,
    ...props
  },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldFrame
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      caution={caution}
      mark={mark}
      saveState={saveState}
      className={className}
    >
      <div className="relative">
        {IconComponent && (
          <IconComponent
            size={20}
            className="text-ink-faint pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2"
            aria-hidden
          />
        )}
        <input
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || caution || hint ? `${fieldId}-message` : undefined}
          className={cn(
            appearance === "surface"
              ? cn(
                  inputSurface,
                  size === "lg" ? "text-headline tabular h-16 px-5 font-semibold" : "text-body",
                  size === "md" && "h-12 px-4 md:h-11",
                  size === "sm" && "h-11 px-3 md:h-9",
                )
              : "text-ink placeholder:text-ink-faint w-full bg-transparent",
            IconComponent && "pl-11",
            suffix && (size === "lg" ? "pr-14" : size === "md" ? "pr-12" : "pr-10"),
            error && "shadow-ring-error focus:shadow-ring-error",
          )}
          {...props}
        />
        {suffix && (
          <span
            aria-hidden
            className={cn(
              "text-small text-ink-faint pointer-events-none absolute top-1/2 -translate-y-1/2 font-medium",
              size === "lg" ? "right-5" : size === "md" ? "right-4" : "right-3",
            )}
          >
            {suffix}
          </span>
        )}
      </div>
    </FieldFrame>
  );
});

export interface NumberFieldProps
  extends Omit<TextFieldProps, "value" | "onChange" | "type" | "inputMode" | "defaultValue"> {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  /** Allow a decimal point (layer heights, nozzle sizes). */
  decimal?: boolean;
  min?: number;
  max?: number;
}

const parseNumber = (text: string) => {
  const value = Number(text.replace(",", ".").trim());
  return text.trim() === "" || !Number.isFinite(value) ? undefined : value;
};

/**
 * A number with its unit, typed freely (a comma works as a decimal point)
 * and kept as a number or nothing. Out-of-range values are clamped on blur.
 */
export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  { value, onChange, decimal = false, min, max, onBlur, ...props },
  ref,
) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  // Follow changes from outside (a reset, "same as last time") unless they match what's typed.
  useEffect(() => {
    setText((current) => (parseNumber(current) === value ? current : value === undefined ? "" : String(value)));
  }, [value]);
  const clamp = (n: number) => Math.min(max ?? n, Math.max(min ?? n, n));
  return (
    <TextField
      ref={ref}
      inputMode={decimal ? "decimal" : "numeric"}
      autoComplete="off"
      value={text}
      onChange={(event) => {
        const next = event.target.value.replace(decimal ? /[^\d.,]/g : /\D/g, "");
        setText(next);
        const parsed = parseNumber(next);
        onChange(parsed === undefined ? undefined : decimal ? parsed : Math.round(parsed));
      }}
      onBlur={(event) => {
        const parsed = parseNumber(text);
        if (parsed !== undefined && clamp(parsed) !== parsed) onChange(clamp(parsed));
        setText(parsed === undefined ? "" : String(clamp(parsed)));
        onBlur?.(event);
      }}
      {...props}
    />
  );
});

export interface TextAreaProps extends ComponentPropsWithRef<"textarea"> {
  label?: string;
  hint?: ReactNode;
  error?: string;
  saveState?: SaveState;
  /** "plain" for writing surfaces such as notes: no well, just text. "title" for an editable heading. */
  appearance?: "surface" | "plain" | "title";
  minRows?: number;
}

/** A textarea that grows with its text, so notes never scroll inside a box. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, saveState, appearance = "surface", minRows = 3, className, id, onInput, ...props },
  forwardedRef,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  const resize = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // Re-measure when the value changes from outside (a reset, a loaded draft).
  // biome-ignore lint/correctness/useExhaustiveDependencies: props.value is the trigger, not an input.
  useLayoutEffect(resize, [resize, props.value]);

  // Re-measure when the web fonts arrive (Safari measures with the fallback font first and kept a
  // two-line title's height for one line of text) and when the box's width changes (rotation, a sheet).
  useEffect(() => {
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) resize();
    });
    const el = innerRef.current;
    if (!el || typeof ResizeObserver === "undefined")
      return () => {
        cancelled = true;
      };
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      resize();
    });
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [resize]);

  return (
    <FieldFrame id={fieldId} label={label} hint={hint} error={error} saveState={saveState} className={className}>
      <textarea
        ref={(el) => {
          innerRef.current = el;
          if (typeof forwardedRef === "function") forwardedRef(el);
          else if (forwardedRef) forwardedRef.current = el;
        }}
        id={fieldId}
        rows={minRows}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${fieldId}-message` : undefined}
        onInput={(event) => {
          resize();
          onInput?.(event);
        }}
        className={cn(
          "resize-none overflow-hidden",
          appearance === "surface" && cn(inputSurface, "text-body px-4 py-3"),
          appearance === "plain" &&
            "text-lead text-ink placeholder:text-ink-faint md:text-body w-full bg-transparent focus:shadow-none",
          appearance === "title" &&
            "font-display text-headline text-ink placeholder:text-ink-faint w-full bg-transparent font-semibold focus:shadow-none",
          error && "shadow-ring-error focus:shadow-ring-error",
        )}
        {...props}
      />
    </FieldFrame>
  );
});

/** "2:10", "2h 10m", "2 h", "130" (minutes) → minutes. Undefined when it can't be read. */
export function parseDuration(text: string): number | undefined {
  const value = text.trim().toLowerCase().replace(",", ".");
  if (!value) return undefined;
  const clock = value.match(/^(\d+):(\d{1,2})$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const hours = value.match(/(\d+(?:\.\d+)?)\s*h/);
  const minutes = value.match(/(\d+)\s*m/);
  if (hours || minutes) return Math.round(Number(hours?.[1] ?? 0) * 60 + Number(minutes?.[1] ?? 0));
  const plain = Number(value);
  return Number.isFinite(plain) && plain >= 0 ? Math.round(plain) : undefined;
}

export { formatDuration };

export interface DurationFieldProps
  extends Omit<TextFieldProps, "value" | "onChange" | "type" | "inputMode" | "defaultValue"> {
  /** Minutes. */
  value: number | undefined;
  onChange: (minutes: number | undefined) => void;
}

/**
 * A duration typed the way people say it: "2h 10", "2:10" or "130" for
 * minutes. Shown as "2 h 10 min" once you leave the field.
 */
export const DurationField = forwardRef<HTMLInputElement, DurationFieldProps>(function DurationField(
  { value, onChange, onBlur, onFocus, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(value === undefined ? "" : formatDuration(value));
  useEffect(() => {
    if (!focused) setText(value === undefined ? "" : formatDuration(value));
  }, [value, focused]);
  return (
    <TextField
      ref={ref}
      autoComplete="off"
      value={text}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parseDuration(event.target.value));
      }}
      onBlur={(event) => {
        setFocused(false);
        setText(value === undefined ? "" : formatDuration(value));
        onBlur?.(event);
      }}
      {...props}
    />
  );
});
