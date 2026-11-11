import type { KeyboardEvent, Ref } from "react";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/use-media-query";
import { IconButton } from "./Button";
import { TextArea } from "./Field";
import { SendIcon } from "./icons";
import { Kbd } from "./Kbd";

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  /** "Say something to Marie". */
  placeholder: string;
  /** Names the field for screen readers (the placeholder goes when there is text). */
  label: string;
  inputRef?: Ref<HTMLTextAreaElement>;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Called on Escape, after the field is left (the sheet closes). */
  onEscape?: () => void;
  maxLength?: number;
  className?: string;
}

/**
 * The message field: a soft well that grows with the words, and a round send button that appears with the
 * first one. On a keyboard Enter sends, Shift+Enter breaks the line and Escape leaves the field (the hints
 * show while it has focus); on a phone Enter is a line break and the button sends. What is typed is the
 * caller's to keep (an autosaved draft), so nothing is lost on the way out.
 */
export function Composer({
  value,
  onChange,
  onSend,
  placeholder,
  label,
  inputRef,
  disabled,
  autoFocus,
  onEscape,
  maxLength,
  className,
}: ComposerProps) {
  const isDesktop = useIsDesktop();
  const hasText = value.trim().length > 0;

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.currentTarget.blur();
      onEscape?.();
      return;
    }
    // Enter sends on a keyboard; not while an input method is still composing a character.
    if (event.key === "Enter" && !event.shiftKey && isDesktop && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (hasText && !disabled) onSend();
    }
  }

  return (
    <div className={cn("group/composer flex flex-col gap-1.5", className)}>
      <div className="bg-ink/4 shadow-well focus-within:shadow-ring duration-fast flex items-end gap-1 rounded-lg py-1 pr-1 pl-4 transition-shadow">
        <TextArea
          ref={inputRef}
          aria-label={label}
          appearance="plain"
          minRows={1}
          rows={1}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          enterKeyHint="send"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 py-2.5"
        />
        <IconButton
          icon={SendIcon}
          label="Send"
          variant="primary"
          disabled={!hasText || disabled}
          onClick={onSend}
          className={cn("transition-opacity", !hasText && "pointer-events-none opacity-0")}
          tabIndex={hasText ? 0 : -1}
        />
      </div>
      <p className="text-caption text-ink-faint hidden items-center gap-3 px-1 group-focus-within/composer:md:flex">
        <span className="flex items-center gap-1">
          <Kbd keys={["↵"]} always /> to send
        </span>
        <span className="flex items-center gap-1">
          <Kbd keys={["⇧", "↵"]} always /> for a new line
        </span>
        <span className="flex items-center gap-1">
          <Kbd keys={["Esc"]} always /> to leave
        </span>
      </p>
    </div>
  );
}
