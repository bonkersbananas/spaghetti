import {
  type ComponentPropsWithRef,
  forwardRef,
  type ReactNode,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import { cn } from "@/lib/cn";
import type { Icon } from "./icons";
import { type SaveState, SaveStatus } from "./SaveStatus";

interface FieldFrameProps {
  id: string;
  label?: string;
  hint?: ReactNode;
  error?: string;
  saveState?: SaveState;
  className?: string;
  children: ReactNode;
}

function FieldFrame({ id, label, hint, error, saveState, className, children }: FieldFrameProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {(label || saveState) && (
        <div className="flex items-baseline justify-between gap-3 px-0.5">
          {label && (
            <label htmlFor={id} className="text-small text-ink-soft font-semibold">
              {label}
            </label>
          )}
          {saveState && <SaveStatus state={saveState} />}
        </div>
      )}
      {children}
      {error ? (
        <p id={`${id}-message`} className="text-small text-tomato-ink px-0.5 font-medium">
          {error}
        </p>
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
  /** Shown beside the label for fields that autosave. */
  saveState?: SaveState;
  icon?: Icon;
  /** "plain" drops the surface, for titles that read as text until edited. */
  appearance?: "surface" | "plain";
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, saveState, icon: IconComponent, appearance = "surface", className, id, ...props },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldFrame id={fieldId} label={label} hint={hint} error={error} saveState={saveState} className={className}>
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
          aria-describedby={error || hint ? `${fieldId}-message` : undefined}
          className={cn(
            appearance === "surface"
              ? cn(inputSurface, "text-body h-12 px-4 md:h-11")
              : "text-ink placeholder:text-ink-faint w-full bg-transparent",
            IconComponent && "pl-11",
            error && "shadow-ring-error focus:shadow-ring-error",
          )}
          {...props}
        />
      </div>
    </FieldFrame>
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
