import { Link, type LinkProps } from "@tanstack/react-router";
import { type ComponentPropsWithRef, createContext, type ReactNode, use } from "react";
import { cn } from "@/lib/cn";
import { ArrowRightIcon, type Icon } from "./icons";

type MenuSize = "md" | "sm";

const SizeContext = createContext<MenuSize>("md");

interface MenuGroupProps {
  /**
   * `md` (phones, in a sheet): the rows share one soft surface, a hairline
   * between them, like a page of a notebook. `sm` (desktop, in a popover):
   * compact rows on the popover itself, as the sidebar's.
   */
  size?: MenuSize;
  /** Makes the group a landmark (`nav`) with this name, such as "Workshop". */
  label?: string;
  className?: string;
  children: ReactNode;
}

/** A group of menu rows: places to go and settings to open, from the account sheet or menu. */
export function MenuGroup({ size = "md", label, className, children }: MenuGroupProps) {
  const Tag = label ? "nav" : "div";
  return (
    <SizeContext value={size}>
      <Tag
        aria-label={label}
        className={cn("flex flex-col", size === "md" ? "bg-paper rounded-lg" : "-mx-2 gap-0.5", className)}
      >
        {children}
      </Tag>
    </SizeContext>
  );
}

interface MenuItemBase {
  icon: Icon;
  children: ReactNode;
  className?: string;
}

type MenuItemProps = MenuItemBase &
  (
    | ({ to: LinkProps["to"] } & Omit<ComponentPropsWithRef<"a">, "children" | "className">)
    | ({ to?: undefined } & Omit<ComponentPropsWithRef<"button">, "children" | "className">)
  );

/**
 * One row of a MenuGroup: an icon, a label and, in a sheet, an arrow on links (a row that opens another sheet has none). A link
 * when given `to`, otherwise a button (it opens a sheet or signs out). Pass
 * props through so PopoverClose (asChild) can wrap it.
 */
export function MenuItem({ icon: IconComponent, children, className, ...rest }: MenuItemProps) {
  const size = use(SizeContext);
  const classes = cn(
    "pressable focus-ring group flex w-full items-center text-left",
    size === "md"
      ? "text-body text-ink hover:bg-ink/4 not-first:before:bg-hairline relative min-h-14 gap-3.5 px-4 font-semibold not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-13 not-first:before:h-px first:rounded-t-lg last:rounded-b-lg"
      : "text-body text-ink-soft hover:bg-ink/5 hover:text-ink h-9 gap-2.5 rounded-sm px-2 font-medium",
    className,
  );
  const content = (
    <>
      <IconComponent
        size={size === "md" ? 22 : 18}
        className={size === "md" ? "text-ink-soft shrink-0" : "text-ink-faint group-hover:text-ink-soft shrink-0"}
        aria-hidden
      />
      <span className="min-w-0 flex-1">{children}</span>
      {size === "md" && rest.to !== undefined && (
        <ArrowRightIcon size={18} className="text-ink-ghost shrink-0" aria-hidden />
      )}
    </>
  );
  if (rest.to !== undefined) {
    const { to, ...anchor } = rest;
    return (
      <Link to={to} className={classes} {...anchor}>
        {content}
      </Link>
    );
  }
  const { to: _to, ...button } = rest as { to?: undefined } & Omit<ComponentPropsWithRef<"button">, "children">;
  return (
    <button type="button" className={classes} {...button}>
      {content}
    </button>
  );
}
