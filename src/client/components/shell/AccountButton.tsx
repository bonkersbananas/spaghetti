import type { Person } from "@shared/api";
import type { ComponentPropsWithRef } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { CaretUpDownIcon } from "@/components/ui/icons";

/**
 * The person at the bottom of the sidebar, which opens the account menu. Its own module so the Sidebar can draw
 * it before the menu's code has arrived; props pass through for the popover's trigger.
 */
export function AccountButton({ user, ...props }: { user: Person } & ComponentPropsWithRef<"button">) {
  return (
    <button
      type="button"
      className="pressable focus-ring hover:bg-ink/5 data-[state=open]:bg-ink/5 mt-2 flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left"
      {...props}
    >
      <Avatar person={user} size="sm" decorative />
      <span className="text-small text-ink min-w-0 flex-1 truncate font-semibold">{user.name}</span>
      <CaretUpDownIcon size={16} className="text-ink-faint" aria-hidden />
      <span className="sr-only">Account menu</span>
    </button>
  );
}
