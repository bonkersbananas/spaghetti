import { useSuspenseQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { sessionQuery } from "@/lib/queries";
import { AccountSheet } from "./AccountSheet";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** Desktop actions on the right. Phones use the tab bar instead. */
  actions?: ReactNode;
}

/**
 * The top of every section: a large, warm title. On phones the account
 * avatar sits top right; on desktop the page's actions do.
 */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  const { data: user } = useSuspenseQuery(sessionQuery);
  const [accountOpen, setAccountOpen] = useState(false);

  return (
    <header className="pt-5 pb-6 md:pt-14 md:pb-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-display text-ink min-w-0">{title}</h1>
        {actions && <div className="hidden shrink-0 items-center gap-2 md:flex">{actions}</div>}
        {user && (
          <button
            type="button"
            onClick={() => setAccountOpen(true)}
            className="pressable focus-ring rounded-full md:hidden"
          >
            <Avatar person={user} size="md" decorative />
            <span className="sr-only">Account</span>
          </button>
        )}
      </div>
      {subtitle && <p className="max-w-content text-body text-ink-faint mt-1">{subtitle}</p>}
      {user && <AccountSheet open={accountOpen} onOpenChange={setAccountOpen} />}
    </header>
  );
}
