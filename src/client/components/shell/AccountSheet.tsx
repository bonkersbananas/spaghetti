import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { AgentIcon, ArrowRightIcon, PaletteIcon, SignOutIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { RowSkeleton } from "@/components/ui/Skeleton";
import { peopleQuery, sessionQuery } from "@/lib/queries";
import { useSignOut } from "@/lib/use-sign-out";
import { workshop } from "./sections";
import { ThemeSwitch } from "./ThemeSwitch";

/** Phone-only: who is signed in, the two people, the styleguide, sign out. */
export function AccountSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: user } = useSuspenseQuery(sessionQuery);
  const people = useQuery({ ...peopleQuery, enabled: open });
  const signOut = useSignOut();

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="The kitchen"
      description="Two cooks, one notebook."
      footer={
        <Button variant="secondary" icon={SignOutIcon} fullWidth onClick={signOut}>
          Sign out
        </Button>
      }
    >
      <ul className="flex flex-col">
        {people.data || people.isError
          ? (people.data ?? (user ? [user] : [])).map((person) => (
              <li key={person.id} className="flex items-center gap-3 py-2.5">
                <Avatar person={person} size="md" />
                <span className="text-body text-ink flex-1 font-semibold">{person.name}</span>
                {person.id === user?.id && <span className="text-small text-ink-faint">You</span>}
              </li>
            ))
          : [0, 1].map((i) => <RowSkeleton key={i} />)}
      </ul>
      <nav aria-label="Workshop" className="mt-4 flex flex-col gap-2">
        {workshop.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            onClick={() => onOpenChange(false)}
            className="pressable focus-ring bg-paper text-body text-ink flex items-center gap-3 rounded-md px-4 py-3.5 font-semibold"
          >
            <Icon size={22} className="text-ink-soft" aria-hidden />
            <span className="flex-1">{label}</span>
            <span className="text-small text-ink-faint font-medium">
              {to === "/pantry" ? "Spools and the AMS" : "Nozzles and plates"}
            </span>
            <ArrowRightIcon size={18} className="text-ink-ghost" aria-hidden />
          </Link>
        ))}
      </nav>
      <Link
        to="/agents"
        onClick={() => onOpenChange(false)}
        className="pressable focus-ring bg-paper text-body text-ink mt-4 flex items-center gap-3 rounded-md px-4 py-3.5 font-semibold"
      >
        <AgentIcon size={22} className="text-ink-soft" aria-hidden />
        <span className="flex-1">Agents</span>
        <span className="text-small text-ink-faint font-medium">Claude, the printer bridge</span>
        <ArrowRightIcon size={18} className="text-ink-ghost" aria-hidden />
      </Link>
      <ThemeSwitch className="mt-5" />
      <Link
        to="/styleguide"
        onClick={() => onOpenChange(false)}
        className="pressable focus-ring bg-paper text-body text-ink mt-4 flex items-center gap-3 rounded-md px-4 py-3.5 font-medium"
      >
        <PaletteIcon size={22} className="text-ink-faint" aria-hidden />
        <span className="flex-1">Styleguide</span>
        <ArrowRightIcon size={18} className="text-ink-ghost" aria-hidden />
      </Link>
    </Sheet>
  );
}
