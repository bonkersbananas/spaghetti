import { type ComponentPropsWithRef, forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { type Icon, LoadingIcon } from "./icons";
import { Kbd } from "./Kbd";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "floating";
export type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  primary:
    "press-tomato bg-tomato text-on-accent shadow-soft hover:bg-tomato-strong disabled:bg-ink-ghost disabled:shadow-none",
  secondary: "bg-cream text-ink shadow-key hover:shadow-key-hover disabled:text-ink-ghost",
  quiet: "bg-transparent text-ink-soft hover:bg-ink/5 hover:text-ink disabled:text-ink-ghost",
  // The pill that floats over a list on a phone, in the ActionBar ("Pick ideas", "New twist"): a lifted surface
  // on `shadow-float`, so it doesn't read as another row. Pill-shaped whatever the size.
  floating: "bg-lifted text-ink shadow-float hover:shadow-raised disabled:text-ink-ghost",
  danger:
    "press-tomato active:text-on-accent data-[pressed]:text-on-accent bg-tomato-soft text-tomato-ink hover:bg-tomato hover:text-on-accent",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-sm px-3 text-small font-semibold",
  md: "h-11 gap-2 rounded-md px-4 text-body font-semibold md:h-10",
  lg: "h-13 gap-2.5 rounded-lg px-6 text-lead font-semibold md:h-12",
};

const iconSizes: Record<ButtonSize, number> = { sm: 16, md: 20, lg: 22 };

/** The size's classes; a floating button is a pill whatever its size. */
const sizeClass = (variant: ButtonVariant, size: ButtonSize) =>
  variant === "floating" ? sizes[size].replace(/rounded-\w+/, "rounded-pill") : sizes[size];

/**
 * Small buttons keep a 44 px hit area on touch screens (touch-target), which
 * needs a positioned button: relative, unless the caller places it.
 */
const hitArea = (size: ButtonSize, className?: string) =>
  size === "sm" && cn("touch-target", !/\b(absolute|fixed|sticky)\b/.test(className ?? "") && "relative");

export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: Icon;
  /** Keyboard shortcut to show (desktop only), such as ["C"]. */
  shortcut?: string[];
  loading?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    icon: IconComponent,
    shortcut,
    loading = false,
    fullWidth = false,
    className,
    children,
    disabled,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      className={cn(
        "pressable focus-ring inline-flex shrink-0 items-center justify-center whitespace-nowrap select-none disabled:cursor-not-allowed aria-busy:pointer-events-none",
        variants[variant],
        sizeClass(variant, size),
        hitArea(size, className),
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {loading ? (
        <LoadingIcon size={iconSizes[size]} className="animate-spin" aria-hidden />
      ) : (
        IconComponent && <IconComponent size={iconSizes[size]} weight="bold" aria-hidden />
      )}
      {children}
      {shortcut && <Kbd keys={shortcut} tone={variant === "primary" ? "onAccent" : "default"} className="ml-1" />}
    </button>
  );
});

export interface ButtonLinkProps extends ComponentPropsWithRef<"a"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: Icon;
  fullWidth?: boolean;
  children?: ReactNode;
}

/** A link that looks like a button: for a download or a page elsewhere that is an action, not a line of text. */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant = "secondary", size = "md", icon: IconComponent, fullWidth = false, className, children, ...props },
  ref,
) {
  return (
    <a
      ref={ref}
      className={cn(
        "pressable focus-ring inline-flex shrink-0 items-center justify-center whitespace-nowrap select-none",
        variants[variant],
        sizeClass(variant, size),
        hitArea(size, className),
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {IconComponent && <IconComponent size={iconSizes[size]} weight="bold" aria-hidden />}
      {children}
    </a>
  );
});

export interface IconButtonProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  icon: Icon;
  /** Required: icon buttons have no visible text. */
  label: string;
  variant?: "quiet" | "secondary" | "primary";
  size?: ButtonSize;
}

const iconButtonSizes: Record<ButtonSize, string> = {
  sm: "size-8 rounded-sm",
  md: "size-11 rounded-md md:size-9",
  lg: "size-14 rounded-lg",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: IconComponent, label, variant = "quiet", size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "pressable focus-ring inline-flex shrink-0 items-center justify-center",
        variants[variant],
        iconButtonSizes[size],
        hitArea(size, className),
        className,
      )}
      {...props}
    >
      <IconComponent size={size === "lg" ? 26 : 20} weight={size === "lg" ? "bold" : "regular"} aria-hidden />
    </button>
  );
});
