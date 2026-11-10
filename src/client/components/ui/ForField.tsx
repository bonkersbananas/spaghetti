import { type ComponentPropsWithRef, useId } from "react";
import { cn } from "@/lib/cn";

/**
 * "for Mila": who an idea or build is for, quiet under the title. It reads as a line of text until it is edited;
 * empty, it only says "for someone?" so it takes almost no room.
 */
export function ForField({ className, ...props }: Omit<ComponentPropsWithRef<"input">, "type" | "id">) {
  const id = useId();
  return (
    <div className={cn("text-body flex items-baseline gap-1.5", className)}>
      <label htmlFor={id} className="text-ink-faint shrink-0">
        for
      </label>
      <input
        id={id}
        type="text"
        maxLength={80}
        autoComplete="off"
        placeholder="someone? (optional)"
        className="text-ink placeholder:text-ink-faint focus-visible:shadow-ring min-w-0 flex-1 rounded-sm bg-transparent py-1"
        {...props}
      />
    </div>
  );
}
