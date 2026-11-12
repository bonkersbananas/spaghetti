import { m } from "motion/react";
import type { ReactNode } from "react";
import { Mark } from "@/components/illustrations";
import { ease, spring } from "@/lib/motion";

/**
 * The page a person sees before they are signed in (the sign-in screen, a link from another device, an invite):
 * the mark, the name, and one card with one obvious action. `children` is the card's content.
 */
export function AuthPage({
  title = "Spaghetti",
  lead = "Our printing notebook. Failures included.",
  footer,
  children,
}: {
  title?: string;
  lead?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="paper-grain bg-paper pt-safe pb-safe relative flex min-h-dvh flex-col items-center px-5">
      {/* The mark sits at the same height on every one of these pages (centering moved it with the card). */}
      <div className="flex w-full max-w-sm flex-1 flex-col pt-[clamp(2.5rem,12dvh,7rem)] pb-10">
        <m.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: ease.out }}
          className="mb-8 flex flex-col items-center text-center"
        >
          <m.div
            initial={{ rotate: -90, scale: 0.6 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ ...spring.gentle, delay: 0.05 }}
          >
            <Mark className="size-16 drop-shadow-sm md:size-18" />
          </m.div>
          <h1 className="text-display text-ink mt-5">{title}</h1>
          <p className="text-body text-ink-soft mt-1.5">{lead}</p>
        </m.div>
        <m.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: ease.out, delay: 0.08 }}
          className="bg-cream shadow-raised rounded-xl p-5 md:p-6"
        >
          {children}
        </m.div>
        {footer && <p className="text-small text-ink-faint mt-6 text-center text-balance">{footer}</p>}
      </div>
    </main>
  );
}
